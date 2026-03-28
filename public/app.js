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
let _cache = { standings: null, standingsCompId: null, participants: null, participantsCompId: null, allProfiles: null };

// Rider lookup map (id → rider) — gebouwd bij loadRidersForComp
let _riderMap = {};

// --- SUPABASE REST HELPERS ---
// Proactief token refreshen als het bijna verlopen is (< 60s)
async function ensureFreshToken() {
  if (!session?.expires_at || !session?.refresh_token) return;
  if (Date.now() / 1000 < session.expires_at - 60) return; // nog vers genoeg
  await refreshSession();
}

function authHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, ...extra };
  if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`;
  return h;
}

async function supaRest(table, { method = 'GET', filters = '', body, select = '*' } = {}) {
  await ensureFreshToken();
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}${filters ? '&' + filters : ''}`;
  const prefer = method === 'POST' ? 'return=representation' : method === 'PATCH' ? 'return=representation' : '';
  const opts = { method, headers: authHeaders({ 'Prefer': prefer }) };
  if (body) opts.body = JSON.stringify(body);
  let res = await fetch(url, opts);
  // Auto-refresh bij verlopen token
  if (res.status === 401 && await refreshSession()) {
    opts.headers = authHeaders({ 'Prefer': prefer });
    res = await fetch(url, opts);
  }
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function supaDelete(table, filters) {
  await ensureFreshToken();
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filters}`;
  let res = await fetch(url, { method: 'DELETE', headers: authHeaders() });
  if (res.status === 401 && await refreshSession()) {
    res = await fetch(url, { method: 'DELETE', headers: authHeaders() });
  }
  if (!res.ok) throw new Error(await res.text());
}

async function supaPatch(table, filters, body) {
  await ensureFreshToken();
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filters}`;
  let res = await fetch(url, {
    method: 'PATCH',
    headers: authHeaders({ 'Prefer': 'return=representation' }),
    body: JSON.stringify(body),
  });
  if (res.status === 401 && await refreshSession()) {
    res = await fetch(url, {
      method: 'PATCH',
      headers: authHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(body),
    });
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Call a Postgres RPC function
async function supaRpc(fnName, params = {}) {
  await ensureFreshToken();
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

async function refreshSession() {
  if (!session?.refresh_token) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    session = { ...session, ...data };
    localStorage.setItem('bagagedrager_session', JSON.stringify(session));
    return true;
  } catch { return false; }
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
  if (lower.includes('anonymous sign-ins are disabled')) return 'Vul je e-mailadres en wachtwoord in.';
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

// Avatar helper
function avatarHtml(name, avatarUrl, size) {
  const cls = size === 'sm' ? 'avatar avatar-sm' : size === 'lg' ? 'avatar avatar-lg' : 'avatar';
  const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  if (avatarUrl) {
    return `<span class="${cls}"><img src="${escapeHtml(avatarUrl)}" alt="" onerror="this.parentElement.innerHTML='${initials}'"></span>`;
  }
  return `<span class="${cls}">${initials}</span>`;
}

// Avatar cache for standings (populated when profiles load)
let _avatarMap = {};

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

function formatGap(seconds, showZeroAsTime) {
  if (seconds == null) return '-';
  const neg = seconds < 0;
  const abs = Math.abs(seconds);
  if (abs === 0) return showZeroAsTime ? '0:00' : 'z.t.';
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const prefix = neg ? '-' : '+';
  if (h > 0) return `${prefix}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${prefix}${m}:${String(s).padStart(2, '0')}`;
}

function formatDeadline(dt) {
  return new Date(dt).toLocaleString('nl-NL', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function $(id) { return document.getElementById(id); }

// --- TOAST NOTIFICATIONS ---
function toast(message, type = 'info', duration = 3500) {
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${escapeHtml(message)}</span>`;
  $('toast-container').appendChild(el);
  setTimeout(() => { el.classList.add('removing'); setTimeout(() => el.remove(), 300); }, duration);
}

// --- CONFETTI ---
function confettiBurst() {
  const container = document.createElement('div');
  container.className = 'confetti-burst';
  const colors = ['var(--accent)', 'var(--green)', 'var(--red)', 'var(--purple)', 'var(--blue)'];
  for (let i = 0; i < 24; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    const angle = (Math.PI * 2 * i) / 24 + (Math.random() - 0.5) * 0.5;
    const dist = 60 + Math.random() * 80;
    p.style.cssText = `background:${colors[i % colors.length]};--cx:${Math.cos(angle) * dist}px;--cy:${Math.sin(angle) * dist - 40}px;--cr:${Math.random() * 720}deg;`;
    container.appendChild(p);
  }
  document.body.appendChild(container);
  setTimeout(() => container.remove(), 1100);
}

// --- SKELETON LOADING ---
function skeletonRows(count = 5) {
  return Array.from({ length: count }, () =>
    `<tr><td colspan="3"><div class="skeleton skeleton-row"></div></td></tr>`
  ).join('');
}

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

// Build PCS stage URL: eendagskoersen hebben geen /stage-N suffix
function buildPcsStageUrl(comp, stageNumber) {
  if (!comp?.pcs_url) return null;
  const base = comp.pcs_url.replace(/\/$/, '').replace(/\/(stages|startlist|gc|stage-\d+|results?|resuts)$/, '');
  if (comp.is_one_day) return `${base}/result`;
  return `${base}/stage-${stageNumber}`;
}

function updateCompBanner() {
  applyCompColor();
  updateSyncInfo();
}

function updateSyncInfo() {
  const comp = competitions.find(c => c.id === activeCompId);
  const el = $('comp-sync-info');
  if (!el) return;
  if (comp?.last_synced_at) {
    const d = new Date(comp.last_synced_at);
    el.textContent = `Gesynct: ${d.toLocaleString('nl-NL', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}`;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

function applyCompColor() {
  const comp = competitions.find(c => c.id === activeCompId);
  const color = comp?.color || '#facc15';
  document.documentElement.style.setProperty('--comp-color', color);
  // Apply to comp-select
  const sel = $('comp-select');
  if (sel) {
    sel.style.borderColor = color + '60';
    sel.style.background = color + '10';
  }
  // Apply to active nav tab underline
  document.querySelectorAll('#main-tabs .nav-link.active').forEach(n => {
    n.style.borderBottomColor = color;
  });
  // Apply to stage timeline dots (open state)
  document.documentElement.style.setProperty('--comp-accent', color);
  // Apply to browser theme-color (adresbalk op mobiel)
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);
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
  if (tab === 'participants') { Promise.all([loadPeloton(), loadParticipants()]); }
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
  $('account-hero').value = profile?.cycling_hero || '';
  $('account-motto').value = profile?.motto || '';

  // Avatar preview
  updateAvatarPreview();

  // Populate team dropdown from known teams
  const teamSel = $('account-team');
  if (teamSel.options.length <= 1) {
    const teams = Object.keys(TEAMS).sort();
    teamSel.innerHTML = '<option value="">Kies je ploeg...</option>' +
      teams.map(t => `<option value="${t}">${t}</option>`).join('');
  }
  teamSel.value = profile?.favorite_team || '';
}

function updateAvatarPreview() {
  const preview = $('account-avatar-preview');
  const initials = $('account-avatar-initials');
  const name = profile?.display_name || '?';
  const ini = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  if (profile?.avatar_url) {
    preview.innerHTML = `<img src="${escapeHtml(profile.avatar_url)}" alt="" onerror="this.remove();">`;
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
    const path = `${session.user.id}/avatar.${ext}`;
    const url = `${SUPABASE_URL}/storage/v1/object/avatars/${path}`;

    // Upload to Supabase Storage
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': file.type,
        'x-upsert': 'true',
      },
      body: file,
    });
    if (!res.ok) throw new Error('Upload mislukt');

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}?t=${Date.now()}`;
    await supaPatch('profiles', `id=eq.${session.user.id}`, { avatar_url: publicUrl });
    profile.avatar_url = publicUrl;
    _avatarMap[profile.display_name] = publicUrl;
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
    await supaPatch('profiles', `id=eq.${session.user.id}`, updates);
    if (!profile) profile = {};
    Object.assign(profile, updates);
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
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  if (!email || !password) { showError('Vul je e-mailadres en wachtwoord in.'); return; }
  try {
    session = await login(email, password);
    localStorage.setItem('bagagedrager_session', JSON.stringify(session));
    await initApp();
  } catch (e) { showError(e.message); }
});

$('btn-signup').addEventListener('click', async () => {
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  if (!email || !password) { showError('Vul je e-mailadres en wachtwoord in.'); return; }
  try {
    const data = await signup(email, password, email.split('@')[0]);
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

$('user-name').addEventListener('click', (e) => { e.preventDefault(); navigateToTab('account'); });

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
  localStorage.setItem('bagagedrager_comp', activeCompId);
  _cache.standings = null; _cache.participants = null;
  updateCompBanner();
  await loadRidersForComp();
  const activeTab = document.querySelector('#main-tabs .nav-link.active');
  if (activeTab) activeTab.click();
});

// --- INIT ---
async function initApp() {
  localStorage.setItem('bagagedrager_session', JSON.stringify(session));

  // Parallel fetch: all initial data at once (inclusief profielen voor avatars)
  const [profiles, comps, allStages, picks, allProfiles] = await Promise.all([
    supaRest('profiles', { filters: `id=eq.${session.user.id}` }),
    supaRest('competitions', { filters: 'order=year.desc,name' }),
    supaRest('stages', { filters: 'order=stage_number' }),
    supaRest('picks', { filters: `user_id=eq.${session.user.id}&order=stage_id` }),
    supaRest('profiles'),
  ]);

  profile = profiles[0];
  competitions = comps;
  stages = allStages;
  myPicks = picks;
  _cache.allProfiles = allProfiles;
  allProfiles.forEach(p => { _avatarMap[p.display_name] = p.avatar_url; });

  $('user-name').textContent = profile?.display_name || session.user.email;
  $('auth-screen').style.display = 'none';
  $('app').style.display = 'block';

  if (profile?.is_admin) $('admin-tab').style.display = 'block';

  const sel = $('comp-select');
  sel.innerHTML = competitions.map(c =>
    `<option value="${c.id}">${c.country_flag || ''} ${c.name}${c.is_active ? '' : ' (afgelopen)'}</option>`
  ).join('');
  $('comp-count').textContent = competitions.length > 1 ? `${competitions.length} rondes` : '';
  updateSyncInfo();
  // Onthoud laatst gekozen ronde, val terug op actieve, dan eerste
  const savedCompId = parseInt(localStorage.getItem('bagagedrager_comp'));
  const savedComp = savedCompId ? competitions.find(c => c.id === savedCompId) : null;
  const activeComp = savedComp || competitions.find(c => c.is_active) || competitions[0];
  if (activeComp) { sel.value = activeComp.id; activeCompId = activeComp.id; }
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
  // Bouw lookup map voor O(1) rider lookups
  _riderMap = {};
  for (const r of riders) _riderMap[r.id] = r;
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

  // Skeleton loading
  const skel = skeletonRows(5);
  $('gc-table').innerHTML = skel; $('points-table').innerHTML = skel;
  $('mountain-table').innerHTML = skel; $('game-table').innerHTML = skel;

  let standings;
  if (_cache.standingsCompId === activeCompId && _cache.standings) {
    standings = _cache.standings;
  } else {
    const compStageIds = activeStages().filter(s => s.locked).map(s => s.id);
    const [standingsData, winnerResults] = await Promise.all([
      supaRest('general_classification', { filters: `competition_id=eq.${activeCompId}` }),
      compStageIds.length
        ? supaRest('stage_results', { filters: `stage_id=in.(${compStageIds.join(',')})&finish_position=eq.1&dnf=eq.false&time_seconds=gt.0`, select: 'stage_id,time_seconds' })
        : Promise.resolve([]),
    ]);
    standings = standingsData;
    _cache.winnerTimeSum = (winnerResults || []).reduce((sum, r) => sum + r.time_seconds, 0);
    _cache.standings = standings;
    _cache.standingsCompId = activeCompId;
  }

  const emptyRow = '<tr><td colspan="3" class="text-muted text-center py-3">Nog geen resultaten — wordt zichtbaar na de eerste etappe</td></tr>';
  const medal = ['🥇', '🥈', '🥉'];
  const mode = activeScoringMode();
  const isClassic = mode === 'classic';
  const myName = profile?.display_name;

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
      el.className = isClassic ? 'col-lg-8 mx-auto' : 'col-lg-3';
    }
  });

  // Rivalry tracker helper: add row showing gap to neighbor above only
  function rivalryRow(sorted, myIdx, valueFn, isTime) {
    if (myIdx <= 0 || sorted.length < 2) return '';
    const above = sorted[myIdx - 1];
    const diff = Math.abs(valueFn(sorted[myIdx]) - valueFn(above));
    if (diff === 0) return '';
    return `<tr class="rivalry-row"><td colspan="3"><div class="rivalry-info"><span class="rivalry-up">↑ ${isTime ? formatGap(diff) : diff + ' pts'} achter ${escapeHtml(above.display_name)}</span></div></td></tr>`;
  }

  // H2H button helper
  function h2hBtn(name) {
    if (name === myName) return '';
    return ` <button class="btn btn-ghost" style="padding:0.1rem 0.4rem;font-size:0.6rem;border-radius:4px;" onclick="openH2H('${escapeHtml(name).replace(/'/g, "\\'")}')">vs</button>`;
  }

  // Render standings with rivalry
  function renderClassification(tableId, sorted, valueFn, formatFn, isTime) {
    const myIdx = sorted.findIndex(s => s.display_name === myName);
    const rows = sorted.map((s, i) => {
      const isMe = s.display_name === myName;
      const meStyle = isMe ? ' style="background:var(--accent-bg);"' : '';
      return `<tr${meStyle}><td class="${i < 3 ? 'rank-' + (i+1) : ''}">${medal[i] || i + 1}</td><td><div class="d-flex align-items-center gap-2">${avatarHtml(s.display_name, _avatarMap[s.display_name], 'sm')}${escapeHtml(s.display_name)}${h2hBtn(s.display_name)}</div></td><td class="text-end">${formatFn(s, i)}</td></tr>`;
    }).join('');
    $(tableId).innerHTML = rows || emptyRow;
  }

  if (!isClassic) {
    const gc = [...standings].sort((a, b) => a.total_time - b.total_time);
    const leaderTime = gc.length ? gc[0].total_time : 0;
    const completedStages = activeStages().filter(s => s.locked).length;
    const winnerTimeSum = _cache.winnerTimeSum || 0;
    const bestBonif = 10 * completedStages;

    renderClassification('gc-table', gc, s => s.total_time, (s, i) => {
      const absTime = winnerTimeSum > 0 ? winnerTimeSum + s.total_time : null;
      const absTimeNoBonif = winnerTimeSum > 0 ? winnerTimeSum + s.total_time_no_bonif : null;
      const timeDisplay = absTime ? formatTime(absTime) : (i === 0 ? formatTime(s.total_time) : formatGap(s.total_time - leaderTime));
      const gapDisplay = i > 0 ? `<div style="font-size:0.65rem;color:var(--text-muted);">${formatGap(s.total_time - leaderTime)}</div>` : '';
      const bonifDisplay = s.total_bonification ? `<div style="font-size:0.65rem;color:var(--green);">-${s.total_bonification}s bonif.</div>` : '';
      const noBonifDisplay = absTimeNoBonif ? `<div style="font-size:0.65rem;color:var(--text-muted);">Zonder: ${formatTime(absTimeNoBonif)}</div>` : '';
      return `${timeDisplay}${gapDisplay}${bonifDisplay}${noBonifDisplay}`;
    }, true);

    // De nummer 1 toont al de absolute snelste tijd (met bonificatie) als eerste rij

    const pts = [...standings].sort((a, b) => b.total_points - a.total_points);
    renderClassification('points-table', pts, s => s.total_points, (s) => s.total_points, false);

    const mt = [...standings].sort((a, b) => b.total_mountain_points - a.total_mountain_points);
    renderClassification('mountain-table', mt, s => s.total_mountain_points, (s) => s.total_mountain_points, false);
  }

  const gp = [...standings].sort((a, b) => b.total_game_points - a.total_game_points);
  renderClassification('game-table', gp, s => s.total_game_points, (s) => s.total_game_points || 0, false);

  renderStageTimeline();
}

// --- HEAD-TO-HEAD ---
window.openH2H = async function(opponentName) {
  const overlay = $('h2h-overlay');
  const content = $('h2h-content');
  content.innerHTML = '<div class="text-center text-muted py-3">Laden...</div>';
  overlay.style.display = 'flex';

  try {
    const allPicks = await supaRest('stage_picks_public', {
      filters: `competition_id=eq.${activeCompId}`,
      select: 'stage_id,stage_number,user_id,display_name,rider_name,time_gap,bonification,effective_points,effective_mountain_points,effective_game_points,finish_position,dnf,is_late'
    });

    const myPks = allPicks.filter(p => p.display_name === profile?.display_name);
    const oppPks = allPicks.filter(p => p.display_name === opponentName);
    const stageNums = [...new Set(allPicks.map(p => p.stage_number))].sort((a, b) => a - b);

    let myWins = 0, oppWins = 0;
    const stageRows = stageNums.map(num => {
      const my = myPks.find(p => p.stage_number === num);
      const opp = oppPks.find(p => p.stage_number === num);
      if (!my || !opp) return '';
      const myGp = my.is_late || my.dnf ? 0 : (my.effective_game_points || 0);
      const oppGp = opp.is_late || opp.dnf ? 0 : (opp.effective_game_points || 0);
      const myWin = myGp > oppGp;
      const oppWin = oppGp > myGp;
      if (myWin) myWins++;
      if (oppWin) oppWins++;
      return `<div class="h2h-stage-row">
        <div class="${myWin ? 'h2h-winner' : oppWin ? 'h2h-loser' : ''}" style="text-align:right;">${myGp} <span style="font-size:0.7rem;color:var(--text-muted);">${escapeHtml(my.rider_name || '?')}</span></div>
        <div class="h2h-stage-label">E${num}</div>
        <div class="${oppWin ? 'h2h-winner' : myWin ? 'h2h-loser' : ''}">${oppGp} <span style="font-size:0.7rem;color:var(--text-muted);">${escapeHtml(opp.rider_name || '?')}</span></div>
      </div>`;
    }).join('');

    const myTotal = myPks.reduce((s, p) => s + (p.is_late || p.dnf ? 0 : (p.effective_game_points || 0)), 0);
    const oppTotal = oppPks.reduce((s, p) => s + (p.is_late || p.dnf ? 0 : (p.effective_game_points || 0)), 0);

    content.innerHTML = `
      <div class="h2h-vs">
        <div class="h2h-player" style="color:var(--accent);">${escapeHtml(profile?.display_name || '?')}</div>
        <div class="h2h-vs-label">TEGEN</div>
        <div class="h2h-player">${escapeHtml(opponentName)}</div>
      </div>
      ${stageRows}
      <div class="h2h-score-summary">
        <div class="h2h-stat"><div class="h2h-stat-label">Etappes gewonnen</div><div class="h2h-stat-value" style="color:var(--green);">${myWins} - ${oppWins}</div></div>
        <div class="h2h-stat"><div class="h2h-stat-label">Totaal spelpunten</div><div class="h2h-stat-value">${myTotal} - ${oppTotal}</div></div>
      </div>`;
  } catch (e) {
    content.innerHTML = `<div class="text-danger">${e.message}</div>`;
  }
};

// --- ACHIEVEMENTS ---
function computeAchievements(picks, results, stages) {
  const badges = [];
  if (!picks.length || !results.length) return badges;

  // Etappewinnaar: jouw renner won de etappe
  const stageWins = picks.filter(p => {
    const r = results.find(r => r.stage_id === p.stage_id && r.rider_id === p.rider_id);
    return r && r.finish_position === 1 && !r.dnf && !p.is_late;
  });
  if (stageWins.length) badges.push({ icon: '🏆', text: `${stageWins.length}x Etappewinnaar`, cls: 'gold' });

  // Podium: top 3 finish
  const podiums = picks.filter(p => {
    const r = results.find(r => r.stage_id === p.stage_id && r.rider_id === p.rider_id);
    return r && r.finish_position <= 3 && !r.dnf && !p.is_late;
  });
  if (podiums.length >= 3) badges.push({ icon: '🥉', text: `${podiums.length}x Podium`, cls: 'green' });

  // IJzeren ploegleider: alle etappes op tijd gekozen
  const compStages = stages.filter(s => s.competition_id === activeCompId && s.locked);
  const latePicks = picks.filter(p => p.is_late);
  if (compStages.length >= 3 && latePicks.length === 0) badges.push({ icon: '🛡️', text: 'IJzeren Ploegleider', cls: 'purple' });

  // Op dreef: 3+ achtereen 60+ spelpunten
  const sortedPicks = [...picks].sort((a, b) => {
    const sa = stages.find(s => s.id === a.stage_id);
    const sb = stages.find(s => s.id === b.stage_id);
    return (sa?.stage_number || 0) - (sb?.stage_number || 0);
  });
  let streak = 0, maxStreak = 0;
  for (const p of sortedPicks) {
    const r = results.find(r => r.stage_id === p.stage_id && r.rider_id === p.rider_id);
    const gp = r && !p.is_late && !r.dnf ? (r.game_points || 0) : 0;
    if (gp >= 60) { streak++; maxStreak = Math.max(maxStreak, streak); }
    else streak = 0;
  }
  if (maxStreak >= 3) badges.push({ icon: '🔥', text: `${maxStreak}x Op Dreef`, cls: 'red' });

  // Underdog: solo pick (nobody else picked the rider) and scored 50+
  const allPicks = _cache.participants || [];

  return badges;
}

function renderAchievements(badges) {
  if (!badges.length) return '';
  return `<div class="achievements-wrap">${badges.map(b =>
    `<span class="achievement-badge ${b.cls}">${b.icon} ${b.text}</span>`
  ).join('')}</div>`;
}

function renderStageTimeline() {
  const compStages = activeStages();
  const now = new Date();
  const dots = compStages.map(s => {
    const hasResults = s.locked;
    const deadline = new Date(s.deadline);
    const isPast = now > deadline;
    let cls = 'upcoming';
    let title = `Etappe ${s.stage_number}: ${s.name}${s.distance_km ? ` (${s.distance_km} km)` : ''}`;
    if (hasResults) { cls = 'completed'; title += ' (afgerond)'; }
    else if (isPast) { cls = 'locked'; title += ' (vergrendeld)'; }
    else if (!hasResults && !isPast) {
      const nextOpen = compStages.find(st => !st.locked && now <= new Date(st.deadline));
      cls = nextOpen?.id === s.id ? 'open' : 'upcoming';
      if (cls === 'open') title += ' (open voor keuze)';
    }
    return `<div class="stage-dot ${cls}" title="${title}">${s.stage_number}</div>`;
  }).join('');
  const legend = `<div class="timeline-legend">
    <span class="legend-item"><span class="stage-dot completed" style="width:12px;height:12px;font-size:0;"></span> Afgerond</span>
    <span class="legend-item"><span class="stage-dot open" style="width:12px;height:12px;font-size:0;animation:none;"></span> Open</span>
    <span class="legend-item"><span class="stage-dot locked" style="width:12px;height:12px;font-size:0;"></span> Gestart</span>
    <span class="legend-item"><span class="stage-dot upcoming" style="width:12px;height:12px;font-size:0;"></span> Nog niet open</span>
  </div>`;
  $('stage-timeline').innerHTML = dots + legend;
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

  function navigateStage(dir) {
    const opts = [...sel.options];
    const idx = opts.findIndex(o => o.value === sel.value);
    const next = idx + dir;
    if (next >= 0 && next < opts.length) {
      sel.selectedIndex = next;
      renderPickStage();
    }
  }
  $('btn-prev-stage').onclick = () => navigateStage(-1);
  $('btn-next-stage').onclick = () => navigateStage(1);

  renderPickStage();
}

function renderPickStage() {
  const sel = $('stage-select');
  const stageId = parseInt(sel.value);
  const stage = stages.find(s => s.id === stageId);
  if (!stage) return;

  // Update prev/next buttons
  $('btn-prev-stage').disabled = sel.selectedIndex === 0;
  $('btn-next-stage').disabled = sel.selectedIndex === sel.options.length - 1;

  const now = new Date();
  const isLocked = stage.locked || now > new Date(stage.deadline);

  // Build PCS link for this stage
  const comp = competitions.find(c => c.id === stage.competition_id);
  const pcsStageUrl = buildPcsStageUrl(comp, stage.stage_number);
  const pcsLink = pcsStageUrl ? ` <a href="${pcsStageUrl}" target="_blank" rel="noopener" class="pcs-link" title="Bekijk op PCS">PCS ↗</a>` : '';

  $('pick-stage-name').innerHTML = `Etappe ${stage.stage_number}: ${escapeHtml(stage.name)}${pcsLink}`;
  const stageDetails = [
    `Start: ${formatDeadline(stage.start_time || stage.deadline)}`,
    stage.distance_km ? `${stage.distance_km} km` : null,
    stage.departure && stage.arrival ? `${stage.departure} → ${stage.arrival}` : null,
    isLocked ? '(VERGRENDELD)' : null,
  ].filter(Boolean).join(' · ');
  $('pick-deadline').textContent = stageDetails;

  // Extra race-info badges
  const infoBadges = [
    stage.vertical_meters ? `↗ ${stage.vertical_meters}m` : null,
    stage.profile_score ? `Profiel: ${stage.profile_score}` : null,
    stage.classification || null,
    stage.parcours_type || null,
    stage.avg_speed_winner && stage.avg_speed_winner !== '-' ? `Gem: ${stage.avg_speed_winner} km/u` : null,
    stage.avg_temperature && stage.avg_temperature !== '-' ? `${stage.avg_temperature}` : null,
  ].filter(Boolean);
  const infoEl = $('pick-stage-info');
  if (infoEl) {
    infoEl.innerHTML = infoBadges.length
      ? infoBadges.map(b => `<span class="stage-info-badge">${b}</span>`).join('')
      : '';
  }

  // Profielplaatje tonen
  const profileContainer = $('pick-stage-profile');
  if (profileContainer) {
    profileContainer.innerHTML = stage.profile_image_url
      ? `<img src="${escapeHtml(stage.profile_image_url)}" alt="Etappeprofiel" class="stage-profile-img" onclick="this.classList.toggle('expanded')">`
      : '';
  }
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
  const rider = selectedRiderId ? _riderMap[selectedRiderId] : null;
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

  // Group riders by team
  const grouped = {};
  for (const r of filtered) {
    if (!grouped[r.team]) grouped[r.team] = [];
    grouped[r.team].push(r);
  }
  const teamNames = Object.keys(grouped).sort();

  $('rider-grid').innerHTML = teamNames.length ? teamNames.map(team => {
    const teamRiders = grouped[team];
    return `
      <div class="col-12 rider-team-group">
        <div class="team-group-header">${teamBadge(team)}</div>
        <div class="row g-2">
          ${teamRiders.map(r => {
            const used = usedInOtherStages.has(r.id);
            const selected = r.id === selectedRiderId;
            return `
              <div class="col-6 col-md-4 col-lg-3">
                <div class="card pick-card ${selected ? 'selected' : ''} ${used ? 'used' : ''}"
                     data-rider-id="${r.id}" ${fullyLocked || used ? '' : `onclick="selectRider(${r.id})"`}>
                  <div class="card-body py-2 px-3">
                    <div class="d-flex align-items-center gap-2">
                      ${r.photo_url ? `<img src="${escapeHtml(r.photo_url)}" class="rider-photo" alt="" onerror="this.style.display='none'">` : ''}
                      <div class="flex-grow-1 min-width-0">
                        <div class="d-flex justify-content-between align-items-start">
                          <div class="fw-bold" style="font-size:0.88rem;">${escapeHtml(r.name)}</div>
                          <span class="bib-badge">${r.bib_number}</span>
                        </div>
                        ${used ? '<small class="text-danger mt-1 d-block">Al gebruikt</small>' : ''}
                      </div>
                    </div>
                  </div>
                </div>
              </div>`;
          }).join('')}
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
    if (!result.warning) { confettiBurst(); toast('Keuze bevestigd!', 'success'); }
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
  let allPicksForStages = [];
  if (stageIds.length) {
    [allResults, allPicksForStages] = await Promise.all([
      supaRest('stage_results', { filters: `stage_id=in.(${stageIds.join(',')})` }),
      supaRest('picks', { select: 'stage_id,rider_id', filters: `stage_id=in.(${stageIds.join(',')})` }),
    ]);
  }

  // Count how many players picked each rider per stage
  const pickerCounts = {};
  for (const p of allPicksForStages) {
    const key = `${p.stage_id}_${p.rider_id}`;
    pickerCounts[key] = (pickerCounts[key] || 0) + 1;
  }

  // Calculate winner times and names per stage for gap display
  const winnerTimes = {};
  const winnerNames = {};
  for (const r of allResults) {
    if (r.finish_position === 1 && !r.dnf && r.time_seconds > 0) {
      winnerTimes[r.stage_id] = r.time_seconds;
      const wr = _riderMap[r.rider_id];
      winnerNames[r.stage_id] = wr?.name || '?';
    }
  }

  // Build rows with game_points for coloring
  const rows = compPicks.map(pick => {
    const stage = stages.find(s => s.id === pick.stage_id);
    const rider = _riderMap[pick.rider_id];
    const result = allResults.find(r => r.stage_id === pick.stage_id && r.rider_id === pick.rider_id);
    const gp = result && !pick.is_late && !result.dnf ? (result.game_points || 0) : 0;
    const timeGap = result && result.time_seconds && winnerTimes[pick.stage_id]
      ? Math.max(result.time_seconds - winnerTimes[pick.stage_id], 0) : null;
    const bonif = result && !pick.is_late && !result.dnf
      ? (result.finish_position === 1 ? 10 : result.finish_position === 2 ? 6 : result.finish_position === 3 ? 4 : 0) : 0;
    let rowClass = '';
    if (result) {
      if (gp >= 70) rowClass = 'history-great';
      else if (gp >= 20) rowClass = 'history-good';
      else if (gp === 0 && (result.dnf || pick.is_late)) rowClass = 'history-bad';
    }
    const numPickers = pickerCounts[`${pick.stage_id}_${pick.rider_id}`] || 1;
    const sharingPct = numPickers <= 1 ? 100 : numPickers === 2 ? 80 : numPickers === 3 ? 60 : numPickers === 4 ? 40 : 20;
    return { pick, stage, rider, result, gp, timeGap, bonif, rowClass, numPickers, sharingPct };
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

    // Achievements
    const badges = computeAchievements(compPicks, allResults, stages);
    if (badges.length) {
      $('history-stats').innerHTML += `<div class="col-12">${renderAchievements(badges)}</div>`;
    }
  } else {
    $('history-stats').innerHTML = '';
  }

  const histIsClassic = activeScoringMode() === 'classic';
  $('history-table-header').innerHTML = histIsClassic
    ? '<th>Etappe</th><th>Renner</th><th class="text-end">Tijd</th><th class="text-end"><span class="info-tooltip" data-tip="Sprintpunten uit het puntenklassement">Pts &#9432;</span></th><th class="text-end"><span class="info-tooltip" data-tip="Bergpunten (KOM)">Berg &#9432;</span></th><th class="text-end"><span class="info-tooltip" data-tip="Spelpunten op basis van finishpositie, na deelpenalty">Spel &#9432;</span></th><th>Status</th>'
    : '<th>Etappe</th><th>Renner</th><th class="text-end"><span class="info-tooltip" data-tip="Tijdsverschil met etappewinnaar">Verschil &#9432;</span></th><th class="text-end"><span class="info-tooltip" data-tip="Bonificatie: 1e −10s, 2e −6s, 3e −4s">Bonif. &#9432;</span></th><th class="text-end"><span class="info-tooltip" data-tip="Sprintpunten uit het puntenklassement">Pts &#9432;</span></th><th class="text-end"><span class="info-tooltip" data-tip="Bergpunten (KOM)">Berg &#9432;</span></th><th class="text-end"><span class="info-tooltip" data-tip="Spelpunten op basis van finishpositie, na deelpenalty">Spel &#9432;</span></th><th>Status</th>';
  $('history-table').innerHTML = rows.map(({ pick, stage, rider, result, gp, timeGap, bonif, rowClass, numPickers, sharingPct }) =>
    `<tr class="${rowClass}">
      <td><div>Etappe ${stage?.stage_number || '?'}</div>${winnerNames[pick.stage_id] ? `<div style="font-size:0.65rem;color:var(--text-muted);">🏆 ${escapeHtml(winnerNames[pick.stage_id])}</div>` : ''}</td>
      <td>${rider?.name || '?'} <span class="team-badge-sm">${rider ? teamBadge(rider.team) : ''}</span>${numPickers > 1 ? ` <span class="badge bg-secondary" style="font-size:0.6rem;">${numPickers}x → ${sharingPct}%</span>` : ''}</td>
      <td class="time text-end">${!histIsClassic && result ? (result.finish_position === 1 ? formatTime(result.time_seconds) : formatGap(timeGap)) : result ? formatTime(result.time_seconds) : '-'}</td>
      ${!histIsClassic ? `<td class="text-end">${bonif ? '-' + bonif + 's' : '-'}</td>` : ''}
      <td class="text-end">${result ? (pick.is_late ? '0' : result.points) : '-'}</td>
      <td class="text-end">${result ? (pick.is_late ? '0' : result.mountain_points) : '-'}</td>
      <td class="text-end">${gp}</td>
      <td>${pick.is_late ? '<span class="badge bg-warning">Te laat</span>' : ''}${pick.is_random ? '<span class="badge bg-info">🎡 Rad</span>' : ''}</td>
    </tr>`
  ).join('') || `<tr><td colspan="${histIsClassic ? 7 : 8}">
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
  const [allProfiles, allPicks] = await Promise.all([
    _cache.allProfiles || supaRest('profiles', { filters: 'order=created_at' }),
    supaRest('picks', { select: 'user_id' }),
  ]);
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
    const extras = [];
    if (p.favorite_team) extras.push(teamBadge(p.favorite_team));
    if (p.cycling_hero) extras.push(`<span style="font-size:0.7rem;color:var(--text-muted);">${escapeHtml(p.cycling_hero)}</span>`);
    const mottoHtml = p.motto ? `<div style="font-size:0.7rem;color:var(--text-muted);font-style:italic;">"${escapeHtml(p.motto)}"</div>` : '';
    return `<tr>
      <td>
        <div>${escapeHtml(p.display_name)}</div>
        ${extras.length ? `<div class="d-flex align-items-center gap-2 mt-1">${extras.join('')}</div>` : ''}
        ${mottoHtml}
      </td>
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
  } catch (e) { toast(e.message, 'error'); }
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

  // Fetch stage winners (finish_position = 1) for display
  const lockedStageIds = [...new Set(allPicks.map(p => p.stage_id))];
  const stageWinners = {};
  if (lockedStageIds.length) {
    const winnerResults = await supaRest('stage_results', {
      select: 'stage_id,rider_id,time_seconds,finish_position',
      filters: `stage_id=in.(${lockedStageIds.join(',')})&finish_position=eq.1`
    });
    for (const w of winnerResults) {
      const rider = _riderMap[w.rider_id];
      stageWinners[w.stage_id] = { name: rider?.name || '?', time: w.time_seconds };
    }
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
    const partComp = competitions.find(c => c.id === activeCompId);
    const partPcsUrl = buildPcsStageUrl(partComp, num);
    const partPcsLink = partPcsUrl ? ` <a href="${partPcsUrl}" target="_blank" rel="noopener" class="pcs-link" title="Bekijk op PCS">PCS ↗</a>` : '';
    const stageName = `Etappe ${num}${partPcsLink}`;
    const stageId = byStage[num].stage_id;
    const winner = stageWinners[stageId];
    const winnerInfo = winner ? `<span style="font-size:0.75rem; color:var(--text-muted); font-weight:400; margin-left:0.5rem;">🏆 ${escapeHtml(winner.name)} — ${formatTime(winner.time)}</span>` : '';
    const header = isClassic
      ? '<tr><th>Speler</th><th>Renner</th><th class="text-end">Positie</th><th class="text-end"><span class="info-tooltip" data-tip="Spelpunten op basis van positie, na deelpenalty">Spel &#9432;</span></th><th>Status</th></tr>'
      : '<tr><th>Speler</th><th>Renner</th><th class="text-end"><span class="info-tooltip" data-tip="Tijdsverschil met etappewinnaar">Verschil &#9432;</span></th><th class="text-end"><span class="info-tooltip" data-tip="1e −10s, 2e −6s, 3e −4s">Bonif. &#9432;</span></th><th class="text-end"><span class="info-tooltip" data-tip="Sprintpunten uit puntenklassement">Pts &#9432;</span></th><th class="text-end"><span class="info-tooltip" data-tip="Bergpunten (KOM)">Berg &#9432;</span></th><th>Status</th></tr>';
    return `
      <div class="card mb-3">
        <div class="card-header d-flex align-items-center flex-wrap">
          <h6 class="mb-0" style="font-size:0.9rem;">${stageName}</h6>${winnerInfo}
        </div>
        <div class="card-body p-0">
          <table class="table table-sm mb-0">
            <thead>${header}</thead>
            <tbody>
              ${picks.map(p => {
                const sharingPct = p.num_pickers <= 1 ? 100 : p.num_pickers === 2 ? 80 : p.num_pickers === 3 ? 60 : p.num_pickers === 4 ? 40 : 20;
                const pickersBadge = p.num_pickers > 1 ? ` <span class="badge bg-secondary" style="font-size:0.6rem;">${p.num_pickers}x → ${sharingPct}%</span>` : '';
                if (isClassic) {
                  return `<tr>
                  <td>${escapeHtml(p.display_name)}</td>
                  <td>${escapeHtml(p.rider_name)} <span class="team-badge-sm">${teamBadge(p.rider_team)}</span>${pickersBadge}</td>
                  <td class="text-end">${p.finish_position || '-'}</td>
                  <td class="text-end">${p.effective_game_points != null ? p.effective_game_points : '-'}</td>
                  <td>${p.is_late ? '<span class="badge bg-warning">Te laat</span>' : ''}${p.is_random ? '<span class="badge bg-info">🎡 Rad</span>' : ''}${p.dnf ? '<span class="badge bg-danger">DNF</span>' : ''}</td>
                </tr>`;
                }
                return `<tr>
                <td>${escapeHtml(p.display_name)}</td>
                <td>${escapeHtml(p.rider_name)} <span class="team-badge-sm">${teamBadge(p.rider_team)}</span>${pickersBadge}</td>
                <td class="time text-end">${p.finish_position === 1 ? formatTime(p.time_seconds) : (p.time_gap != null ? formatGap(p.time_gap) : '-')}</td>
                <td class="text-end">${p.bonification ? '-' + p.bonification + 's' : '-'}</td>
                <td class="text-end">${p.effective_points != null ? p.effective_points : (p.points != null ? (p.is_late ? '0' : p.points) : '-')}</td>
                <td class="text-end">${p.effective_mountain_points != null ? p.effective_mountain_points : (p.mountain_points != null ? (p.is_late ? '0' : p.mountain_points) : '-')}</td>
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
  } catch (e) { toast(e.message, 'error'); }
};

window.deletePlayer = async function(userId, displayName) {
  if (!confirm(`Weet je zeker dat je "${displayName}" wilt verwijderen? Dit verwijdert ook alle keuzes van deze speler.`)) return;
  try {
    await supaRpc('admin_delete_player', { p_user_id: userId });
    loadAdminUsers();
    loadPeloton();
  } catch (e) { toast(e.message, 'error'); }
};

window.resetPassword = async function(email) {
  if (!email) { toast('Geen e-mailadres bekend voor deze speler', 'warning'); return; }
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error('Verzenden mislukt');
    toast(`Herstelmail verzonden naar ${email}`, 'success');
  } catch (e) { toast(e.message, 'error'); }
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
        <label class="form-check mt-1" style="font-size:0.7rem;">
          <input type="checkbox" class="form-check-input" ${c.is_one_day ? 'checked' : ''}
                 onchange="updateCompField(${c.id}, 'is_one_day', this.checked)"> 1-dag
        </label>
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
      <td style="font-size:0.7rem;color:var(--text-muted);white-space:nowrap;">
        ${c.last_synced_at ? new Date(c.last_synced_at).toLocaleString('nl-NL', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'}
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
  } catch (e) { toast(e.message, 'error'); }
};

window.updateCompPcsUrl = async function(compId, pcsUrl) {
  try {
    await supaPatch('competitions', `id=eq.${compId}`, { pcs_url: pcsUrl.trim() || null });
  } catch (e) { toast(e.message, 'error'); }
};

$('btn-add-comp').addEventListener('click', async () => {
  const name = $('new-comp-name').value.trim();
  const slug = $('new-comp-slug').value.trim();
  const year = parseInt($('new-comp-year').value);
  if (!name || !slug || !year) return toast('Vul alle velden in', 'warning');
  try {
    const scoringMode = $('new-comp-scoring-mode').value || 'grand_tour';
    const isOneDay = $('new-comp-one-day').checked;
    const pcsUrl = $('new-comp-pcs-url').value.trim() || null;
    const color = $('new-comp-color').value || '#facc15';
    const flag = $('new-comp-flag').value.trim() || '';
    await supaRest('competitions', { method: 'POST', body: { name, slug, competition_type: scoringMode === 'classic' ? 'classic' : 'tour', year, is_active: false, scoring_mode: scoringMode, is_one_day: isOneDay, pcs_url: pcsUrl, color, country_flag: flag } });
    $('new-comp-name').value = '';
    $('new-comp-slug').value = '';
    $('new-comp-pcs-url').value = '';
    $('new-comp-color').value = '#facc15';
    $('new-comp-flag').value = '';
    loadAdminCompetitions();
    loadAdminStages();
  } catch (e) { toast(e.message, 'error'); }
});

window.renameComp = async function(compId, newName) {
  newName = newName.trim();
  if (!newName) return toast('Naam mag niet leeg zijn', 'warning');
  try {
    await supaPatch('competitions', `id=eq.${compId}`, { name: newName });
    loadAdminCompetitions();
  } catch (e) { toast(e.message, 'error'); }
};

window.toggleCompActive = async function(compId, active) {
  try {
    await supaPatch('competitions', `id=eq.${compId}`, { is_active: active });
    loadAdminCompetitions();
  } catch (e) { toast(e.message, 'error'); }
};

window.deleteComp = async function(compId) {
  if (!confirm('Weet je het zeker? Dit verwijdert de ronde.')) return;
  try {
    await supaDelete('competitions', `id=eq.${compId}`);
    loadAdminCompetitions();
  } catch (e) { toast(e.message, 'error'); }
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

let _adminSearchDebounce;
$('admin-rider-search').addEventListener('input', (e) => {
  clearTimeout(_adminSearchDebounce);
  _adminSearchDebounce = setTimeout(() => renderAdminRiders(e.target.value.toLowerCase()), 200);
});

$('btn-add-rider').addEventListener('click', async () => {
  const bib = parseInt($('new-rider-bib').value);
  const name = $('new-rider-name').value.trim();
  const team = $('new-rider-team').value.trim();
  const compId = parseInt($('admin-rider-comp-filter').value) || activeCompId;
  if (!bib || !name || !team) return toast('Vul alle velden in', 'warning');
  if (!compId) return toast('Selecteer eerst een ronde', 'warning');
  try {
    await supaRest('riders', { method: 'POST', body: { bib_number: bib, name, team, competition_id: compId } });
    $('new-rider-bib').value = '';
    $('new-rider-name').value = '';
    $('new-rider-team').value = '';
    loadAdminRiders();
  } catch (e) { toast(e.message, 'error'); }
});

window.deleteRider = async function(riderId) {
  if (!confirm('Renner verwijderen?')) return;
  try {
    await supaDelete('riders', `id=eq.${riderId}`);
    loadAdminRiders();
  } catch (e) { toast(e.message, 'error'); }
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
  if (!num || !name || !date || !compId) return toast('Vul alle velden in', 'warning');

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
  } catch (e) { toast(e.message, 'error'); }
});

window.toggleStageLock = async function(stageId, lock) {
  try {
    await supaPatch('stages', `id=eq.${stageId}`, { locked: lock });
    loadAdminStages();
  } catch (e) { toast(e.message, 'error'); }
};

window.deleteStage = async function(stageId) {
  if (!confirm('Etappe verwijderen?')) return;
  try {
    await supaDelete('stages', `id=eq.${stageId}`);
    loadAdminStages();
  } catch (e) { toast(e.message, 'error'); }
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
  await ensureFreshToken();
  let res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  // Auto-refresh token bij 401
  if (res.status === 401 && await refreshSession()) {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
  }
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

// Foto's ophalen in batches van 25
$('btn-pcs-sync-photos').addEventListener('click', async () => {
  const compId = parseInt($('race-sync-comp').value);
  const status = $('pcs-sync-status');
  const log = $('pcs-sync-log');
  if (!compId) { status.textContent = 'Kies een ronde'; status.className = 'text-danger'; return; }

  status.textContent = '📸 Foto\'s ophalen...';
  status.className = 'text-muted';

  try {
    const result = await callEdgeFunction('sync-pcs-photos', { competition_id: compId });
    status.textContent = result.message;
    status.className = 'text-success';
    if (result.log?.length) {
      log.innerHTML = result.log.join('<br>');
    }
    if (result.remaining > 0) {
      status.textContent += ' — klik nogmaals voor de rest';
      status.className = 'text-warning';
    }
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

  const pcsUrl = buildPcsStageUrl(comp, stage.stage_number);

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
        payload.push({ rider_id: rider.id, time_seconds: r.time_seconds, finish_position: r.finish_position || null, points: r.points, mountain_points: r.mountain_points, dnf: r.dnf });
      } else { unmatched++; }
    }

    if (!matched) {
      status.textContent = `Geen renners gekoppeld (${unmatched} onbekende bibnummers)`;
      status.className = 'text-danger';
      return;
    }

    status.textContent = `⏳ ${matched} resultaten opslaan...`;
    await supaRpc('admin_save_results', { p_stage_id: stageId, p_results: payload });
    await supaPatch('competitions', `id=eq.${activeCompId}`, { last_synced_at: new Date().toISOString() });

    status.textContent = `✅ ${matched} resultaten opgeslagen!` + (unmatched ? ` (${unmatched} onbekend)` : '');
    status.className = 'text-success';

    // Show top 10
    const winnerTime = payload.length ? payload[0].time_seconds : 0;
    const top10 = payload.slice(0, 10);
    log.innerHTML = `<strong>Top 10:</strong><br>` + top10.map((r, i) => {
      const rider = _riderMap[r.rider_id];
      const timeDisplay = i === 0 ? formatTime(r.time_seconds) : formatGap(r.time_seconds - winnerTime);
      return `${i + 1}. ${rider?.name || '?'} — ${timeDisplay}${r.dnf ? ' (DNF)' : ''}`;
    }).join('<br>');

    loadAdminResults();
  } catch (e) {
    status.textContent = e.message;
    status.className = 'text-danger';
  }
});

// Resync all locked stages with results from PCS
$('btn-pcs-resync-all').addEventListener('click', async () => {
  const comp = competitions.find(c => c.id === activeCompId);
  if (!comp?.pcs_url) { toast('Geen PCS URL ingesteld voor deze ronde', 'warning'); return; }
  if (!confirm('Alle vergrendelde etappes opnieuw syncen met PCS? Dit kan even duren.')) return;

  const status = $('pcs-results-sync-status');
  const log = $('pcs-results-sync-log');
  const lockedStages = activeStages().filter(s => s.locked);

  log.innerHTML = '';
  let success = 0, failed = 0;

  for (const stage of lockedStages) {
    const pcsUrl = buildPcsStageUrl(comp, stage.stage_number);
    status.textContent = `⏳ Etappe ${stage.stage_number} syncen...`;
    status.className = 'text-muted';
    log.innerHTML += `<div>⏳ Etappe ${stage.stage_number}...</div>`;

    try {
      const data = await callEdgeFunction('sync-pcs-results', { pcs_url: pcsUrl });
      if (!data.results?.length) {
        log.innerHTML += `<div class="text-warning">⚠ Etappe ${stage.stage_number}: geen resultaten</div>`;
        failed++;
        continue;
      }

      let matched = 0;
      const payload = [];
      for (const r of data.results) {
        const rider = riders.find(rd => rd.bib_number === r.bib_number);
        if (rider) {
          matched++;
          payload.push({ rider_id: rider.id, time_seconds: r.time_seconds, finish_position: r.finish_position || null, points: r.points, mountain_points: r.mountain_points, dnf: r.dnf });
        }
      }

      if (matched) {
        await supaRpc('admin_save_results', { p_stage_id: stage.id, p_results: payload });
        log.innerHTML += `<div class="text-success">✅ Etappe ${stage.stage_number}: ${matched} resultaten</div>`;
        success++;
      } else {
        log.innerHTML += `<div class="text-warning">⚠ Etappe ${stage.stage_number}: geen renners gekoppeld</div>`;
        failed++;
      }
    } catch (e) {
      log.innerHTML += `<div class="text-danger">❌ Etappe ${stage.stage_number}: ${e.message}</div>`;
      failed++;
    }

    // Scroll log to bottom
    log.scrollTop = log.scrollHeight;
    // Small delay to not overwhelm PCS
    await new Promise(r => setTimeout(r, 1500));
  }

  status.textContent = `✅ Klaar! ${success} gelukt, ${failed} mislukt van ${lockedStages.length} etappes`;
  status.className = success > 0 ? 'text-success' : 'text-danger';
  _cache.standings = null;
  _cache.participants = null;
});

// Auto-sync: sync etappes waarvan de geschatte eindtijd voorbij is
$('btn-auto-sync').addEventListener('click', async () => {
  const comp = competitions.find(c => c.id === activeCompId);
  if (!comp?.pcs_url) { toast('Geen PCS URL ingesteld voor deze ronde', 'warning'); return; }

  const now = new Date();
  const readyStages = activeStages().filter(s =>
    !s.locked && s.estimated_end_time && new Date(s.estimated_end_time) < now
  );

  if (!readyStages.length) {
    toast('Geen etappes klaar om te syncen (ETA nog niet bereikt)', 'info');
    return;
  }

  const status = $('pcs-results-sync-status');
  const log = $('pcs-results-sync-log');
  log.innerHTML = '';
  let success = 0, failed = 0;

  for (const stage of readyStages) {
    const pcsUrl = buildPcsStageUrl(comp, stage.stage_number);
    status.textContent = `⏳ Auto-sync etappe ${stage.stage_number}...`;
    status.className = 'text-muted';
    log.innerHTML += `<div>⏳ Etappe ${stage.stage_number} (ETA: ${new Date(stage.estimated_end_time).toLocaleTimeString('nl-NL', {hour:'2-digit',minute:'2-digit'})})...</div>`;

    try {
      const data = await callEdgeFunction('sync-pcs-results', { pcs_url: pcsUrl });
      if (!data.results?.length) {
        log.innerHTML += `<div class="text-warning">⚠ Etappe ${stage.stage_number}: nog geen resultaten op PCS</div>`;
        failed++;
        continue;
      }

      let matched = 0;
      const payload = [];
      for (const r of data.results) {
        const rider = riders.find(rd => rd.bib_number === r.bib_number);
        if (rider) {
          matched++;
          payload.push({ rider_id: rider.id, time_seconds: r.time_seconds, finish_position: r.finish_position || null, points: r.points, mountain_points: r.mountain_points, dnf: r.dnf });
        }
      }

      if (matched) {
        await supaRpc('admin_save_results', { p_stage_id: stage.id, p_results: payload });
        log.innerHTML += `<div class="text-success">✅ Etappe ${stage.stage_number}: ${matched} resultaten opgeslagen</div>`;
        success++;
      } else {
        log.innerHTML += `<div class="text-warning">⚠ Etappe ${stage.stage_number}: geen renners gekoppeld</div>`;
        failed++;
      }
    } catch (e) {
      log.innerHTML += `<div class="text-danger">❌ Etappe ${stage.stage_number}: ${e.message}</div>`;
      failed++;
    }

    log.scrollTop = log.scrollHeight;
    await new Promise(r => setTimeout(r, 1500));
  }

  status.textContent = `✅ Auto-sync klaar! ${success} gelukt, ${failed} mislukt`;
  status.className = success > 0 ? 'text-success' : 'text-danger';
  if (success > 0) {
    _cache.standings = null;
    _cache.participants = null;
    toast(`${success} etappe(s) automatisch gesynct`, 'success');
    loadAdminResults();
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
        const rider = _riderMap[r.rider_id];
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
function hideSplash() {
  const splash = $('splash');
  if (splash) { splash.classList.add('hide'); setTimeout(() => splash.remove(), 300); }
}

(async () => {
  const saved = localStorage.getItem('bagagedrager_session');
  if (saved) {
    try {
      session = JSON.parse(saved);

      // Als access token verlopen is, probeer eerst te refreshen
      if (session.expires_at && Date.now() / 1000 > session.expires_at) {
        if (!await refreshSession()) {
          throw new Error('Token expired en refresh mislukt');
        }
      }

      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'apikey': SUPABASE_ANON_KEY },
      });

      if (res.ok) {
        session.user = await res.json();
        await initApp();
        hideSplash();
        return;
      } else if (res.status === 401 && await refreshSession()) {
        const retry = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: { 'Authorization': `Bearer ${session.access_token}`, 'apikey': SUPABASE_ANON_KEY },
        });
        if (retry.ok) {
          session.user = await retry.json();
          await initApp();
          hideSplash();
          return;
        } else {
          throw new Error('Sessie verlopen');
        }
      } else {
        throw new Error('Sessie ongeldig');
      }
    } catch (e) {
      localStorage.removeItem('bagagedrager_session');
      session = null;
    }
  }
  // Geen geldige sessie: toon login scherm
  $('auth-screen').style.display = 'block';
  hideSplash();
})();
