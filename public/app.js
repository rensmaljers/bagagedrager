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
  if (lower.includes('database error saving new user')) return 'Het maximaal aantal spelers is bereikt (50). Neem contact op met de beheerder.';
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

$('btn-logout').addEventListener('click', () => {
  session = null; profile = null;
  localStorage.removeItem('bagagedrager_session');
  $('app').style.display = 'none';
  $('auth-screen').style.display = 'block';
});

// --- COMPETITION SELECTOR ---
$('comp-select').addEventListener('change', async () => {
  activeCompId = parseInt($('comp-select').value);
  await loadRidersForComp();
  const activeTab = document.querySelector('#main-tabs .nav-link.active');
  if (activeTab) activeTab.click();
});

// --- INIT ---
async function initApp() {
  localStorage.setItem('bagagedrager_session', JSON.stringify(session));

  const profiles = await supaRest('profiles', { filters: `id=eq.${session.user.id}` });
  profile = profiles[0];

  $('user-name').textContent = profile?.display_name || session.user.email;
  $('auth-screen').style.display = 'none';
  $('app').style.display = 'block';

  if (profile?.is_admin) $('admin-tab').style.display = 'block';

  competitions = await supaRest('competitions', { filters: 'order=year.desc,name' });
  stages = await supaRest('stages', { filters: 'order=stage_number' });

  const sel = $('comp-select');
  sel.innerHTML = competitions.map(c =>
    `<option value="${c.id}" ${c.is_active ? 'selected' : ''}>${c.name}</option>`
  ).join('');
  const active = competitions.find(c => c.is_active) || competitions[0];
  if (active) { sel.value = active.id; activeCompId = active.id; }

  await loadRidersForComp();
  myPicks = await supaRest('picks', { filters: `user_id=eq.${session.user.id}&order=stage_id` });

  // Navigate to hash tab or default to dashboard
  const hashTab = window.location.hash.replace('#', '');
  if (hashTab && document.querySelector(`[data-tab="${hashTab}"]`)) {
    navigateToTab(hashTab);
  } else {
    loadStandings();
  }
}

async function loadRidersForComp() {
  if (activeCompId) {
    riders = await supaRest('riders', { filters: `competition_id=eq.${activeCompId}&order=bib_number` });
  } else {
    riders = await supaRest('riders', { filters: 'order=bib_number' });
  }
}

// --- DASHBOARD ---
async function loadStandings() {
  if (!activeCompId) {
    const empty = '<tr><td colspan="3"><div class="empty-state"><div class="empty-state-icon">🏁</div><div class="empty-state-text">Selecteer een competitie om het klassement te zien</div></div></td></tr>';
    $('gc-table').innerHTML = empty;
    $('points-table').innerHTML = empty;
    $('mountain-table').innerHTML = empty;
    return;
  }

  const standings = await supaRest('general_classification', {
    filters: `competition_id=eq.${activeCompId}`
  });

  const emptyRow = '<tr><td colspan="3" class="text-muted text-center py-3">Nog geen resultaten — wordt zichtbaar na de eerste etappe</td></tr>';
  const medal = ['🥇', '🥈', '🥉'];

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

// --- PICK VIEW ---
async function loadPickView() {
  myPicks = await supaRest('picks', { filters: `user_id=eq.${session.user.id}&order=stage_id` });

  const compStages = activeStages();
  const sel = $('stage-select');
  sel.innerHTML = compStages.map(s =>
    `<option value="${s.id}">Etappe ${s.stage_number}: ${s.name}</option>`
  ).join('');

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
  $('pick-deadline').textContent = `Deadline: ${formatDeadline(stage.deadline)}${isLocked ? ' (VERGRENDELD)' : ''}`;
  $('pick-locked-msg').style.display = isLocked ? 'block' : 'none';

  const currentPick = myPicks.find(p => p.stage_id === stageId);
  selectedRiderId = currentPick?.rider_id || null;

  const compStageIds = new Set(activeStages().map(s => s.id));
  const usedInOtherStages = new Set(
    myPicks.filter(p => p.stage_id !== stageId && compStageIds.has(p.stage_id)).map(p => p.rider_id)
  );

  renderRiderGrid(usedInOtherStages, isLocked && !currentPick);
  $('btn-submit-pick').disabled = !selectedRiderId || (isLocked && !currentPick);
}

function renderRiderGrid(usedInOtherStages, fullyLocked) {
  const search = $('rider-search').value.toLowerCase();
  const filtered = riders.filter(r =>
    r.name.toLowerCase().includes(search) || r.team.toLowerCase().includes(search)
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
}

$('rider-search').addEventListener('input', () => renderPickStage());

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
  } catch (e) {
    status.textContent = e.message;
    status.className = 'ms-3 text-danger';
  }
});

