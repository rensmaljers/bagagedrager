// --- CONFIG ---
const SUPABASE_URL = 'https://hdkvirtytljnuawcmoui.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhka3ZpcnR5dGxqbnVhd2Ntb3VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMzk4MTMsImV4cCI6MjA4OTkxNTgxM30.CsuQeET1dwzgb1HbL-YVoUW-Jq4OuynR3VgH792SlNk';

// --- STATE ---
let session = null;
let profile = null;
let competitions = [];
let riders = [];
let stages = [];
let myPicks = [];
let selectedRiderId = null;
let activeCompId = null;
let _cache = { standings: null, standingsCompId: null, participants: null, participantsCompId: null };

// --- SUPABASE REST HELPERS ---
function authHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, ...extra };
  if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`;
  return h;
}

async function supaRest(table, { method = 'GET', filters = '', body, select = '*' } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}${filters ? '&' + filters : ''}`;
  const prefer = method === 'POST' ? 'return=representation' : method === 'PATCH' ? 'return=representation' : '';
  const opts = { method, headers: authHeaders({ 'Prefer': prefer }) };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function supaDelete(table, filters) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filters}`;
  const res = await fetch(url, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
}

async function supaPatch(table, filters, body) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filters}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: authHeaders({ 'Prefer': 'return=representation' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Call a Postgres RPC function
async function supaRpc(fnName, params = {}) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${fnName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(params),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.message || data?.error || text || 'RPC call mislukt';
    throw new Error(msg);
  }
  return data;
}

// --- AUTH ---
async function login(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(dutchAuthError(data.error_description || data.msg));
  return data;
}

function dutchAuthError(msg) {
  if (!msg) return 'Er ging iets mis, probeer het later opnieuw.';
  const lower = msg.toLowerCase();
  if (lower.includes('database error saving new user') || lower.includes('maximum number of players')) return 'Fout bij aanmaken: ' + msg;
  if (lower.includes('user already registered')) return 'Dit e-mailadres is al geregistreerd. Probeer in te loggen.';
  if (lower.includes('invalid login credentials')) return 'Onjuist e-mailadres of wachtwoord.';
  if (lower.includes('email not confirmed')) return 'Je e-mail is nog niet bevestigd. Check je inbox.';
  if (lower.includes('password should be at least')) return 'Wachtwoord moet minimaal 6 tekens zijn.';
  if (lower.includes('unable to validate email')) return 'Ongeldig e-mailadres.';
  if (lower.includes('rate limit')) return 'Te veel pogingen. Wacht even en probeer opnieuw.';
  if (lower.includes('signup is disabled')) return 'Aanmelden is momenteel uitgeschakeld.';
  return msg;
}

async function signup(email, password, displayName) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password, data: { display_name: displayName } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(dutchAuthError(data.error_description || data.msg));
  return data;
}

// --- TEAM CONFIG ---
const TEAMS = {
  'UAE Team Emirates':        { abbr: 'UAE', color: '#e2001a', color2: '#000000' },
  'Visma-Lease a Bike':       { abbr: 'VIS', color: '#ffcc00', color2: '#000000' },
  'Soudal Quick-Step':        { abbr: 'SQS', color: '#0057b8', color2: '#ffffff' },
  'Alpecin-Deceuninck':       { abbr: 'ADC', color: '#1d1d5e', color2: '#e31937' },
  'INEOS Grenadiers':         { abbr: 'IGD', color: '#8b1a32', color2: '#1d428a' },
  'Red Bull-BORA-hansgrohe':  { abbr: 'RBH', color: '#1a2b5f', color2: '#db0a40' },
  'Lidl-Trek':                { abbr: 'LTR', color: '#e31937', color2: '#ffffff' },
  'Intermarché-Wanty':        { abbr: 'IWG', color: '#0055a0', color2: '#ffd100' },
  'Bahrain Victorious':       { abbr: 'TBV', color: '#cc0000', color2: '#ffffff' },
  'Decathlon AG2R':           { abbr: 'DAT', color: '#5b3c28', color2: '#ffffff' },
  'EF Education-EasyPost':    { abbr: 'EFE', color: '#ff69b4', color2: '#341f97' },
  'Groupama-FDJ':             { abbr: 'GFC', color: '#0055a4', color2: '#ffffff' },
  'Jayco-AlUla':              { abbr: 'JAY', color: '#00b140', color2: '#000000' },
  'Movistar':                 { abbr: 'MOV', color: '#002855', color2: '#00b5e2' },
  'Cofidis':                  { abbr: 'COF', color: '#cc0000', color2: '#ffffff' },
  'Lotto-Dstny':              { abbr: 'LTD', color: '#e30613', color2: '#000000' },
  'dsm-firmenich PostNL':     { abbr: 'DSM', color: '#ff6600', color2: '#000000' },
  'Astana Qazaqstan':         { abbr: 'AST', color: '#00b5d6', color2: '#ffffff' },
  'TotalEnergies':            { abbr: 'TEN', color: '#ffd100', color2: '#0055a4' },
  'Uno-X Mobility':           { abbr: 'UXT', color: '#ff6600', color2: '#ffffff' },
};

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Team shirt URLs from PCS (populated via sync or manually)
let teamShirts = JSON.parse(localStorage.getItem('bagagedrager_shirts') || '{}');

function teamBadge(teamName) {
  const t = TEAMS[teamName];
  const safe = escapeHtml(teamName || '');
  const shirtUrl = teamShirts[teamName];
  const shirtImg = shirtUrl ? `<img src="${shirtUrl}" class="team-shirt" alt="" onerror="this.style.display='none'">` : '';

  if (!t) {
    if (shirtImg) return `<span class="team-badge">${shirtImg}<span class="team-abbr">${safe}</span></span>`;
    return `<span class="team-badge"><span class="team-dot" style="background:var(--text-muted)"></span><span class="team-abbr">${safe}</span></span>`;
  }
  if (shirtImg) return `<span class="team-badge">${shirtImg}<span class="team-abbr">${escapeHtml(t.abbr)}</span></span>`;
  return `<span class="team-badge"><span class="team-dot" style="background:${t.color};box-shadow:inset -3px -3px 0 ${t.color2}"></span><span class="team-abbr">${escapeHtml(t.abbr)}</span></span>`;
}

// --- HELPERS ---
function formatTime(totalSeconds) {
  if (!totalSeconds) return '-';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function formatDeadline(dt) {
  return new Date(dt).toLocaleString('nl-NL', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function $(id) { return document.getElementById(id); }

function showError(msg) {
  const el = $('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function compBadge(type) {
  const cls = { tour: 'comp-tour', giro: 'comp-giro', vuelta: 'comp-vuelta', classic: 'comp-classic' };
  const labels = { tour: 'Tour', giro: 'Giro', vuelta: 'Vuelta', classic: 'Klassieker' };
  return `<span class="comp-badge ${cls[type] || 'comp-classic'}">${labels[type] || type}</span>`;
}

function activeStages() {
  return stages.filter(s => s.competition_id === activeCompId);
}

function activeScoringMode() {
  const comp = competitions.find(c => c.id === activeCompId);
  return comp?.scoring_mode || 'grand_tour';
}

function updateCompBanner() {
  const banner = $('comp-banner');
  const comp = competitions.find(c => c.id === activeCompId);
  if (!comp) { banner.style.display = 'none'; return; }
  const flag = comp.country_flag || '🏁';
  $('comp-banner-badge').textContent = flag;
  $('comp-banner-badge').className = 'comp-badge';
  $('comp-banner-badge').style.fontSize = '1.2rem';
  $('comp-banner-name').textContent = comp.name;
  banner.style.display = 'flex';
  applyCompColor();
}

function applyCompColor() {
  const comp = competitions.find(c => c.id === activeCompId);
  const color = comp?.color || '#facc15';
  document.documentElement.style.setProperty('--comp-color', color);
  // Apply to comp-banner border
  const banner = $('comp-banner');
  if (banner) {
    banner.style.borderColor = color + '40';
    banner.style.background = color + '10';
  }
  // Apply to comp-select
  const sel = $('comp-select');
  if (sel) {
    sel.style.borderColor = color + '60';
    sel.style.background = color + '10';
  }
}

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
  if (tab === 'participants') { loadPeloton(); loadParticipants(); }
  if (tab === 'account') loadAccountView();
  if (tab === 'admin') loadAdminView();
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
  $('account-name').value = profile?.display_name || '';
  $('account-email').value = session?.user?.email || '';
}

$('btn-save-account').addEventListener('click', async () => {
  const status = $('account-status');
  const newName = $('account-name').value.trim();
  if (!newName) { status.textContent = 'Naam mag niet leeg zijn'; status.className = 'text-danger'; return; }
  try {
    await supaPatch('profiles', `id=eq.${session.user.id}`, { display_name: newName });
    if (!profile) profile = {};
    profile.display_name = newName;
    $('user-name').textContent = newName;
    status.textContent = 'Opgeslagen!';
    status.className = 'text-success';
    setTimeout(() => { status.textContent = ''; }, 2000);
  } catch (e) {
    status.textContent = e.message;
    status.className = 'text-danger';
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
$('btn-login').addEventListener('click', async () => {
  try {
    session = await login($('auth-email').value, $('auth-password').value);
    await initApp();
  } catch (e) { showError(e.message); }
});

$('btn-signup').addEventListener('click', async () => {
  try {
    const email = $('auth-email').value;
    const data = await signup(email, $('auth-password').value, email.split('@')[0]);
    if (data.access_token) { session = data; await initApp(); }
    else showError('Check je email om je account te bevestigen');
  } catch (e) { showError(e.message); }
});

$('btn-forgot-password').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = $('auth-email').value.trim();
  if (!email) { showError('Vul eerst je e-mailadres in'); return; }
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error_description || d.msg || 'Fout bij verzenden'); }
    $('auth-error').style.display = 'none';
    const el = $('auth-success');
    el.textContent = 'Herstelmail verzonden! Check je inbox.';
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
  } catch (e) { showError(e.message); }
});

$('btn-logout').addEventListener('click', () => {
  session = null; profile = null;
  localStorage.removeItem('bagagedrager_session');
  $('app').style.display = 'none';
  $('auth-screen').style.display = 'block';
});

// --- DEADLINE NOTIFICATIONS ---
function setupDeadlineNotifications() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
  // Check every minute for upcoming deadlines
  setInterval(checkDeadlineNotifications, 60000);
  checkDeadlineNotifications();
}

function checkDeadlineNotifications() {
  if (Notification.permission !== 'granted') return;
  const now = new Date();
  const compStages = activeStages();
  for (const s of compStages) {
    if (s.locked) continue;
    const deadline = new Date(s.start_time || s.deadline);
    const diff = deadline - now;
    // Notify 30 min before (between 29-31 min window to avoid duplicates)
    if (diff > 0 && diff <= 31 * 60000 && diff > 29 * 60000) {
      const hasPick = myPicks.some(p => p.stage_id === s.id);
      if (!hasPick) {
        new Notification('🚴 Bagagedrager', {
          body: `Nog 30 minuten om een renner te kiezen voor Etappe ${s.stage_number}!`,
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🚴</text></svg>',
          tag: `deadline-${s.id}`,
        });
      }
    }
    // Also notify at 5 min
    if (diff > 0 && diff <= 6 * 60000 && diff > 4 * 60000) {
      const hasPick = myPicks.some(p => p.stage_id === s.id);
      if (!hasPick) {
        new Notification('⚠️ Bagagedrager', {
          body: `Nog 5 minuten! Kies snel een renner voor Etappe ${s.stage_number}!`,
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🚴</text></svg>',
          tag: `deadline-urgent-${s.id}`,
        });
      }
    }
  }
}

// --- COMPETITION SELECTOR ---
$('comp-select').addEventListener('change', async () => {
  activeCompId = parseInt($('comp-select').value);
  _cache.standings = null; _cache.participants = null;
  updateCompBanner();
  await loadRidersForComp();
  const activeTab = document.querySelector('#main-tabs .nav-link.active');
  if (activeTab) activeTab.click();
});

// --- INIT ---
async function initApp() {
  localStorage.setItem('bagagedrager_session', JSON.stringify(session));

  // Parallel fetch: all initial data at once
  const [profiles, comps, allStages, picks] = await Promise.all([
    supaRest('profiles', { filters: `id=eq.${session.user.id}` }),
    supaRest('competitions', { filters: 'order=year.desc,name' }),
    supaRest('stages', { filters: 'order=stage_number' }),
    supaRest('picks', { filters: `user_id=eq.${session.user.id}&order=stage_id` }),
  ]);

  profile = profiles[0];
  competitions = comps;
  stages = allStages;
  myPicks = picks;

  $('user-name').textContent = profile?.display_name || session.user.email;
  $('auth-screen').style.display = 'none';
  $('app').style.display = 'block';

  if (profile?.is_admin) $('admin-tab').style.display = 'block';

  const sel = $('comp-select');
  sel.innerHTML = competitions.map(c =>
    `<option value="${c.id}" ${c.is_active ? 'selected' : ''}>${c.country_flag || ''} ${c.name}</option>`
  ).join('');
  const active = competitions.find(c => c.is_active) || competitions[0];
  if (active) { sel.value = active.id; activeCompId = active.id; }
  updateCompBanner();

  await loadRidersForComp();

  // Navigate to hash tab or default to dashboard
  const hashTab = window.location.hash.replace('#', '');
  if (hashTab && document.querySelector(`[data-tab="${hashTab}"]`)) {
    navigateToTab(hashTab);
  } else {
    loadStandings();
  }

  setupDeadlineNotifications();
}

async function loadRidersForComp() {
  if (activeCompId) {
    riders = await supaRest('riders', { filters: `competition_id=eq.${activeCompId}&order=bib_number` });
  } else {
    riders = await supaRest('riders', { filters: 'order=bib_number' });
  }
  // Reset team filter dropdown (will be repopulated on render)
  const tf = $('rider-team-filter');
  if (tf) { tf.innerHTML = '<option value="">Alle teams</option>'; tf.value = ''; }
}

// --- DASHBOARD ---
async function loadStandings() {
  if (!activeCompId) {
    const empty = '<tr><td colspan="3"><div class="empty-state"><div class="empty-state-icon">🏁</div><div class="empty-state-text">Selecteer een ronde om het klassement te zien</div></div></td></tr>';
    $('gc-table').innerHTML = empty;
    $('points-table').innerHTML = empty;
    $('mountain-table').innerHTML = empty;
    $('game-table').innerHTML = empty;
    return;
  }

  let standings;
  if (_cache.standingsCompId === activeCompId && _cache.standings) {
    standings = _cache.standings;
  } else {
    standings = await supaRest('general_classification', {
      filters: `competition_id=eq.${activeCompId}`
    });
    _cache.standings = standings;
    _cache.standingsCompId = activeCompId;
  }

  const emptyRow = '<tr><td colspan="3" class="text-muted text-center py-3">Nog geen resultaten — wordt zichtbaar na de eerste etappe</td></tr>';
  const medal = ['🥇', '🥈', '🥉'];
  const mode = activeScoringMode();
  const isClassic = mode === 'classic';

  // Show/hide cards based on scoring mode
  $('gc-card').style.display = isClassic ? 'none' : '';
  $('points-card').style.display = isClassic ? 'none' : '';
  $('mountain-card').style.display = isClassic ? 'none' : '';
  $('game-card').style.display = isClassic ? '' : 'none';

  // Adjust column widths
  const cards = ['gc-card', 'points-card', 'mountain-card', 'game-card'];
  cards.forEach(id => {
    const el = $(id);
    if (el.style.display !== 'none') {
      el.className = isClassic ? 'col-lg-6' : 'col-lg-3';
    }
  });

  if (!isClassic) {
    const gc = [...standings].sort((a, b) => a.total_time - b.total_time);
    $('gc-table').innerHTML = gc.map((s, i) =>
      `<tr><td class="${i < 3 ? 'rank-' + (i+1) : ''}">${medal[i] || i + 1}</td><td>${escapeHtml(s.display_name)}</td><td class="time text-end">${formatTime(s.total_time)}</td></tr>`
    ).join('') || emptyRow;

    const pts = [...standings].sort((a, b) => b.total_points - a.total_points);
    $('points-table').innerHTML = pts.map((s, i) =>
      `<tr><td class="${i < 3 ? 'rank-' + (i+1) : ''}">${medal[i] || i + 1}</td><td>${escapeHtml(s.display_name)}</td><td class="text-end">${s.total_points}</td></tr>`
    ).join('') || emptyRow;

    const mt = [...standings].sort((a, b) => b.total_mountain_points - a.total_mountain_points);
    $('mountain-table').innerHTML = mt.map((s, i) =>
      `<tr><td class="${i < 3 ? 'rank-' + (i+1) : ''}">${medal[i] || i + 1}</td><td>${escapeHtml(s.display_name)}</td><td class="text-end">${s.total_mountain_points}</td></tr>`
    ).join('') || emptyRow;
  }

  const gp = [...standings].sort((a, b) => b.total_game_points - a.total_game_points);
  $('game-table').innerHTML = gp.map((s, i) =>
    `<tr><td class="${i < 3 ? 'rank-' + (i+1) : ''}">${medal[i] || i + 1}</td><td>${escapeHtml(s.display_name)}</td><td class="text-end">${s.total_game_points || 0}</td></tr>`
  ).join('') || emptyRow;

  renderStageTimeline();
}

function renderStageTimeline() {
  const compStages = activeStages();
  const now = new Date();
  $('stage-timeline').innerHTML = compStages.map(s => {
    const hasResults = s.locked;
    const deadline = new Date(s.deadline);
    const isPast = now > deadline;
    let cls = 'upcoming';
    let title = `Etappe ${s.stage_number}: ${s.name}`;
    if (hasResults) { cls = 'completed'; title += ' (afgerond)'; }
    else if (isPast) { cls = 'locked'; title += ' (vergrendeld)'; }
    else if (!hasResults && !isPast) {
      const nextOpen = compStages.find(st => !st.locked && now <= new Date(st.deadline));
      cls = nextOpen?.id === s.id ? 'open' : 'upcoming';
      if (cls === 'open') title += ' (open voor keuze)';
    }
    return `<div class="stage-dot ${cls}" title="${title}">${s.stage_number}</div>`;
  }).join('');
}

// --- PICK VIEW ---
async function loadPickView() {
  const compStages = activeStages();
  const sel = $('stage-select');
  const now = new Date();
  sel.innerHTML = compStages.map(s => {
    const locked = s.locked || now > new Date(s.deadline);
    return `<option value="${s.id}">${locked ? '🔒 ' : ''} Etappe ${s.stage_number}: ${s.name}</option>`;
  }).join('');

  const nextStage = compStages.find(s => !s.locked) || compStages[0];
  if (nextStage) sel.value = nextStage.id;

  sel.onchange = () => renderPickStage();
  renderPickStage();
}

function renderPickStage() {
  const stageId = parseInt($('stage-select').value);
  const stage = stages.find(s => s.id === stageId);
  if (!stage) return;

  const now = new Date();
  const isLocked = stage.locked || now > new Date(stage.deadline);

  $('pick-stage-name').textContent = `Etappe ${stage.stage_number}: ${stage.name}`;
  $('pick-deadline').textContent = `Start: ${formatDeadline(stage.start_time || stage.deadline)}${isLocked ? ' (VERGRENDELD)' : ''}`;
  $('pick-locked-msg').style.display = isLocked ? 'block' : 'none';

  const currentPick = myPicks.find(p => p.stage_id === stageId);
  selectedRiderId = currentPick?.rider_id || null;

  const compStageIds = new Set(activeStages().map(s => s.id));
  const usedInOtherStages = new Set(
    myPicks.filter(p => p.stage_id !== stageId && compStageIds.has(p.stage_id)).map(p => p.rider_id)
  );

  renderRiderGrid(usedInOtherStages, isLocked && !currentPick);
  $('btn-submit-pick').disabled = !selectedRiderId || (isLocked && !currentPick);
  updatePickBar(stage, currentPick);
  updateRiderAvailability(usedInOtherStages);
  updateOthersPicks(stageId, isLocked);
}

function updateRiderAvailability(usedInOtherStages) {
  const total = riders.length;
  const used = usedInOtherStages.size;
  const available = total - used;
  $('rider-availability').innerHTML = `
    <span class="avail-stat available">🟢 ${available} beschikbaar</span>
    <span class="avail-stat used">🔴 ${used} gebruikt</span>
    <span class="avail-stat total">📋 ${total} totaal</span>`;
}

async function updateOthersPicks(stageId, isLocked) {
  const container = $('others-picks');
  const body = $('others-picks-body');
  if (!isLocked) { container.style.display = 'none'; return; }

  // Fetch picks for this stage from cache or API
  let stagePicks;
  if (_cache.participantsCompId === activeCompId && _cache.participants) {
    stagePicks = _cache.participants.filter(p => p.stage_id === stageId);
  } else {
    stagePicks = await supaRest('stage_picks_public', {
      filters: `stage_id=eq.${stageId}&order=display_name`
    });
  }

  if (!stagePicks.length) { container.style.display = 'none'; return; }
  container.style.display = 'block';
  body.innerHTML = stagePicks.map(p => {
    const isMe = p.user_id === session.user.id;
    return `<div class="others-pick-row${isMe ? ' fw-bold' : ''}">
      <span>${escapeHtml(p.display_name)}</span>
      <span>${escapeHtml(p.rider_name)} ${teamBadge(p.rider_team)}${p.is_random ? ' <span class="badge bg-info" style="font-size:0.6rem;">🎡</span>' : ''}</span>
    </div>`;
  }).join('');
}

let _countdownInterval;
function updatePickBar(stage, currentPick) {
  const bar = $('pick-bar');
  const rider = selectedRiderId ? riders.find(r => r.id === selectedRiderId) : null;
  const isLocked = stage.locked || new Date() > new Date(stage.deadline);

  if (!rider && !currentPick) {
    bar.style.display = 'none';
    clearInterval(_countdownInterval);
    return;
  }

  bar.style.display = 'block';
  const isNewPick = rider && !currentPick;
  const isChanged = rider && currentPick && rider.id !== currentPick.rider_id;
  bar.className = (isNewPick || isChanged) ? 'pick-bar unconfirmed' : 'pick-bar';

  if (rider) {
    const status = currentPick && rider.id === currentPick.rider_id ? '✓ Bevestigd' : '⚠ Nog niet bevestigd';
    $('pick-bar-rider').textContent = `${rider.name} #${rider.bib_number} — ${status}`;
  }

  // Countdown
  clearInterval(_countdownInterval);
  if (!isLocked) {
    const updateCountdown = () => {
      const deadline = new Date(stage.start_time || stage.deadline);
      const diff = deadline - new Date();
      if (diff <= 0) {
        $('pick-bar-countdown').textContent = '🔒 Etappe gestart';
        $('pick-bar-countdown').className = 'pick-bar-countdown urgent';
        clearInterval(_countdownInterval);
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const parts = [];
      if (d > 0) parts.push(`${d}d`);
      parts.push(`${h}u ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`);
      $('pick-bar-countdown').textContent = `⏱ Nog ${parts.join(' ')} tot start`;
      $('pick-bar-countdown').className = diff < 3600000 ? 'pick-bar-countdown urgent' : 'pick-bar-countdown';
    };
    updateCountdown();
    _countdownInterval = setInterval(updateCountdown, 1000);
  } else {
    $('pick-bar-countdown').textContent = '🔒 Etappe gestart';
    $('pick-bar-countdown').className = 'pick-bar-countdown';
  }
}

