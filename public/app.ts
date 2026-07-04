import './style.css';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TEAMS, VAPID_PUBLIC_KEY } from './config';
import { $, escapeHtml, formatTime, formatGap, formatDeadline, riderDisplay, avatarHtml, compBadge, skeletonRows, toast, confettiBurst } from './utils';
import { supabase } from './supabase-client';
import { icon } from './icons';
import { state } from './state';
import { supaPatch, supaRest, supaRpc } from './api';
import { login, signup } from './auth';
import { activeScoringMode, activeStages, showError, updateCompBanner, updateCompSelectOptions, updateSyncInfo } from './helpers';
import { setupDeadlineNotifications, updateNotificationButton } from './notifications';
import { loadStandings } from './views/dashboard';
import { loadHistory } from './views/history';
import { loadParticipants, loadPeloton } from './views/peloton';
import { loadPickView, renderPickStage } from './views/pick';


// Supabase client houdt de sessie automatisch vers — session blijft in sync
supabase.auth.onAuthStateChange((_event, newSession) => {
  state.session = newSession;
});

// --- TAB NAVIGATION ---
function navigateToTab(tab) {
  const link = document.querySelector(`[data-tab="${tab}"]`);
  if (!link) return;
  document.querySelectorAll('#main-tabs .nav-link').forEach(n => n.classList.remove('active'));
  link.classList.add('active');
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  $(`section-${tab}`).classList.add('active');
  window.location.hash = tab;
  if (tab === 'dashboard') loadStandings();
  if (tab === 'pick') loadPickView();
  if (tab === 'history') loadHistory();
  if (tab === 'participants') { Promise.all([loadPeloton(), loadParticipants()]); }
  if (tab === 'account') loadAccountView();
  // Admin is code-gesplitst: module wordt pas geladen als een admin het tabblad opent
  if (tab === 'admin') import('./admin').then(m => m.loadAdminView());
}

document.querySelectorAll('[data-tab]').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    navigateToTab(a.dataset.tab);
  });
});

// Handle browser back/forward and initial hash
window.addEventListener('hashchange', () => {
  const tab = window.location.hash.replace('#', '');
  if (tab && document.querySelector(`[data-tab="${tab}"]`)) navigateToTab(tab);
});

// --- ACCOUNT SETTINGS ---
function loadAccountView() {
  $('account-name').value = state.profile?.display_name || '';
  $('account-email').value = state.session?.user?.email || '';
  $('account-hero').value = state.profile?.cycling_hero || '';
  $('account-motto').value = state.profile?.motto || '';

  // Avatar preview
  updateAvatarPreview();

  // Notificatieknop status
  updateNotificationButton();

  // Test knoppen alleen voor admins
  const testPushBtn = $('btn-test-push');
  if (testPushBtn) testPushBtn.style.display = state.profile?.is_admin ? 'block' : 'none';
  const testEmailBtn = $('btn-test-email');
  if (testEmailBtn) testEmailBtn.style.display = state.profile?.is_admin ? 'block' : 'none';

  // Email-herinnering toggle
  const emailToggle = $('toggle-email-remind') as HTMLInputElement;
  if (emailToggle) emailToggle.checked = !!state.profile?.email_reminders;

  // Populate team dropdown from known teams
  const teamSel = $('account-team');
  if (teamSel.options.length <= 1) {
    const teams = Object.keys(TEAMS).sort();
    teamSel.innerHTML = '<option value="">Kies je ploeg...</option>' +
      teams.map(t => `<option value="${t}">${t}</option>`).join('');
  }
  teamSel.value = state.profile?.favorite_team || '';
}

function updateAvatarPreview() {
  const preview = $('account-avatar-preview');
  const initials = $('account-avatar-initials');
  const name = state.profile?.display_name || '?';
  const ini = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  if (state.profile?.avatar_url) {
    preview.innerHTML = `<img src="${escapeHtml(state.profile.avatar_url)}" alt="" onerror="this.remove();">`;
  } else {
    initials.textContent = ini;
  }
}