// --- HISTORY ---
async function loadHistory() {
  myPicks = await supaRest('picks', { filters: `user_id=eq.${session.user.id}&order=stage_id` });
  const compStageIds = new Set(activeStages().map(s => s.id));
  const compPicks = myPicks.filter(p => compStageIds.has(p.stage_id));

  const stageIds = compPicks.map(p => p.stage_id);
  let allResults = [];
  if (stageIds.length) {
    allResults = await supaRest('stage_results', { filters: `stage_id=in.(${stageIds.join(',')})` });
  }

  $('history-table').innerHTML = compPicks.map(pick => {
    const stage = stages.find(s => s.id === pick.stage_id);
    const rider = riders.find(r => r.id === pick.rider_id);
    const result = allResults.find(r => r.stage_id === pick.stage_id && r.rider_id === pick.rider_id);
    return `<tr>
      <td>Etappe ${stage?.stage_number || '?'}</td>
      <td>${rider?.name || '?'} ${rider ? teamBadge(rider.team) : ''}</td>
      <td class="time text-end">${result ? formatTime(result.time_seconds) : '-'}</td>
      <td class="text-end">${result ? (pick.is_late ? '0' : result.points) : '-'}</td>
      <td class="text-end">${result ? (pick.is_late ? '0' : result.mountain_points) : '-'}</td>
      <td>${pick.is_late ? '<span class="badge bg-warning">Te laat</span>' : ''}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6">
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

  $('peloton-table').innerHTML = allProfiles.map(p => {
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
    $('participants-content').innerHTML = '<p class="text-muted">Geen competitie geselecteerd</p>';
    return;
  }

  // Fetch public picks (view only shows locked/past-deadline stages)
  const allPicks = await supaRest('stage_picks_public', {
    filters: `competition_id=eq.${activeCompId}&order=stage_number.desc,display_name`
  });

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

  $('participants-content').innerHTML = stageNums.map(num => {
    const { picks } = byStage[num];
    const stageName = picks[0] ? `Etappe ${num}` : `Etappe ${num}`;
    return `
      <div class="card mb-3">
        <div class="card-header">
          <h6 class="mb-0" style="font-size:0.9rem;">${stageName}</h6>
        </div>
        <div class="card-body p-0">
          <table class="table table-sm mb-0">
            <thead><tr><th>Speler</th><th>Renner</th><th class="text-end">Tijd</th><th class="text-end">Pts</th><th class="text-end">Berg</th><th>Status</th></tr></thead>
            <tbody>
              ${picks.map(p => `<tr>
                <td>${escapeHtml(p.display_name)}</td>
                <td>${escapeHtml(p.rider_name)} ${teamBadge(p.rider_team)}</td>
                <td class="time text-end">${p.time_seconds ? formatTime(p.time_seconds) : '-'}</td>
                <td class="text-end">${p.points != null ? (p.is_late ? '0' : p.points) : '-'}</td>
                <td class="text-end">${p.mountain_points != null ? (p.is_late ? '0' : p.mountain_points) : '-'}</td>
                <td>${p.is_late ? '<span class="badge bg-warning">Te laat</span>' : ''}${p.dnf ? '<span class="badge bg-danger">DNF</span>' : ''}</td>
              </tr>`).join('')}
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
  loadAdminUsers();
  await loadAdminCompetitions();
  loadImportCompSelect();
  loadAdminRiders();
  loadAdminStages();
  loadAdminResults();
}

// --- ADMIN: GEBRUIKERS ---
async function loadAdminUsers() {
  const allProfiles = await supaRest('profiles', { filters: 'order=created_at' });
  $('user-count').textContent = `${allProfiles.length} / 50 spelers`;
  $('admin-users-table').innerHTML = allProfiles.map(p => `
    <tr>
      <td>${escapeHtml(p.display_name)}</td>
      <td>${p.is_admin ? '<span class="badge bg-danger">Admin</span>' : '<span class="badge bg-secondary">Speler</span>'}</td>
      <td>${new Date(p.created_at).toLocaleDateString('nl-NL')}</td>
      <td>
        <button class="btn btn-sm btn-outline-${p.is_admin ? 'secondary' : 'danger'}"
                onclick="toggleAdmin('${p.id}', ${!p.is_admin})">
          ${p.is_admin ? 'Verwijder admin' : 'Maak admin'}
        </button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="text-muted">Geen gebruikers</td></tr>';
}

// toggleAdmin is defined in the peloton section

// --- ADMIN: COMPETITIES ---
async function loadAdminCompetitions() {
  competitions = await supaRest('competitions', { filters: 'order=year.desc,name' });

  const sel = $('comp-select');
  const currentVal = sel.value;
  sel.innerHTML = competitions.map(c =>
    `<option value="${c.id}" ${c.is_active ? 'selected' : ''}>${c.name}</option>`
  ).join('');
  if (currentVal) sel.value = currentVal;

  $('admin-comp-table').innerHTML = competitions.map(c => `
    <tr>
      <td>${c.name}</td>
      <td>${compBadge(c.competition_type)}</td>
      <td>${c.year}</td>
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
  `).join('') || '<tr><td colspan="5" class="text-muted">Geen competities</td></tr>';
}

$('btn-add-comp').addEventListener('click', async () => {
  const name = $('new-comp-name').value.trim();
  const slug = $('new-comp-slug').value.trim();
  const type = $('new-comp-type').value;
  const year = parseInt($('new-comp-year').value);
  if (!name || !slug || !year) return alert('Vul alle velden in');
  try {
    await supaRest('competitions', { method: 'POST', body: { name, slug, competition_type: type, year, is_active: false } });
    $('new-comp-name').value = '';
    $('new-comp-slug').value = '';
    loadAdminCompetitions();
    loadAdminStages();
  } catch (e) { alert(e.message); }
});

window.toggleCompActive = async function(compId, active) {
  try {
    await supaPatch('competitions', `id=eq.${compId}`, { is_active: active });
    loadAdminCompetitions();
  } catch (e) { alert(e.message); }
};

window.deleteComp = async function(compId) {
  if (!confirm('Weet je het zeker? Dit verwijdert de competitie.')) return;
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
  sel.innerHTML = '<option value="">Alle competities</option>' +
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
  if (!compId) return alert('Selecteer eerst een competitie');
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
      <td>${comp ? compBadge(comp.competition_type) + ' ' + comp.name : '<span class="text-muted">-</span>'}</td>
      <td>${new Date(s.date).toLocaleDateString('nl-NL')}</td>
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
  }).join('') || '<tr><td colspan="7" class="text-muted">Geen etappes</td></tr>';
}

$('btn-add-stage').addEventListener('click', async () => {
  const num = parseInt($('new-stage-num').value);
  const name = $('new-stage-name').value.trim();
  const date = $('new-stage-date').value;
  const type = $('new-stage-type').value;
  const compId = parseInt($('new-stage-comp').value);
  if (!num || !name || !date || !compId) return alert('Vul alle velden in');

  const deadlineDate = new Date(date);
  deadlineDate.setDate(deadlineDate.getDate() - 1);
  deadlineDate.setHours(23, 0, 0, 0);

  try {
    await supaRest('stages', {
      method: 'POST',
      body: { stage_number: num, name, date, stage_type: type, deadline: deadlineDate.toISOString(), locked: false, competition_id: compId },
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

// --- ADMIN: PCS SYNC ---
let syncedResults = null;

async function loadSyncStageSelect() {
  const compStages = activeStages();
  const sel = $('sync-stage-select');
  sel.innerHTML = compStages.map(s =>
    `<option value="${s.id}">Etappe ${s.stage_number}: ${s.name}</option>`
  ).join('');
}

$('btn-sync-pcs').addEventListener('click', async () => {
  const url = $('pcs-results-url').value.trim();
  const stageId = parseInt($('sync-stage-select').value);
  const status = $('sync-status');
  const preview = $('sync-preview');

  if (!url) { status.textContent = 'Voer een PCS URL in'; status.className = 'text-danger'; return; }
  if (!stageId) { status.textContent = 'Selecteer een etappe'; status.className = 'text-danger'; return; }

  status.textContent = '🔄 Ophalen van PCS...';
  status.className = 'text-muted';
  preview.innerHTML = '';
  $('sync-actions').style.display = 'none';

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-pcs-results`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ pcs_url: url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sync mislukt');

    syncedResults = { stageId, results: data.results };

    // Match bib numbers to riders in our database
    let matched = 0, unmatched = 0;
    const matchedResults = data.results.map(r => {
      const rider = riders.find(rd => rd.bib_number === r.bib_number);
      if (rider) { matched++; return { ...r, rider_id: rider.id, rider_name: rider.name }; }
      unmatched++;
      return { ...r, rider_id: null, rider_name: `Onbekend (bib #${r.bib_number})` };
    });
    syncedResults.results = matchedResults;

    status.textContent = `✅ ${data.count} resultaten opgehaald (${matched} gekoppeld, ${unmatched} onbekend)`;
    status.className = matched > 0 ? 'text-success' : 'text-warning';

    // Show preview
    const top10 = matchedResults.filter(r => r.rider_id).slice(0, 10);
    preview.innerHTML = `<table class="table table-sm mb-0">
      <thead><tr><th>#</th><th>Renner</th><th>Tijd</th><th>Pts</th><th>Berg</th><th>DNF</th></tr></thead>
      <tbody>${top10.map((r, i) => `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(r.rider_name)}</td>
        <td class="time">${formatTime(r.time_seconds)}</td>
        <td>${r.points}</td>
        <td>${r.mountain_points}</td>
        <td>${r.dnf ? '⚠️' : ''}</td>
      </tr>`).join('')}
      ${matchedResults.filter(r => r.rider_id).length > 10 ? `<tr><td colspan="6" class="text-muted">...en ${matchedResults.filter(r => r.rider_id).length - 10} meer</td></tr>` : ''}
      </tbody></table>`;

    if (matched > 0) $('sync-actions').style.display = 'block';

  } catch (e) {
    status.textContent = `❌ ${e.message}`;
    status.className = 'text-danger';
  }
});