function renderRiderGrid(usedInOtherStages, fullyLocked) {
  const search = $('rider-search').value.toLowerCase();
  const teamFilter = $('rider-team-filter').value;

  // Populate team dropdown if empty
  if ($('rider-team-filter').options.length <= 1 && riders.length) {
    const teams = [...new Set(riders.map(r => r.team))].sort();
    $('rider-team-filter').innerHTML = '<option value="">Alle teams</option>' +
      teams.map(t => `<option value="${t}">${t}</option>`).join('');
  }

  const filtered = riders.filter(r =>
    (r.name.toLowerCase().includes(search) || r.team.toLowerCase().includes(search)) &&
    (!teamFilter || r.team === teamFilter)
  );

  $('rider-grid').innerHTML = filtered.length ? filtered.map(r => {
    const used = usedInOtherStages.has(r.id);
    const selected = r.id === selectedRiderId;
    return `
      <div class="col-6 col-md-4 col-lg-3">
        <div class="card pick-card ${selected ? 'selected' : ''} ${used ? 'used' : ''}"
             data-rider-id="${r.id}" ${fullyLocked || used ? '' : `onclick="selectRider(${r.id})"`}>
          <div class="card-body py-2 px-3">
            <div class="d-flex justify-content-between align-items-start">
              <div class="fw-bold" style="font-size:0.88rem;">${escapeHtml(r.name)}</div>
              <span class="bib-badge">${r.bib_number}</span>
            </div>
            <div class="d-flex align-items-center gap-1 mt-1">
              ${teamBadge(r.team)}
            </div>
            ${used ? '<small class="text-danger mt-1 d-block">Al gebruikt</small>' : ''}
          </div>
        </div>
      </div>`;
  }).join('') : '<div class="col-12"><p class="text-muted text-center py-4">Geen renners gevonden</p></div>';
}