// Avatar upload
$('account-avatar-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('Foto mag maximaal 2MB zijn', 'warning'); return; }
  if (!file.type.startsWith('image/')) { toast('Alleen afbeeldingen toegestaan', 'warning'); return; }

  const status = $('account-status');
  status.textContent = 'Foto uploaden...';
  status.className = 'text-muted';

  try {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${state.session.user.id}/avatar.${ext}`;

    // Upload via Supabase Storage client
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) throw new Error('Upload mislukt');

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}?t=${Date.now()}`;
    await supaPatch('profiles', `id=eq.${state.session.user.id}`, { avatar_url: publicUrl });
    state.profile.avatar_url = publicUrl;
    state._avatarMap[state.profile.display_name] = publicUrl;
    updateAvatarPreview();
    status.textContent = 'Foto opgeslagen!';
    status.className = 'text-success';
    setTimeout(() => { status.textContent = ''; }, 2000);
  } catch (err) {
    status.textContent = err.message;
    status.className = 'text-danger';
  }
});

$('btn-save-account').addEventListener('click', async () => {
  const status = $('account-status');
  const newName = $('account-name').value.trim();
  if (!newName) { status.textContent = 'Naam mag niet leeg zijn'; status.className = 'text-danger'; return; }
  try {
    const updates = {
      display_name: newName,
      favorite_team: $('account-team').value || null,
      cycling_hero: $('account-hero').value.trim() || null,
      motto: $('account-motto').value.trim() || null,
    };
    await supaPatch('profiles', `id=eq.${state.session.user.id}`, updates);
    if (!state.profile) state.profile = {};
    Object.assign(state.profile, updates);
    $('user-name').textContent = newName;
    status.textContent = 'Opgeslagen!';
    status.className = 'text-success';
    setTimeout(() => { status.textContent = ''; }, 2000);
  } catch (e) {
    status.textContent = e.message;
    status.className = 'text-danger';
  }
});

$('btn-delete-account').addEventListener('click', async () => {
  if (!confirm('Weet je zeker dat je je account permanent wilt verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
  try {
    await supaRpc('delete_own_account');
    await supabase.auth.signOut();
    state.session = null; state.profile = null;
    $('app-loading').style.display = 'none';
    $('app').style.display = 'none';
    $('auth-screen').style.display = 'block';
    toast('Account verwijderd.', 'success');
  } catch (e: any) {
    toast('Verwijderen mislukt: ' + e.message, 'error');
  }
});

$('toggle-email-remind').addEventListener('change', async (e) => {
  const checked = (e.target as HTMLInputElement).checked;
  try {
    await supaPatch('profiles', `id=eq.${state.session.user.id}`, { email_reminders: checked });
    if (state.profile) state.profile.email_reminders = checked;
    toast(checked ? 'E-mailherinneringen ingeschakeld.' : 'E-mailherinneringen uitgeschakeld.', 'info');
  } catch (err: any) {
    toast('Opslaan mislukt: ' + err.message, 'error');
    (e.target as HTMLInputElement).checked = !checked;
  }
});

$('btn-test-push').addEventListener('click', async () => {
  const btn = $('btn-test-push') as HTMLButtonElement;
  const safeMsg = (e: any): string => { try { return e?.message || e?.name || String(e) || 'onbekende fout'; } catch { return 'onbekende fout'; } };
  btn.disabled = true;
  btn.textContent = 'Versturen…';
  let resultMsg = '';
  let resultType: 'success' | 'error' | 'warning' | 'info' = 'info';
  try {
    const { data, error } = await supabase.functions.invoke('test-push');
    if (error) { resultMsg = safeMsg(error); resultType = 'error'; }
    else if (data?.sent > 0) { resultMsg = `Testmelding verstuurd (${data.sent}/${data.subscriptions})!`; resultType = 'success'; }
    else if (data?.error) { resultMsg = String(data.error); resultType = 'warning'; }
    else if (data?.details?.length) { const d = data.details[0]; resultMsg = `HTTP ${d.status ?? '?'} van ${d.endpoint} — ${d.body || d.error || 'geen body'}`; resultType = 'error'; }
    else { resultMsg = 'Geen subscription gevonden. Schakel app-meldingen opnieuw in.'; resultType = 'warning'; }
  } catch (e: any) {
    resultMsg = 'Aanroep mislukt: ' + safeMsg(e);
    resultType = 'error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test sturen';
  }
  btn.insertAdjacentHTML('afterend', `<div id="push-test-result" style="font-size:0.75rem;color:${resultType==='success'?'var(--green)':'var(--red)'}; margin-top:4px;">${resultMsg}</div>`);
  document.getElementById('push-test-result-prev')?.remove();
  const el = document.getElementById('push-test-result');
  if (el) { el.id = 'push-test-result-prev'; setTimeout(() => el.remove(), 8000); }
  toast(resultMsg, resultType);
});

$('btn-test-email').addEventListener('click', async () => {
  const btn = $('btn-test-email') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Versturen…';
  try {
    const { data, error } = await supabase.functions.invoke('test-email');
    if (error) throw error;
    if (data?.sent) toast(`Test-mail verstuurd naar ${data.to}`, 'success');
    else toast(data?.error || 'Onbekende fout', 'error');
  } catch (e: any) {
    // FunctionsHttpError: echte foutmelding zit in de response body (e.context)
    let msg = e?.message || String(e);
    try {
      const body = await e?.context?.json();
      if (body?.error) msg = body.error;
    } catch { /* body al gelezen of geen json */ }
    toast('Fout: ' + msg, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test sturen';
  }
});

// Admin sub-tab navigation
document.querySelectorAll('[data-admin]').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('#admin-tabs .nav-link').forEach(n => n.classList.remove('active'));
    a.classList.add('active');
    document.querySelectorAll('.admin-sub').forEach(s => s.classList.remove('active'));
    $(a.dataset.admin).classList.add('active');
  });
});