$('btn-save-synced').addEventListener('click', async () => {
  if (!syncedResults) return;
  const status = $('sync-save-status');
  const matched = syncedResults.results.filter(r => r.rider_id);

  status.textContent = `Opslaan van ${matched.length} resultaten...`;
  status.className = 'text-muted';

  try {
    const payload = matched.map(r => ({
      rider_id: r.rider_id,
      time_seconds: r.time_seconds,
      points: r.points,
      mountain_points: r.mountain_points,
      dnf: r.dnf,
    }));

    const result = await supaRpc('admin_save_results', {
      p_stage_id: syncedResults.stageId,
      p_results: payload,
    });

    status.textContent = `✅ ${matched.length} resultaten opgeslagen!`;
    status.className = 'text-success';
    syncedResults = null;
    $('sync-actions').style.display = 'none';
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
  if (!compId) { status.textContent = 'Selecteer een competitie'; status.className = 'text-danger'; return; }

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
        const deadlineDate = new Date(s.date);
        deadlineDate.setDate(deadlineDate.getDate() - 1);
        deadlineDate.setHours(23, 0, 0, 0);
        try {
          await supaRest('stages', {
            method: 'POST',
            body: { ...s, deadline: deadlineDate.toISOString(), locked: false, competition_id: compId },
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
          const deadlineDate = new Date(s.date);
          deadlineDate.setDate(deadlineDate.getDate() - 1);
          deadlineDate.setHours(23, 0, 0, 0);
          try {
            await supaRest('stages', {
              method: 'POST',
              body: { ...s, deadline: deadlineDate.toISOString(), locked: false, competition_id: compId },
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
  if (!compId) { status.textContent = 'Kies een competitie'; status.className = 'text-danger'; return; }

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
  if (!compId) { status.textContent = 'Kies een competitie'; status.className = 'text-danger'; return; }

  status.textContent = `Importeren van ${parsed.length} etappes...`;
  status.className = 'text-muted';
  let ok = 0, skip = 0;
  for (const s of parsed) {
    const deadlineDate = new Date(s.date);
    deadlineDate.setDate(deadlineDate.getDate() - 1);
    deadlineDate.setHours(23, 0, 0, 0);
    try {
      await supaRest('stages', {
        method: 'POST',
        body: { ...s, deadline: deadlineDate.toISOString(), locked: false, competition_id: compId },
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