function selectRider(riderId) {
  selectedRiderId = riderId;
  const stageId = parseInt($('stage-select').value);
  const compStageIds = new Set(activeStages().map(s => s.id));
  const usedInOtherStages = new Set(
    myPicks.filter(p => p.stage_id !== stageId && compStageIds.has(p.stage_id)).map(p => p.rider_id)
  );
  const stage = stages.find(s => s.id === stageId);
  const isLocked = !stage || stage.locked || new Date() > new Date(stage.deadline);
  const currentPick = myPicks.find(p => p.stage_id === stageId);
  renderRiderGrid(usedInOtherStages, isLocked && !currentPick);
  $('btn-submit-pick').disabled = false;
  updatePickBar(stage, currentPick);
}

let _searchDebounce;
$('rider-search').addEventListener('input', () => {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => renderPickStage(), 150);
});
$('rider-team-filter').addEventListener('change', () => renderPickStage());

// Submit pick via Postgres RPC
$('btn-submit-pick').addEventListener('click', async () => {
  if (!selectedRiderId) return;
  const stageId = parseInt($('stage-select').value);
  const status = $('pick-status');
  try {
    status.textContent = 'Bezig...';
    status.className = 'ms-3 text-muted';
    const result = await supaRpc('submit_pick', { p_stage_id: stageId, p_rider_id: selectedRiderId });
    status.textContent = result.warning || 'Keuze opgeslagen!';
    status.className = result.warning ? 'ms-3 text-warning' : 'ms-3 text-success';
    myPicks = await supaRest('picks', { filters: `user_id=eq.${session.user.id}&order=stage_id` });
    _cache.standings = null; _cache.participants = null;
  } catch (e) {
    status.textContent = e.message;
    status.className = 'ms-3 text-danger';
  }
});

// --- HISTORY ---
async function loadHistory() {
  const compStageIds = new Set(activeStages().map(s => s.id));
  const compPicks = myPicks.filter(p => compStageIds.has(p.stage_id));

  const stageIds = compPicks.map(p => p.stage_id);
  let allResults = [];
  if (stageIds.length) {
    allResults = await supaRest('stage_results', { filters: `stage_id=in.(${stageIds.join(',')})` });
  }

  // Build rows with game_points for coloring
  const rows = compPicks.map(pick => {
    const stage = stages.find(s => s.id === pick.stage_id);
    const rider = riders.find(r => r.id === pick.rider_id);
    const result = allResults.find(r => r.stage_id === pick.stage_id && r.rider_id === pick.rider_id);
    const gp = result && !pick.is_late && !result.dnf ? (result.game_points || 0) : 0;
    let rowClass = '';
    if (result) {
      if (gp >= 70) rowClass = 'history-great';
      else if (gp >= 20) rowClass = 'history-good';
      else if (gp === 0 && (result.dnf || pick.is_late)) rowClass = 'history-bad';
    }
    return { pick, stage, rider, result, gp, rowClass };
  });

  // Stats
  const withResults = rows.filter(r => r.result);
  if (withResults.length) {
    const best = withResults.reduce((a, b) => a.gp >= b.gp ? a : b);
    const worst = withResults.reduce((a, b) => a.gp <= b.gp ? a : b);
    const totalGp = withResults.reduce((s, r) => s + r.gp, 0);
    const avg = Math.round(totalGp / withResults.length);
    $('history-stats').innerHTML = `
      <div class="col-4"><div class="card"><div class="card-body py-2 px-3 text-center">
        <div class="text-muted" style="font-size:0.7rem;">Beste etappe</div>
        <div style="font-size:1.1rem; font-weight:700; color:var(--green);">${best.gp} pts</div>
        <div style="font-size:0.75rem;">${best.rider?.name || '?'}</div>
      </div></div></div>
      <div class="col-4"><div class="card"><div class="card-body py-2 px-3 text-center">
        <div class="text-muted" style="font-size:0.7rem;">Gemiddeld</div>
        <div style="font-size:1.1rem; font-weight:700;">${avg} pts</div>
        <div style="font-size:0.75rem;">${withResults.length} etappes</div>
      </div></div></div>
      <div class="col-4"><div class="card"><div class="card-body py-2 px-3 text-center">
        <div class="text-muted" style="font-size:0.7rem;">Slechtste etappe</div>
        <div style="font-size:1.1rem; font-weight:700; color:var(--red);">${worst.gp} pts</div>
        <div style="font-size:0.75rem;">${worst.rider?.name || '?'}</div>
      </div></div></div>`;
  } else {
    $('history-stats').innerHTML = '';
  }

  $('history-table').innerHTML = rows.map(({ pick, stage, rider, result, gp, rowClass }) =>
    `<tr class="${rowClass}">
      <td>Etappe ${stage?.stage_number || '?'}</td>
      <td>${rider?.name || '?'} ${rider ? teamBadge(rider.team) : ''}</td>
      <td class="time text-end">${result ? formatTime(result.time_seconds) : '-'}</td>
      <td class="text-end">${result ? (pick.is_late ? '0' : result.points) : '-'}</td>
      <td class="text-end">${result ? (pick.is_late ? '0' : result.mountain_points) : '-'}</td>
      <td class="text-end">${gp}</td>
      <td>${pick.is_late ? '<span class="badge bg-warning">Te laat</span>' : ''}${pick.is_random ? '<span class="badge bg-info">🎡 Rad</span>' : ''}</td>
    </tr>`
  ).join('') || `<tr><td colspan="7">
    <div class="empty-state">
      <div class="empty-state-icon">🎯</div>
      <div class="empty-state-text">Nog geen keuzes gemaakt.<br>Ga naar de Keuze tab om je eerste renner te kiezen!</div>
    </div></td></tr>`;
}