// --- AUTH HANDLERS ---
// Submit op het form: Enter in een veld werkt, en de knop toont busy-state
// zodat "de knop doet niets" niet meer kan (fouten blijven zichtbaar via showError)
$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  if (!email || !password) { showError('Vul je e-mailadres en wachtwoord in.'); return; }
  const btn = $('btn-login');
  btn.disabled = true;
  btn.textContent = 'Bezig…';
  try {
    state.session = await login(email, password);
    await initApp();
  } catch (e2) { showError(e2.message); }
  finally {
    btn.disabled = false;
    btn.textContent = 'Inloggen';
  }
});

$('btn-signup').addEventListener('click', async () => {
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  if (!email || !password) { showError('Vul je e-mailadres en wachtwoord in.'); return; }
  try {
    const data = await signup(email, password, email.split('@')[0]);
    if (data.session) { state.session = data.session; await initApp(); }
    else showError('Check je email om je account te bevestigen');
  } catch (e) { showError(e.message); }
});

$('btn-forgot-password').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = $('auth-email').value.trim();
  if (!email) { showError('Vul eerst je e-mailadres in'); return; }
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw new Error(error.message);
    $('auth-error').style.display = 'none';
    const el = $('auth-success');
    el.textContent = 'Herstelmail verzonden! Check je inbox.';
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
  } catch (e) { showError(e.message); }
});

$('user-name').addEventListener('click', (e) => { e.preventDefault(); navigateToTab('account'); });

$('btn-logout').addEventListener('click', async () => {
  if (state._realtimeChannel) { supabase.removeChannel(state._realtimeChannel); state._realtimeChannel = null; }
  await supabase.auth.signOut();
  state.session = null; state.profile = null;
  $('app-loading').style.display = 'none';
  $('app').style.display = 'none';
  $('auth-screen').style.display = 'block';
});

// --- COMPETITION SELECTOR ---
$('comp-select').addEventListener('change', async () => {
  state.activeCompId = parseInt($('comp-select').value);
  localStorage.setItem('bagagedrager_comp', state.activeCompId);
  state._cache.standings = null; state._cache.participants = null;
  updateCompBanner();
  await loadRidersForComp();
  const activeTab = document.querySelector('#main-tabs .nav-link.active');
  if (activeTab) activeTab.click();
});