// --- DEELNEMERS (picks van iedereen, zichtbaar na deadline) ---
// --- PELOTON: alle gebruikers met wielren-rollen ---
function getPelotonRole(p, totalPicks) {
  if (p.is_admin) return { name: 'Ploegleider', badge: 'bg-danger', icon: '🚗' };
  if (totalPicks >= 15) return { name: 'Kopman', badge: 'bg-warning text-dark', icon: '👑' };
  if (totalPicks >= 5) return { name: 'Luitenant', badge: 'bg-primary', icon: '⭐' };
  if (totalPicks >= 1) return { name: 'Knecht', badge: 'bg-success', icon: '💪' };
  return { name: 'Stagiair', badge: 'bg-secondary', icon: '🚲' };
}

async function loadPeloton() {
  const allProfiles = await supaRest('profiles', { filters: 'order=created_at' });
  const allPicks = await supaRest('picks', { select: 'user_id' });
  const isAdmin = profile?.is_admin;

  // Show admin columns
  const emailCol = $('peloton-email-col');
  const actionsCol = $('peloton-actions-col');
  if (emailCol) emailCol.style.display = isAdmin ? '' : 'none';
  if (actionsCol) actionsCol.style.display = isAdmin ? '' : 'none';

  // Count picks per user
  const pickCounts = {};
  allPicks.forEach(p => { pickCounts[p.user_id] = (pickCounts[p.user_id] || 0) + 1; });

  $('peloton-table').innerHTML = allProfiles.filter(p => p.is_active !== false).map(p => {
    const role = getPelotonRole(p, pickCounts[p.id] || 0);
    return `<tr>
      <td>${escapeHtml(p.display_name)}</td>
      ${isAdmin ? `<td style="font-size:0.8rem;">${escapeHtml(p.email || '-')}</td>` : ''}
      <td><span class="badge ${role.badge}">${role.icon} ${role.name}</span></td>
      <td>${new Date(p.created_at).toLocaleDateString('nl-NL')}</td>
      ${isAdmin ? `<td>
        <button class="btn btn-sm btn-outline-${p.is_admin ? 'secondary' : 'danger'}"
                onclick="toggleAdmin('${p.id}', ${!p.is_admin})">
          ${p.is_admin ? 'Degradeer' : 'Promoveer'}
        </button>
      </td>` : ''}
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="text-muted">Nog geen renners in het peloton</td></tr>';
}

window.toggleAdmin = async function(userId, makeAdmin) {
  try {
    await supaPatch('profiles', `id=eq.${userId}`, { is_admin: makeAdmin });
    loadPeloton();
  } catch (e) { alert(e.message); }
};

async function loadParticipants() {
  if (!activeCompId) {
    $('participants-content').innerHTML = '<p class="text-muted">Geen ronde geselecteerd</p>';
    return;
  }

  // Fetch public picks (view only shows locked/past-deadline stages) — cached
  let allPicks;
  if (_cache.participantsCompId === activeCompId && _cache.participants) {
    allPicks = _cache.participants;
  } else {
    allPicks = await supaRest('stage_picks_public', {
      filters: `competition_id=eq.${activeCompId}&order=stage_number.desc,display_name`
    });
    _cache.participants = allPicks;
    _cache.participantsCompId = activeCompId;
  }

  if (!allPicks.length) {
    $('participants-content').innerHTML = '<p class="text-muted">Nog geen keuzes zichtbaar. Keuzes worden getoond na de deadline.</p>';
    return;
  }

  // Group by stage
  const byStage = {};
  allPicks.forEach(p => {
    if (!byStage[p.stage_number]) byStage[p.stage_number] = { picks: [], stage_id: p.stage_id };
    byStage[p.stage_number].picks.push(p);
  });

  const stageNums = Object.keys(byStage).map(Number).sort((a, b) => b - a);

  const mode = activeScoringMode();
  const isClassic = mode === 'classic';

  $('participants-content').innerHTML = stageNums.map(num => {
    const { picks } = byStage[num];
    const stageName = picks[0] ? `Etappe ${num}` : `Etappe ${num}`;
    const header = isClassic
      ? '<tr><th>Speler</th><th>Renner</th><th class="text-end">Positie</th><th class="text-end">Spel</th><th class="text-end">Delen</th><th>Status</th></tr>'
      : '<tr><th>Speler</th><th>Renner</th><th class="text-end">Tijd</th><th class="text-end">Pts</th><th class="text-end">Berg</th><th>Status</th></tr>';
    return `
      <div class="card mb-3">
        <div class="card-header">
          <h6 class="mb-0" style="font-size:0.9rem;">${stageName}</h6>
        </div>
        <div class="card-body p-0">
          <table class="table table-sm mb-0">
            <thead>${header}</thead>
            <tbody>
              ${picks.map(p => {
                const sharingPct = p.num_pickers <= 1 ? 100 : p.num_pickers === 2 ? 80 : p.num_pickers === 3 ? 60 : p.num_pickers === 4 ? 40 : 20;
                if (isClassic) {
                  return `<tr>
                  <td>${escapeHtml(p.display_name)}</td>
                  <td>${escapeHtml(p.rider_name)} ${teamBadge(p.rider_team)}</td>
                  <td class="text-end">${p.finish_position || '-'}</td>
                  <td class="text-end">${p.effective_game_points != null ? p.effective_game_points : '-'}</td>
                  <td class="text-end">${p.num_pickers > 1 ? '<span class="badge bg-secondary">' + sharingPct + '%</span>' : ''}</td>
                  <td>${p.is_late ? '<span class="badge bg-warning">Te laat</span>' : ''}${p.is_random ? '<span class="badge bg-info">🎡 Rad</span>' : ''}${p.dnf ? '<span class="badge bg-danger">DNF</span>' : ''}</td>
                </tr>`;
                }
                return `<tr>
                <td>${escapeHtml(p.display_name)}</td>
                <td>${escapeHtml(p.rider_name)} ${teamBadge(p.rider_team)}</td>
                <td class="time text-end">${p.time_seconds ? formatTime(p.time_seconds) : '-'}</td>
                <td class="text-end">${p.points != null ? (p.is_late ? '0' : p.points) : '-'}</td>
                <td class="text-end">${p.mountain_points != null ? (p.is_late ? '0' : p.mountain_points) : '-'}</td>
                <td>${p.is_late ? '<span class="badge bg-warning">Te laat</span>' : ''}${p.is_random ? '<span class="badge bg-info">🎡 Rad</span>' : ''}${p.dnf ? '<span class="badge bg-danger">DNF</span>' : ''}</td>
              </tr>`}).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }).join('');
}

// =====================
// ADMIN PANEL
// =====================

async function loadAdminView() {
  await Promise.all([
    loadAdminUsers(),
    loadAdminCompetitions(),
    loadAdminRiders(),
    loadAdminStages(),
  ]);
  loadImportCompSelect();
  loadAdminResults();
}

// --- ADMIN: GEBRUIKERS ---
async function loadAdminUsers() {
  const allProfiles = await supaRest('profiles', { filters: 'order=created_at' });
  $('user-count').textContent = `${allProfiles.length} spelers`;
  $('admin-users-table').innerHTML = allProfiles.map(p => {
    const isSelf = p.id === profile?.id;
    return `<tr style="${p.is_active === false ? 'opacity:0.5;' : ''}">
      <td>${escapeHtml(p.display_name)}</td>
      <td>
        ${p.is_admin ? '<span class="badge bg-danger">Admin</span>' : ''}
        ${p.is_active === false ? '<span class="badge bg-secondary">Inactief</span>' : '<span class="badge bg-success">Actief</span>'}
      </td>
      <td>${new Date(p.created_at).toLocaleDateString('nl-NL')}</td>
      <td>
        <div class="d-flex gap-1 flex-wrap">
          <button class="btn btn-sm btn-outline-${p.is_admin ? 'secondary' : 'danger'}"
                  onclick="toggleAdmin('${p.id}', ${!p.is_admin})" ${isSelf ? 'disabled' : ''}>
            ${p.is_admin ? 'Degradeer' : 'Maak admin'}
          </button>
          <button class="btn btn-sm btn-outline-${p.is_active === false ? 'success' : 'warning'}"
                  onclick="togglePlayerActive('${p.id}', ${p.is_active === false})" ${isSelf ? 'disabled' : ''}>
            ${p.is_active === false ? 'Activeer' : 'Deactiveer'}
          </button>
          <button class="btn btn-sm btn-outline-info"
                  onclick="resetPassword('${escapeHtml(p.email || '')}')">
            Reset ww
          </button>
          <button class="btn btn-sm btn-outline-danger"
                  onclick="deletePlayer('${p.id}', '${escapeHtml(p.display_name)}')" ${isSelf ? 'disabled' : ''}>
            Verwijder
          </button>
        </div>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" class="text-muted">Geen gebruikers</td></tr>';
}

window.togglePlayerActive = async function(userId, activate) {
  try {
    await supaPatch('profiles', `id=eq.${userId}`, { is_active: activate });
    loadAdminUsers();
    loadPeloton();
  } catch (e) { alert(e.message); }
};

window.deletePlayer = async function(userId, displayName) {
  if (!confirm(`Weet je zeker dat je "${displayName}" wilt verwijderen? Dit verwijdert ook alle keuzes van deze speler.`)) return;
  try {
    await supaRpc('admin_delete_player', { p_user_id: userId });
    loadAdminUsers();
    loadPeloton();
  } catch (e) { alert(e.message); }
};

window.resetPassword = async function(email) {
  if (!email) { alert('Geen e-mailadres bekend voor deze speler'); return; }
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error('Verzenden mislukt');
    alert(`Herstelmail verzonden naar ${email}`);
  } catch (e) { alert(e.message); }
};

$('btn-admin-create-user').addEventListener('click', async () => {
  const name = $('new-user-name').value.trim();
  const email = $('new-user-email').value.trim();
  const password = $('new-user-password').value;
  const status = $('admin-create-user-status');
  if (!name || !email || !password) { status.textContent = 'Vul alle velden in'; status.className = 'text-danger'; return; }
  if (password.length < 6) { status.textContent = 'Wachtwoord moet minimaal 6 tekens zijn'; status.className = 'text-danger'; return; }
  try {
    status.textContent = 'Aanmaken...';
    status.className = 'text-muted';
    await signup(email, password, name);
    status.textContent = `✅ ${name} aangemaakt!`;
    status.className = 'text-success';
    $('new-user-name').value = '';
    $('new-user-email').value = '';
    $('new-user-password').value = '';
    loadAdminUsers();
  } catch (e) {
    status.textContent = e.message;
    status.className = 'text-danger';
  }
});

// toggleAdmin is defined in the peloton section

// --- ADMIN: COMPETITIES ---
async function loadAdminCompetitions() {
  competitions = await supaRest('competitions', { filters: 'order=year.desc,name' });

  const sel = $('comp-select');
  const currentVal = sel.value;
  sel.innerHTML = competitions.map(c =>
    `<option value="${c.id}" ${c.is_active ? 'selected' : ''}>${c.country_flag || ''} ${c.name}</option>`
  ).join('');
  if (currentVal) sel.value = currentVal;

  $('admin-comp-table').innerHTML = competitions.map(c => `
    <tr>
      <td>
        <input type="text" class="form-control form-control-sm comp-name-input" value="${escapeHtml(c.name)}"
               data-comp-id="${c.id}" style="min-width:140px;" onchange="renameComp(${c.id}, this.value)">
      </td>
      <td>${c.year}</td>
      <td>
        <select class="form-select form-select-sm" style="min-width:110px;"
                onchange="updateCompField(${c.id}, 'scoring_mode', this.value)">
          <option value="grand_tour" ${c.scoring_mode !== 'classic' ? 'selected' : ''}>Grote ronde</option>
          <option value="classic" ${c.scoring_mode === 'classic' ? 'selected' : ''}>Klassieker</option>
        </select>
      </td>
      <td>
        <input type="color" class="form-control form-control-color" value="${c.color || '#facc15'}"
               style="width:32px; height:28px; padding:2px;" onchange="updateCompField(${c.id}, 'color', this.value)">
      </td>
      <td>
        <input type="text" class="form-control form-control-sm" value="${c.country_flag || ''}"
               placeholder="🇫🇷" style="width:45px; text-align:center;" maxlength="4"
               onchange="updateCompField(${c.id}, 'country_flag', this.value)">
      </td>
      <td>
        <input type="url" class="form-control form-control-sm" value="${escapeHtml(c.pcs_url || '')}"
               placeholder="PCS URL" style="min-width:140px; font-size:0.75rem;"
               onchange="updateCompPcsUrl(${c.id}, this.value)">
      </td>
      <td>
        <div class="form-check form-switch d-inline-block">
          <input class="form-check-input" type="checkbox" ${c.is_active ? 'checked' : ''}
                 onchange="toggleCompActive(${c.id}, this.checked)">
        </div>
      </td>
      <td>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteComp(${c.id})">Verwijder</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="8" class="text-muted">Geen rondes</td></tr>';
}

window.updateCompField = async function(compId, field, value) {
  try {
    await supaPatch('competitions', `id=eq.${compId}`, { [field]: value || null });
    const comp = competitions.find(c => c.id === compId);
    if (comp) comp[field] = value;
    if (field === 'color' || field === 'country_flag') {
      updateCompBanner();
      applyCompColor();
    }
    if (field === 'scoring_mode') {
      _cache.standings = null;
      _cache.participants = null;
      loadStandings();
    }
  } catch (e) { alert(e.message); }
};

window.updateCompPcsUrl = async function(compId, pcsUrl) {
  try {
    await supaPatch('competitions', `id=eq.${compId}`, { pcs_url: pcsUrl.trim() || null });
  } catch (e) { alert(e.message); }
};

$('btn-add-comp').addEventListener('click', async () => {
  const name = $('new-comp-name').value.trim();
  const slug = $('new-comp-slug').value.trim();
  const year = parseInt($('new-comp-year').value);
  if (!name || !slug || !year) return alert('Vul alle velden in');
  try {
    const scoringMode = $('new-comp-scoring-mode').value || 'grand_tour';
    const pcsUrl = $('new-comp-pcs-url').value.trim() || null;
    const color = $('new-comp-color').value || '#facc15';
    const flag = $('new-comp-flag').value.trim() || '';
    await supaRest('competitions', { method: 'POST', body: { name, slug, competition_type: scoringMode === 'classic' ? 'classic' : 'tour', year, is_active: false, scoring_mode: scoringMode, pcs_url: pcsUrl, color, country_flag: flag } });
    $('new-comp-name').value = '';
    $('new-comp-slug').value = '';
    $('new-comp-pcs-url').value = '';
    $('new-comp-color').value = '#facc15';
    $('new-comp-flag').value = '';
    loadAdminCompetitions();
    loadAdminStages();
  } catch (e) { alert(e.message); }
});

window.renameComp = async function(compId, newName) {
  newName = newName.trim();
  if (!newName) return alert('Naam mag niet leeg zijn');
  try {
    await supaPatch('competitions', `id=eq.${compId}`, { name: newName });
    loadAdminCompetitions();
  } catch (e) { alert(e.message); }
};

window.toggleCompActive = async function(compId, active) {
  try {
    await supaPatch('competitions', `id=eq.${compId}`, { is_active: active });
    loadAdminCompetitions();
  } catch (e) { alert(e.message); }
};

window.deleteComp = async function(compId) {
  if (!confirm('Weet je het zeker? Dit verwijdert de ronde.')) return;
  try {
    await supaDelete('competitions', `id=eq.${compId}`);
    loadAdminCompetitions();
  } catch (e) { alert(e.message); }
};

// --- ADMIN: RENNERS ---
let allRiders = [];

async function loadAdminRiders() {
  allRiders = await supaRest('riders', { filters: 'order=bib_number' });

  const sel = $('admin-rider-comp-filter');
  const current = sel.value;
  sel.innerHTML = '<option value="">Alle rondes</option>' +
    competitions.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  if (current) sel.value = current;

  renderAdminRiders();
}

function renderAdminRiders(filter = '') {
  const compFilter = $('admin-rider-comp-filter').value;
  let list = compFilter ? allRiders.filter(r => r.competition_id == compFilter) : allRiders;
  const filtered = filter
    ? list.filter(r => r.name.toLowerCase().includes(filter) || r.team.toLowerCase().includes(filter))
    : list;

  $('admin-riders-table').innerHTML = filtered.map(r => `
    <tr>
      <td>${r.bib_number}</td>
      <td>${r.name}</td>
      <td>${teamBadge(r.team)} ${r.team}</td>
      <td>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteRider(${r.id})">Verwijder</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="text-muted">Geen renners gevonden</td></tr>';
}

$('admin-rider-comp-filter').addEventListener('change', () => {
  renderAdminRiders($('admin-rider-search').value.toLowerCase());
});

$('admin-rider-search').addEventListener('input', (e) => {
  renderAdminRiders(e.target.value.toLowerCase());
});

$('btn-add-rider').addEventListener('click', async () => {
  const bib = parseInt($('new-rider-bib').value);
  const name = $('new-rider-name').value.trim();
  const team = $('new-rider-team').value.trim();
  const compId = parseInt($('admin-rider-comp-filter').value) || activeCompId;
  if (!bib || !name || !team) return alert('Vul alle velden in');
  if (!compId) return alert('Selecteer eerst een ronde');
  try {
    await supaRest('riders', { method: 'POST', body: { bib_number: bib, name, team, competition_id: compId } });
    $('new-rider-bib').value = '';
    $('new-rider-name').value = '';
    $('new-rider-team').value = '';
    loadAdminRiders();
  } catch (e) { alert(e.message); }
});

window.deleteRider = async function(riderId) {
  if (!confirm('Renner verwijderen?')) return;
  try {
    await supaDelete('riders', `id=eq.${riderId}`);
    loadAdminRiders();
  } catch (e) { alert(e.message); }
};

// --- ADMIN: ETAPPES ---
async function loadAdminStages() {
  stages = await supaRest('stages', { filters: 'order=stage_number' });

  $('new-stage-comp').innerHTML = competitions.map(c =>
    `<option value="${c.id}">${c.name}</option>`
  ).join('');

  const typeLabels = { flat: 'Vlak', mountain: 'Berg', tt: 'Tijdrit', sprint: 'Sprint' };

  $('admin-stages-table').innerHTML = stages.map(s => {
    const comp = competitions.find(c => c.id === s.competition_id);
    return `<tr>
      <td>${s.stage_number}</td>
      <td>${s.name}</td>
      <td>${comp ? comp.name : '<span class="text-muted">-</span>'}</td>
      <td>${new Date(s.date).toLocaleDateString('nl-NL')}</td>
      <td>${s.start_time ? new Date(s.start_time).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
      <td>${typeLabels[s.stage_type] || s.stage_type}</td>
      <td>${s.locked
        ? '<span class="badge bg-secondary">Vergrendeld</span>'
        : '<span class="badge bg-success">Open</span>'}</td>
      <td>
        <button class="btn btn-sm btn-outline-${s.locked ? 'success' : 'warning'}"
                onclick="toggleStageLock(${s.id}, ${!s.locked})">
          ${s.locked ? 'Ontgrendel' : 'Vergrendel'}
        </button>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteStage(${s.id})">Verwijder</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="text-muted">Geen etappes</td></tr>';
}

$('btn-add-stage').addEventListener('click', async () => {
  const num = parseInt($('new-stage-num').value);
  const name = $('new-stage-name').value.trim();
  const date = $('new-stage-date').value;
  const startTime = $('new-stage-starttime').value || '12:00';
  const type = $('new-stage-type').value;
  const compId = parseInt($('new-stage-comp').value);
  if (!num || !name || !date || !compId) return alert('Vul alle velden in');

  const startDateTime = new Date(`${date}T${startTime}:00`);

  try {
    await supaRest('stages', {
      method: 'POST',
      body: { stage_number: num, name, date, stage_type: type, start_time: startDateTime.toISOString(), deadline: startDateTime.toISOString(), locked: false, competition_id: compId },
    });
    $('new-stage-num').value = '';
    $('new-stage-name').value = '';
    $('new-stage-date').value = '';
    loadAdminStages();
  } catch (e) { alert(e.message); }
});

window.toggleStageLock = async function(stageId, lock) {
  try {
    await supaPatch('stages', `id=eq.${stageId}`, { locked: lock });
    loadAdminStages();
  } catch (e) { alert(e.message); }
};

window.deleteStage = async function(stageId) {
  if (!confirm('Etappe verwijderen?')) return;
  try {
    await supaDelete('stages', `id=eq.${stageId}`);
    loadAdminStages();
  } catch (e) { alert(e.message); }
};

// --- ADMIN: PCS RESULTS via console script ---
const PCS_RESULTS_SCRIPT = `// Plak dit in de console op een PCS etappe-resultaten pagina
(() => {
  const table = document.querySelector('table.results');
  if (!table) { console.log('Geen resultaten-tabel gevonden!'); return; }
  const rows = table.querySelectorAll('tbody tr');
  const results = [];
  let lastTime = '';
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length < 8) return;
    let bib = 0, time = '', pts = 0, dnf = false;
    cells.forEach(c => {
      const cls = c.className || '';
      const txt = c.textContent?.trim() || '';
      if (cls.includes('bibs')) bib = parseInt(txt) || 0;
      if (cls.includes('time') && cls.includes('ar')) {
        const font = c.querySelector('font');
        const t = font?.textContent?.trim() || txt;
        if (t.match(/DNF|DNS|OTL/i)) { dnf = true; }
        else if (t.match(/\\d+:\\d+/)) { time = t; lastTime = t; }
        else { time = lastTime; }
      }
      if (cls.includes('pnt') && !cls.includes('uci')) pts = parseInt(txt) || 0;
    });
    if (bib > 0) results.push(bib + ',' + time + ',' + pts + ',' + (dnf ? 'DNF' : ''));
  });
  copy('---RESULTATEN---\\n' + results.join('\\n'));
  console.log(results.length + ' resultaten gekopieerd naar clipboard!');
})();`;

function loadSyncStageSelect() {
  const compStages = activeStages();
  const sel = $('sync-stage-select');
  sel.innerHTML = compStages.map(s =>
    `<option value="${s.id}">Etappe ${s.stage_number}: ${s.name}</option>`
  ).join('');
}

// --- PCS DIRECTE SYNC ---
async function callEdgeFunction(fnName, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Fout ${res.status}`);
  return data;
}

$('btn-pcs-sync-race').addEventListener('click', async () => {
  const compId = parseInt($('race-sync-comp').value);
  const comp = competitions.find(c => c.id === compId);
  const status = $('pcs-sync-status');
  const log = $('pcs-sync-log');

  if (!comp) { status.textContent = 'Kies een ronde'; status.className = 'text-danger'; return; }
  if (!comp.pcs_url) { status.textContent = 'Stel eerst een PCS URL in bij de ronde'; status.className = 'text-danger'; return; }

  status.textContent = '⏳ Bezig met ophalen van PCS...';
  status.className = 'text-muted';
  log.innerHTML = '';

  try {
    const result = await callEdgeFunction('sync-pcs-race', {
      pcs_url: comp.pcs_url,
      competition_id: compId,
    });

    if (result.shirts && Object.keys(result.shirts).length) {
      const existingShirts = JSON.parse(localStorage.getItem('bagagedrager_shirts') || '{}');
      localStorage.setItem('bagagedrager_shirts', JSON.stringify({ ...existingShirts, ...result.shirts }));
    }

    status.textContent = '✅ Sync voltooid!';
    status.className = 'text-success';
    log.innerHTML = (result.log || []).join('<br>');

    loadAdminStages();
    loadAdminRiders();
    await loadRidersForComp();
  } catch (e) {
    status.textContent = e.message;
    status.className = 'text-danger';
  }
});

$('btn-pcs-sync-results').addEventListener('click', async () => {
  const stageId = parseInt($('sync-stage-select').value);
  const stage = stages.find(s => s.id === stageId);
  const status = $('pcs-results-sync-status');
  const log = $('pcs-results-sync-log');

  if (!stage) { status.textContent = 'Kies een etappe'; status.className = 'text-danger'; return; }

  const comp = competitions.find(c => c.id === stage.competition_id);
  if (!comp?.pcs_url) { status.textContent = 'Geen PCS URL ingesteld voor deze ronde'; status.className = 'text-danger'; return; }

  const pcsUrl = comp.pcs_url.replace(/\/$/, '').replace(/\/(stages|startlist|gc|stage-\d+)$/, '') + '/stage-' + stage.stage_number;

  status.textContent = '⏳ Resultaten ophalen van PCS...';
  status.className = 'text-muted';
  log.innerHTML = '';

  try {
    const data = await callEdgeFunction('sync-pcs-results', { pcs_url: pcsUrl });

    if (!data.results?.length) {
      status.textContent = 'Geen resultaten gevonden op PCS';
      status.className = 'text-warning';
      return;
    }

    // Match bib numbers to rider IDs
    let matched = 0, unmatched = 0;
    const payload = [];
    for (const r of data.results) {
      const rider = riders.find(rd => rd.bib_number === r.bib_number);
      if (rider) {
        matched++;
        payload.push({ rider_id: rider.id, time_seconds: r.time_seconds, points: r.points, mountain_points: r.mountain_points, dnf: r.dnf });
      } else { unmatched++; }
    }

    if (!matched) {
      status.textContent = `Geen renners gekoppeld (${unmatched} onbekende bibnummers)`;
      status.className = 'text-danger';
      return;
    }

    status.textContent = `⏳ ${matched} resultaten opslaan...`;
    await supaRpc('admin_save_results', { p_stage_id: stageId, p_results: payload });

    status.textContent = `✅ ${matched} resultaten opgeslagen!` + (unmatched ? ` (${unmatched} onbekend)` : '');
    status.className = 'text-success';

    // Show top 10
    const top10 = payload.slice(0, 10);
    log.innerHTML = `<strong>Top 10:</strong><br>` + top10.map((r, i) => {
      const rider = riders.find(rd => rd.id === r.rider_id);
      return `${i + 1}. ${rider?.name || '?'} — ${formatTime(r.time_seconds)}${r.dnf ? ' (DNF)' : ''}`;
    }).join('<br>');

    loadAdminResults();
  } catch (e) {
    status.textContent = e.message;
    status.className = 'text-danger';
  }
});

$('btn-copy-results-script').addEventListener('click', () => {
  navigator.clipboard.writeText(PCS_RESULTS_SCRIPT);
  $('btn-copy-results-script').textContent = '✅ Gekopieerd!';
  setTimeout(() => { $('btn-copy-results-script').textContent = '📋 Kopieer resultaten-script'; }, 2000);
});

function parseTimeToSeconds(timeStr) {
  const clean = timeStr.replace(/[^0-9:]/g, '').trim();
  if (!clean) return 0;
  const parts = clean.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

$('btn-import-results').addEventListener('click', async () => {
  const raw = $('results-sync-data').value.trim();
  const stageId = parseInt($('sync-stage-select').value);
  const status = $('results-sync-status');
  const preview = $('results-sync-preview');

  if (!raw) { status.textContent = 'Plak eerst data'; status.className = 'text-danger'; return; }
  if (!stageId) { status.textContent = 'Selecteer een etappe'; status.className = 'text-danger'; return; }

  const text = raw.replace('---RESULTATEN---', '').trim();
  const lines = text.split('\n').filter(l => l.trim());

  // Parse results: bib,time,pts,DNF
  const parsed = lines.map(line => {
    const parts = line.split(',');
    if (parts.length < 2) return null;
    const bib = parseInt(parts[0].trim());
    const time = parseTimeToSeconds(parts[1].trim());
    const pts = parseInt(parts[2]?.trim()) || 0;
    const dnf = (parts[3]?.trim() || '').toUpperCase() === 'DNF';
    if (!bib) return null;
    return { bib_number: bib, time_seconds: time, points: pts, mountain_points: 0, dnf };
  }).filter(Boolean);

  if (!parsed.length) { status.textContent = 'Geen geldige resultaten gevonden'; status.className = 'text-danger'; return; }

  // Match to riders
  let matched = 0, unmatched = 0;
  const payload = [];
  for (const r of parsed) {
    const rider = riders.find(rd => rd.bib_number === r.bib_number);
    if (rider) {
      matched++;
      payload.push({ rider_id: rider.id, time_seconds: r.time_seconds, points: r.points, mountain_points: r.mountain_points, dnf: r.dnf });
    } else { unmatched++; }
  }

  if (!matched) { status.textContent = `Geen renners gekoppeld (${unmatched} onbekende bibnummers)`; status.className = 'text-danger'; return; }

  status.textContent = `⏳ ${matched} resultaten opslaan...`;
  status.className = 'text-muted';

  try {
    await supaRpc('admin_save_results', { p_stage_id: stageId, p_results: payload });
    status.textContent = `✅ ${matched} resultaten opgeslagen!` + (unmatched ? ` (${unmatched} onbekend)` : '');
    status.className = 'text-success';

    // Preview top 10
    const top10 = payload.slice(0, 10);
    preview.innerHTML = `<table class="table table-sm mb-0">
      <thead><tr><th>Renner</th><th>Tijd</th><th>Pts</th><th>DNF</th></tr></thead>
      <tbody>${top10.map(r => {
        const rider = riders.find(rd => rd.id === r.rider_id);
        return `<tr>
          <td>${rider ? escapeHtml(rider.name) : '?'}</td>
          <td class="time">${formatTime(r.time_seconds)}</td>
          <td>${r.points}</td>
          <td>${r.dnf ? '⚠️' : ''}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
  } catch (e) {
    status.textContent = `❌ ${e.message}`;
    status.className = 'text-danger';
  }
});

// --- ADMIN: RESULTATEN (via Postgres RPC) ---
async function loadAdminResults() {
  const compStages = activeStages();
  loadSyncStageSelect();
  const sel = $('admin-stage-select');
  sel.innerHTML = compStages.map(s =>
    `<option value="${s.id}">Etappe ${s.stage_number}: ${s.name}</option>`
  ).join('');
  sel.onchange = renderAdminResultsForm;
  renderAdminResultsForm();
}

function renderAdminResultsForm() {
  const stageId = parseInt($('admin-stage-select').value);
  if (!stageId) {
    $('admin-results-form').innerHTML = '<p class="text-muted">Geen etappes beschikbaar</p>';
    return;
  }

  $('admin-results-form').innerHTML = `
    <div class="table-responsive" style="max-height:400px; overflow-y:auto;">
      <table class="table table-sm">
        <thead><tr><th>Renner</th><th>Tijd (sec)</th><th>Pts</th><th>Berg Pts</th><th>DNF</th></tr></thead>
        <tbody>
          ${riders.map(r => `
            <tr data-rider-id="${r.id}">
              <td>${r.name} ${teamBadge(r.team)}</td>
              <td><input type="number" class="form-control form-control-sm res-time" value="0" min="0" /></td>
              <td><input type="number" class="form-control form-control-sm res-pts" value="0" min="0" /></td>
              <td><input type="number" class="form-control form-control-sm res-mt" value="0" min="0" /></td>
              <td><input type="checkbox" class="form-check-input res-dnf" /></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
  loadExistingResults(stageId);
}

async function loadExistingResults(stageId) {
  try {
    const results = await supaRest('stage_results', { filters: `stage_id=eq.${stageId}` });
    for (const r of results) {
      const row = document.querySelector(`#admin-results-form tr[data-rider-id="${r.rider_id}"]`);
      if (!row) continue;
      row.querySelector('.res-time').value = r.time_seconds;
      row.querySelector('.res-pts').value = r.points;
      row.querySelector('.res-mt').value = r.mountain_points;
      row.querySelector('.res-dnf').checked = r.dnf;
    }
  } catch (e) { /* no results yet */ }
}

$('btn-save-results').addEventListener('click', async () => {
  const stageId = parseInt($('admin-stage-select').value);
  const rows = document.querySelectorAll('#admin-results-form tr[data-rider-id]');
  const results = [];
  rows.forEach(row => {
    const time = parseInt(row.querySelector('.res-time').value) || 0;
    const pts = parseInt(row.querySelector('.res-pts').value) || 0;
    const mt = parseInt(row.querySelector('.res-mt').value) || 0;
    const dnf = row.querySelector('.res-dnf').checked;
    if (time > 0 || pts > 0 || mt > 0 || dnf) {
      results.push({ rider_id: parseInt(row.dataset.riderId), time_seconds: time, points: pts, mountain_points: mt, dnf });
    }
  });

  const status = $('admin-status');
  try {
    status.textContent = 'Opslaan...';
    status.className = 'ms-3 text-muted';
    const res = await supaRpc('admin_save_results', { p_stage_id: stageId, p_results: results });
    status.textContent = `${res.count} resultaten opgeslagen!`;
    status.className = 'ms-3 text-success';
  } catch (e) {
    status.textContent = e.message;
    status.className = 'ms-3 text-danger';
  }
});

// =====================
// ADMIN: IMPORT
// =====================

// --- PCS CONSOLE SCRIPTS ---
const PCS_STAGES_SCRIPT = `// Plak dit in de console op een PCS /stages pagina
(() => {
  const rows = document.querySelectorAll('table.basic tbody tr');
  const stages = [];
  const year = location.pathname.match(/(\\d{4})/)?.[1] || new Date().getFullYear();
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length < 4) return;
    const dateText = cells[0]?.textContent?.trim() || '';
    const link = cells[3]?.querySelector('a');
    const name = link?.textContent?.trim() || '';
    if (!name || name.toLowerCase().includes('rest') || !link?.getAttribute('href')) return;
    const m = name.match(/Stage\\s+(\\d+)/i);
    if (!m) return;
    const icon = cells[2]?.querySelector('span')?.className || '';
    let type = 'flat';
    if (name.includes('ITT') || name.includes('(TT)')) type = 'tt';
    else if (icon.includes('p5') || icon.includes('p4') || icon.includes('p3')) type = 'mountain';
    else if (icon.includes('p2')) type = 'sprint';
    const dp = dateText.split('/');
    const date = dp.length === 2 ? year + '-' + dp[1].padStart(2,'0') + '-' + dp[0].padStart(2,'0') : '';
    const route = name.includes('|') ? name.split('|')[1].trim() : name;
    stages.push(m[1] + ', ' + route + ', ' + date + ', ' + type);
  });
  copy('---ETAPPES---\\n' + stages.join('\\n'));
  console.log(stages.length + ' etappes gekopieerd naar clipboard!');
})();`;

// Copy script buttons
$('btn-copy-stages-script').addEventListener('click', () => {
  navigator.clipboard.writeText(PCS_STAGES_SCRIPT);
  $('btn-copy-stages-script').textContent = '✅ Gekopieerd!';
  setTimeout(() => { $('btn-copy-stages-script').textContent = '📅 Kopieer etappes-script'; }, 2000);
});

$('btn-copy-riders-script').addEventListener('click', () => {
  navigator.clipboard.writeText(PCS_SCRIPT);
  $('btn-copy-riders-script').textContent = '✅ Gekopieerd!';
  setTimeout(() => { $('btn-copy-riders-script').textContent = '🚴 Kopieer renners-script'; }, 2000);
});

// Universal import: detect data type and import
$('btn-race-import').addEventListener('click', async () => {
  const raw = $('race-sync-data').value.trim();
  const compId = parseInt($('race-sync-comp').value);
  const status = $('race-sync-status');
  const log = $('race-sync-log');

  if (!raw) { status.textContent = 'Plak eerst data'; status.className = 'text-danger'; return; }
  if (!compId) { status.textContent = 'Selecteer een ronde'; status.className = 'text-danger'; return; }

  status.textContent = '⏳ Importeren...';
  status.className = 'text-muted';
  log.innerHTML = '';
  const lines = [];

  // Detect and import stages
  if (raw.includes('---ETAPPES---')) {
    const stageText = raw.split('---ETAPPES---')[1].split('---')[0].trim();
    const parsed = parseStageLines(stageText);
    if (parsed.length) {
      let ok = 0, skip = 0;
      for (const s of parsed) {
        const startDateTime = new Date(`${s.date}T${s.start_time || '12:00'}:00`);
        try {
          await supaRest('stages', {
            method: 'POST',
            body: { ...s, start_time: startDateTime.toISOString(), deadline: startDateTime.toISOString(), locked: false, competition_id: compId },
          });
          ok++;
        } catch (e) { skip++; }
      }
      lines.push(`📅 Etappes: ${ok} geïmporteerd, ${skip} overgeslagen`);
      loadAdminStages();
    }
  }

  // Detect and import riders + shirts
  if (raw.includes('---RENNERS---')) {
    let riderText = raw.split('---RENNERS---')[1];
    if (riderText.includes('---SHIRTS---')) {
      const parts = riderText.split('---SHIRTS---');
      riderText = parts[0];
      try {
        const shirts = JSON.parse(parts[1].trim());
        teamShirts = { ...teamShirts, ...shirts };
        localStorage.setItem('bagagedrager_shirts', JSON.stringify(teamShirts));
        lines.push(`👕 ${Object.keys(shirts).length} team shirts opgeslagen`);
      } catch (e) { /* ignore */ }
    }
    if (riderText.includes('---ETAPPES---')) riderText = riderText.split('---ETAPPES---')[0];
    const parsed = parseRiderLines(riderText);
    if (parsed.length) {
      let ok = 0, skip = 0;
      for (const r of parsed) {
        try {
          await supaRest('riders', { method: 'POST', body: { ...r, competition_id: compId } });
          ok++;
        } catch (e) { skip++; }
      }
      lines.push(`🚴 Renners: ${ok} geïmporteerd, ${skip} overgeslagen`);
      loadAdminRiders();
      await loadRidersForComp();
    }
  }

  // Fallback: try plain CSV (stages or riders)
  if (!raw.includes('---')) {
    // Guess based on content
    const firstLine = raw.split('\n')[0];
    if (firstLine.match(/^\d+\s*,.*,\s*\d{4}-\d{2}-\d{2}/)) {
      // Looks like stages
      const parsed = parseStageLines(raw);
      if (parsed.length) {
        let ok = 0, skip = 0;
        for (const s of parsed) {
          const startDateTime = new Date(`${s.date}T${s.start_time || '12:00'}:00`);
          try {
            await supaRest('stages', {
              method: 'POST',
              body: { ...s, start_time: startDateTime.toISOString(), deadline: startDateTime.toISOString(), locked: false, competition_id: compId },
            });
            ok++;
          } catch (e) { skip++; }
        }
        lines.push(`📅 Etappes: ${ok} geïmporteerd, ${skip} overgeslagen`);
        loadAdminStages();
      }
    } else {
      // Assume riders
      const parsed = parseRiderLines(raw);
      if (parsed.length) {
        let ok = 0, skip = 0;
        for (const r of parsed) {
          try {
            await supaRest('riders', { method: 'POST', body: { ...r, competition_id: compId } });
            ok++;
          } catch (e) { skip++; }
        }
        lines.push(`🚴 Renners: ${ok} geïmporteerd, ${skip} overgeslagen`);
        loadAdminRiders();
        await loadRidersForComp();
      }
    }
  }

  if (lines.length) {
    status.textContent = '✅ Klaar!';
    status.className = 'text-success';
    log.innerHTML = lines.join('<br>');
  } else {
    status.textContent = 'Geen geldige data gevonden';
    status.className = 'text-danger';
  }
});

// =====================
// ADMIN: IMPORT (handmatig)
// =====================

function parseRiderLines(text) {
  return text.trim().split('\n').map(line => {
    line = line.trim();
    if (!line) return null;
    // Support both comma and tab separated
    const parts = line.includes('\t') ? line.split('\t') : line.split(',');
    if (parts.length < 3) return null;
    const bib = parseInt(parts[0].trim());
    const name = parts[1].trim();
    const team = parts[2].trim();
    if (!bib || !name || !team) return null;
    return { bib_number: bib, name, team };
  }).filter(Boolean);
}

function parseStageLines(text) {
  return text.trim().split('\n').map(line => {
    line = line.trim();
    if (!line) return null;
    const parts = line.includes('\t') ? line.split('\t') : line.split(',');
    if (parts.length < 3) return null;
    const num = parseInt(parts[0].trim());
    const name = parts[1].trim();
    const date = parts[2].trim();
    const type = (parts[3] || 'flat').trim().toLowerCase();
    if (!num || !name || !date.match(/^\d{4}-\d{2}-\d{2}$/)) return null;
    return { stage_number: num, name, date, stage_type: type };
  }).filter(Boolean);
}

$('btn-preview-riders').addEventListener('click', () => {
  const parsed = parseRiderLines($('import-riders-text').value);
  const el = $('import-riders-preview');
  if (!parsed.length) { el.innerHTML = '<span class="text-danger">Geen geldige regels gevonden</span>'; return; }
  el.innerHTML = `<strong>${parsed.length} renners gevonden:</strong><br>` +
    parsed.slice(0, 10).map(r => `#${r.bib_number} ${r.name} — ${r.team}`).join('<br>') +
    (parsed.length > 10 ? `<br><span class="text-muted">...en ${parsed.length - 10} meer</span>` : '');
});

$('btn-import-riders').addEventListener('click', async () => {
  let rawText = $('import-riders-text').value;

  // Extract shirts if present (from PCS script output)
  if (rawText.includes('---SHIRTS---')) {
    const parts = rawText.split('---SHIRTS---');
    rawText = parts[0].replace('---RENNERS---', '');
    try {
      const shirts = JSON.parse(parts[1].trim());
      teamShirts = { ...teamShirts, ...shirts };
      localStorage.setItem('bagagedrager_shirts', JSON.stringify(teamShirts));
      console.log(`${Object.keys(shirts).length} team shirts opgeslagen`);
    } catch (e) { console.warn('Kon shirts niet parsen:', e); }
  } else {
    rawText = rawText.replace('---RENNERS---', '');
  }

  const parsed = parseRiderLines(rawText);
  const compId = parseInt($('import-rider-comp').value);
  const status = $('import-riders-status');
  if (!parsed.length) { status.textContent = 'Geen geldige data'; status.className = 'text-danger'; return; }
  if (!compId) { status.textContent = 'Kies een ronde'; status.className = 'text-danger'; return; }

  status.textContent = `Importeren van ${parsed.length} renners...`;
  status.className = 'text-muted';
  let ok = 0, skip = 0, errors = [];
  for (const r of parsed) {
    try {
      await supaRest('riders', { method: 'POST', body: { ...r, competition_id: compId } });
      ok++;
    } catch (e) {
      skip++;
      if (!e.message.includes('duplicate') && !e.message.includes('unique')) {
        errors.push(`#${r.bib_number} ${r.name}: ${e.message}`);
      }
    }
  }
  const msg = `${ok} geïmporteerd, ${skip} overgeslagen`;
  status.textContent = errors.length ? `${msg} (${errors.length} fouten — check console)` : msg;
  status.className = errors.length ? 'text-warning' : 'text-success';
  if (errors.length) console.warn('Import fouten:', errors);
  loadAdminRiders();
});

$('btn-preview-stages').addEventListener('click', () => {
  const parsed = parseStageLines($('import-stages-text').value);
  const el = $('import-stages-preview');
  if (!parsed.length) { el.innerHTML = '<span class="text-danger">Geen geldige regels gevonden</span>'; return; }
  const typeLabels = { flat: 'Vlak', mountain: 'Berg', tt: 'Tijdrit', sprint: 'Sprint' };
  el.innerHTML = `<strong>${parsed.length} etappes gevonden:</strong><br>` +
    parsed.map(s => `Etappe ${s.stage_number}: ${s.name} (${s.date}, ${typeLabels[s.stage_type] || s.stage_type})`).join('<br>');
});

$('btn-import-stages').addEventListener('click', async () => {
  const parsed = parseStageLines($('import-stages-text').value);
  const compId = parseInt($('import-stage-comp').value);
  const status = $('import-stages-status');
  if (!parsed.length) { status.textContent = 'Geen geldige data'; status.className = 'text-danger'; return; }
  if (!compId) { status.textContent = 'Kies een ronde'; status.className = 'text-danger'; return; }

  status.textContent = `Importeren van ${parsed.length} etappes...`;
  status.className = 'text-muted';
  let ok = 0, skip = 0;
  for (const s of parsed) {
    const startDateTime = new Date(`${s.date}T${s.start_time || '12:00'}:00`);
    try {
      await supaRest('stages', {
        method: 'POST',
        body: { ...s, start_time: startDateTime.toISOString(), deadline: startDateTime.toISOString(), locked: false, competition_id: compId },
      });
      ok++;
    } catch (e) {
      skip++;
    }
  }
  status.textContent = `${ok} geimporteerd, ${skip} overgeslagen (duplicaat)`;
  status.className = 'text-success';
  loadAdminStages();
});

// PCS browser console script (voor copy-paste)
const PCS_SCRIPT = `// Plak dit in de console op een PCS startlijst-pagina
(() => {
  const teams = document.querySelectorAll('ul.startlist_v4 > li');
  const result = [];
  const shirts = {};
  teams.forEach(li => {
    const teamName = li.querySelector('a.team')?.textContent?.trim().replace(/\\s*\\(.*\\)/, '') || '';
    const shirtImg = li.querySelector('.shirtCont img');
    if (shirtImg && teamName) shirts[teamName] = shirtImg.src;
    li.querySelectorAll('.ridersCont ul li').forEach(rider => {
      const bib = rider.querySelector('.bib')?.textContent?.trim() || '';
      let name = rider.querySelector('a')?.textContent?.trim() || '';
      name = name.replace(/\\s*\\(.*\\)$/, '');
      if (bib && name) result.push(bib + ', ' + name + ', ' + teamName);
    });
  });
  const output = '---RENNERS---\\n' + result.join('\\n') + '\\n---SHIRTS---\\n' + JSON.stringify(shirts);
  copy(output);
  console.log(result.length + ' renners + ' + Object.keys(shirts).length + ' team shirts gekopieerd!');
})();`;

document.addEventListener('DOMContentLoaded', () => {
  const el = $('pcs-script');
  if (el) el.textContent = PCS_SCRIPT;
});
// Also set immediately in case DOM is already loaded
if ($('pcs-script')) $('pcs-script').textContent = PCS_SCRIPT;

// Populate import stage competition selector
function loadImportCompSelect() {
  const opts = competitions.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  ['import-stage-comp', 'import-rider-comp', 'sync-stages-comp', 'race-sync-comp'].forEach(id => {
    const sel = $(id);
    if (sel) sel.innerHTML = opts;
  });
}

// Edge Function race sync removed — using console script approach instead

// --- BOOT ---
(async () => {
  const saved = localStorage.getItem('bagagedrager_session');
  if (saved) {
    try {
      session = JSON.parse(saved);
      // Check token expiration
      if (session.expires_at && Date.now() / 1000 > session.expires_at) {
        throw new Error('Token expired');
      }
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'apikey': SUPABASE_ANON_KEY },
      });
      if (res.ok) { session.user = await res.json(); await initApp(); }
      else { localStorage.removeItem('bagagedrager_session'); }
    } catch (e) {
      localStorage.removeItem('bagagedrager_session');
      session = null;
    }
  }
})();