// --- INIT ---
export async function initApp() {
  // Gebruik opgeslagen compId om riders mee te batchen in de eerste round-trip
  const savedCompId = parseInt(localStorage.getItem('bagagedrager_comp')) || null;

  const [profiles, comps, allStages, picks, allProfiles, preloadedRiders, preloadedStandings, teamShirts] = await Promise.all([
    supaRest('profiles', { filters: `id=eq.${state.session.user.id}` }),
    supaRest('competitions', { filters: 'order=year.desc,name' }),
    supaRest('stages', { filters: 'order=stage_number' }),
    supaRest('picks', { filters: `user_id=eq.${state.session.user.id}&order=stage_id` }),
    supaRest('profiles'),
    savedCompId ? supaRest('riders', { filters: `competition_id=eq.${savedCompId}&order=bib_number` }) : Promise.resolve(null),
    savedCompId ? supaRest('general_classification', { filters: `competition_id=eq.${savedCompId}` }) : Promise.resolve(null),
    supaRest('team_shirts').catch(() => []),
  ]);

  state.profile = profiles[0];
  state.competitions = comps;
  state.stages = allStages;
  state.myPicks = picks;
  state._cache.allProfiles = allProfiles;
  allProfiles.forEach(p => { state._avatarMap[p.display_name] = p.avatar_url; });

  // Tenues uit de DB — localStorage is alleen nog cache/fallback
  if (teamShirts?.length) {
    teamShirts.forEach(s => { state.teamShirts[s.team_name] = s.shirt_url; });
    localStorage.setItem('bagagedrager_shirts', JSON.stringify(state.teamShirts));
  }

  $('user-name').textContent = state.profile?.display_name || state.session.user.email;
  $('app-loading').style.display = 'none';
  $('auth-screen').style.display = 'none';
  $('app').style.display = 'block';
  supaRest('profiles', { method: 'PATCH', filters: `id=eq.${state.session.user.id}`, body: { last_seen_at: new Date().toISOString() } }).catch(() => {});

  if (state.profile?.is_admin) $('admin-tab').style.display = 'block';

  updateCompSelectOptions();
  updateSyncInfo();
  // Onthoud laatst gekozen ronde, val terug op actieve, dan eerste
  const sel = $('comp-select');
  const activeComps = state.competitions.filter(c => c.is_active);
  const savedComp = savedCompId ? activeComps.find(c => c.id === savedCompId) : null;
  const activeComp = savedComp || activeComps[0];
  if (activeComp) { sel.value = activeComp.id; state.activeCompId = activeComp.id; }
  updateCompBanner();

  if (preloadedRiders && state.activeCompId === savedCompId) {
    state.riders = preloadedRiders;
    state.stageRiders = {};
    state._riderMap = {};
    for (const r of state.riders) state._riderMap[r.id] = r;
    state._riderDropdownStageId = null;
    const tf = $('rider-team-filter');
    if (tf) { tf.innerHTML = '<option value="">Alle teams</option>'; tf.value = ''; }
    // Klassiekers hebben per-etappe startlijsten — laad die alsnog
    if (activeScoringMode() === 'classic') {
      const compStageIds = activeStages().map(s => s.id);
      if (compStageIds.length) {
        const srData = await supaRest('stage_riders', {
          filters: `stage_id=in.(${compStageIds.join(',')})`,
          select: 'stage_id,rider_id',
        });
        for (const sr of srData) {
          if (!state.stageRiders[sr.stage_id]) state.stageRiders[sr.stage_id] = new Set();
          state.stageRiders[sr.stage_id].add(sr.rider_id);
        }
      }
    }
  } else {
    await loadRidersForComp();
  }

  // Vul standings cache alvast zodat loadStandings direct kan renderen (geen skeleton flash)
  if (preloadedStandings && state.activeCompId === savedCompId) {
    state._cache.standings = preloadedStandings;
    state._cache.standingsCompId = state.activeCompId;
    // winnerTimeSum blijft undefined → achtergrondverzoek in loadStandings
  }

  // Navigate to hash tab or default to dashboard
  const hashTab = window.location.hash.replace('#', '');
  if (hashTab && document.querySelector(`[data-tab="${hashTab}"]`)) {
    navigateToTab(hashTab);
  } else {
    loadStandings();
  }

  setupDeadlineNotifications();
  setupRealtime();
}

export async function loadDnfRiderIds() {
  if (!state.activeCompId) return;
  const compStageIds = activeStages().map(s => s.id);
  const [fromResults, fromRiders] = await Promise.all([
    compStageIds.length
      ? supaRest('stage_results', { select: 'rider_id', filters: `stage_id=in.(${compStageIds.join(',')})&dnf=eq.true` })
      : Promise.resolve([]),
    supaRest('riders', { select: 'id', filters: `competition_id=eq.${state.activeCompId}&dnf=eq.true` }),
  ]);
  state.dnfRiderIds = new Set([
    ...(fromResults || []).map((r: any) => r.rider_id),
    ...(fromRiders || []).map((r: any) => r.id),
  ]);
}

function setupRealtime() {
  // Verwijder eventuele bestaande channel (bij re-login)
  if (state._realtimeChannel) { supabase.removeChannel(state._realtimeChannel); }

  state._realtimeChannel = supabase
    .channel('game-updates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stage_results' }, async () => {
      state._cache.standings = null;
      state._cache.participants = null;
      // Herlaad DNF-renners zodat grid direct klopt
      await loadDnfRiderIds();
      if (document.querySelector('#section-dashboard.active')) {
        loadStandings();
        toast('Resultaten bijgewerkt', 'info', 2500);
      }
      if (document.querySelector('#section-pick.active')) renderPickStage();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'picks' }, async () => {
      state._cache.participants = null;
      state._cache.standings = null;
      // Herlaad eigen picks zodat "al gebruikt" direct klopt
      state.myPicks = await supaRest('picks', { filters: `user_id=eq.${state.session.user.id}&order=stage_id` });
      if (document.querySelector('#section-pick.active')) renderPickStage();
      if (document.querySelector('#section-participants.active')) loadParticipants();
    })
    .subscribe();
}

export async function loadRidersForComp() {
  if (state.activeCompId) {
    // stage_riders alleen nodig voor klassiekers (per-etappe startlijst)
    const isClassic = activeScoringMode() === 'classic';
    const compStageIds = isClassic ? activeStages().map(s => s.id) : [];
    const srFetch = (isClassic && compStageIds.length)
      ? supaRest('stage_riders', { filters: `stage_id=in.(${compStageIds.join(',')})`, select: 'stage_id,rider_id' })
      : Promise.resolve(null);
    const [ridersData, srData] = await Promise.all([
      supaRest('riders', { filters: `competition_id=eq.${state.activeCompId}&order=bib_number` }),
      srFetch,
    ]);
    state.riders = ridersData;
    state.stageRiders = {};
    for (const sr of srData || []) {
      if (!state.stageRiders[sr.stage_id]) state.stageRiders[sr.stage_id] = new Set();
      state.stageRiders[sr.stage_id].add(sr.rider_id);
    }
  } else {
    state.riders = await supaRest('riders', { filters: 'order=bib_number' });
    state.stageRiders = {};
  }
  await loadDnfRiderIds();
  state._riderMap = {};
  for (const r of state.riders) state._riderMap[r.id] = r;
  state._riderDropdownStageId = null;
  const tf = $('rider-team-filter');
  if (tf) { tf.innerHTML = '<option value="">Alle teams</option>'; tf.value = ''; }
}

// =====================
// FOTO HOVER PREVIEW
// =====================
{
  const preview = document.getElementById('photo-preview');
  const previewImg = document.getElementById('photo-preview-img');

  function getPreviewableImg(target) {
    const riderPhoto = target.closest('.rider-photo');
    if (riderPhoto && riderPhoto.src) return riderPhoto;
    const avatar = target.closest('.avatar');
    if (avatar) {
      const img = avatar.querySelector('img');
      if (img && img.src) return img;
    }
    return null;
  }

  document.addEventListener('mouseover', e => {
    const img = getPreviewableImg(e.target);
    if (!img) return;
    previewImg.src = img.src;
    preview.style.display = 'block';
  });

  document.addEventListener('mousemove', e => {
    if (preview.style.display === 'none') return;
    const offset = 16, w = 140, h = 140;
    const x = e.clientX + offset + w > window.innerWidth ? e.clientX - w - offset : e.clientX + offset;
    const y = e.clientY + offset + h > window.innerHeight ? e.clientY - h - offset : e.clientY + offset;
    preview.style.left = x + 'px';
    preview.style.top = y + 'px';
  });

  document.addEventListener('mouseout', e => {
    if (getPreviewableImg(e.target)) preview.style.display = 'none';
  });
}

// --- BOOT ---
// Service worker vroeg registreren zodat push notificaties werken ook zonder account tab
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

(async () => {
  const { data: { session: s } } = await supabase.auth.getSession();
  if (s) {
    state.session = s;
    await initApp();
    return;
  }
  // Geen geldige sessie: toon login scherm
  $('app-loading').style.display = 'none';
  $('auth-screen').style.display = 'block';
})();
