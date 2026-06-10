import { state } from './state';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TEAMS, VAPID_PUBLIC_KEY } from './config';
import { $, escapeHtml, formatTime, formatGap, formatDeadline, riderDisplay, avatarHtml, compBadge, skeletonRows, toast, confettiBurst } from './utils';
import { supabase } from './supabase-client';
import { icon } from './icons';
import { supaDelete, supaPatch, supaRest, supaRpc, supaUpsert } from './api';
import { initApp, loadDnfRiderIds, loadRidersForComp } from './app';
import { signup } from './auth';
import { activeStages, applyCompColor, buildPcsStageUrl, teamBadge, updateCompBanner, updateCompSelectOptions } from './helpers';
import { loadStandings } from './views/dashboard';
import { loadPeloton } from './views/peloton';

// =====================
// ADMIN PANEL
// =====================

export async function loadAdminView() {
  await Promise.all([
    loadAdminUsers(),
    loadAdminCompetitions(),
    loadAdminRiders(),
    loadAdminStages(),
  ]);
  loadImportCompSelect();
  loadAdminResults();
  loadAdminPot();
}

// --- ADMIN: GEBRUIKERS ---
async function loadAdminUsers() {
  const allProfiles = await supaRpc('admin_users_with_status');
  $('user-count').textContent = `${allProfiles.length} spelers`;
  $('admin-users-table').innerHTML = allProfiles.map(p => {
    const isSelf = p.id === state.profile?.id;
    const emailConfirmed = !!p.email_confirmed_at;
    return `<tr style="${p.is_active === false ? 'opacity:0.5;' : ''}">
      <td>${escapeHtml(p.display_name)}</td>
      <td>
        ${p.is_admin ? '<span class="badge bg-danger">Admin</span>' : ''}
        ${p.is_active === false ? '<span class="badge bg-secondary">Inactief</span>' : '<span class="badge bg-success">Actief</span>'}
        ${!emailConfirmed ? '<span class="badge bg-warning text-dark">E-mail onbevestigd</span>' : ''}
      </td>
      <td>${new Date(p.created_at).toLocaleDateString('nl-NL')}</td>
      <td style="font-size:0.8rem;">${p.last_seen_at ? new Date(p.last_seen_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : (p.last_sign_in_at ? new Date(p.last_sign_in_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) + ' (auth)' : '—')}</td>
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
          ${!emailConfirmed ? `<button class="btn btn-sm btn-outline-warning"
                  onclick="confirmUserEmail('${p.id}')">
            Bevestig e-mail
          </button>` : ''}
          <button class="btn btn-sm btn-outline-info"
                  onclick="resetPassword('${escapeHtml(p.email || '')}')">
            Reset ww
          </button>
          <button class="btn btn-sm btn-outline-primary"
                  onclick="openAdminPicks('${p.id}', '${escapeHtml(p.display_name).replace(/'/g, "\\'")}')">
            Keuzes
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

window.confirmUserEmail = async function(userId) {
  await supaRpc('admin_confirm_email', { target_user_id: userId });
  loadAdminUsers();
};

// --- ADMIN: Keuzes van andere spelers bewerken ---
(window as any).openAdminPicks = async function(userId, displayName) {
  const overlay = $('admin-picks-overlay');
  $('admin-picks-title').textContent = `Keuzes — ${displayName}`;
  $('admin-picks-content').innerHTML = '<p class="text-muted">Laden…</p>';
  overlay.style.display = 'flex';
  try {
    const compStages = activeStages();
    if (!compStages.length) {
      $('admin-picks-content').innerHTML = '<p class="text-muted">Geen etappes in deze ronde</p>';
      return;
    }
    const stageIds = compStages.map(s => s.id);
    const userPicks = await supaRest('picks', {
      filters: `user_id=eq.${userId}&stage_id=in.(${stageIds.join(',')})`,
    });
    const pickMap = new Map(userPicks.map(p => [p.stage_id, p]));
    const usedRiderIds = new Set(userPicks.map(p => p.rider_id));

    const ridersSorted = [...state.riders].sort((a, b) =>
      (a.team || '').localeCompare(b.team || '') || a.name.localeCompare(b.name)
    );

    $('admin-picks-content').innerHTML = `
      <div class="table-responsive-wrapper">
        <table class="table table-sm table-striped mb-0">
          <thead><tr><th>Etappe</th><th>Huidige keuze</th><th>Wijzigen naar</th><th></th></tr></thead>
          <tbody>
            ${compStages.map(s => {
              const pick = pickMap.get(s.id);
              const currentRider = pick ? state.riders.find(r => r.id === pick.rider_id) : null;
              const options = ridersSorted.map(r => {
                const disabled = usedRiderIds.has(r.id) && (!pick || pick.rider_id !== r.id);
                const selected = pick?.rider_id === r.id;
                return `<option value="${r.id}" ${disabled ? 'disabled' : ''} ${selected ? 'selected' : ''}>${escapeHtml(r.name)} (${escapeHtml(r.team || '')})</option>`;
              }).join('');
              const isLateDefault = pick ? pick.is_late : false;
              return `<tr>
                <td style="white-space:nowrap;">E${s.stage_number}${s.locked ? ' 🔒' : ''}</td>
                <td>${currentRider ? escapeHtml(currentRider.name) + (pick.is_late ? ' <span class="badge bg-warning">laat</span>' : '') : '<span class="text-muted">—</span>'}</td>
                <td>
                  <select class="form-select form-select-sm admin-pick-rider" data-stage-id="${s.id}">
                    <option value="">-- kies --</option>
                    ${options}
                  </select>
                  <label style="font-size:0.7rem;" class="mt-1 d-block">
                    <input type="checkbox" class="admin-pick-late" data-stage-id="${s.id}" ${isLateDefault ? 'checked' : ''}> laat (geen punten)
                  </label>
                </td>
                <td style="white-space:nowrap;">
                  <button class="btn btn-sm btn-primary" onclick="saveAdminPick('${userId}', ${s.id})">Opslaan</button>
                  ${pick ? `<button class="btn btn-sm btn-outline-danger" onclick="deleteAdminPick('${userId}', ${s.id})">×</button>` : ''}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p class="text-muted mt-2" style="font-size:0.75rem;">Wijzigingen zijn direct van kracht. Punten worden automatisch herberekend.</p>
    `;
  } catch (e) {
    $('admin-picks-content').innerHTML = `<p class="text-danger">${escapeHtml(e.message)}</p>`;
  }
};

window.saveAdminPick = async function(userId, stageId) {
  const sel = document.querySelector(`select.admin-pick-rider[data-stage-id="${stageId}"]`);
  const lateCb = document.querySelector(`input.admin-pick-late[data-stage-id="${stageId}"]`);
  const riderId = parseInt(sel.value);
  if (!riderId) { toast('Kies een renner', 'warning'); return; }
  try {
    await supaRpc('admin_upsert_pick', {
      p_user_id: userId,
      p_stage_id: stageId,
      p_rider_id: riderId,
      p_is_late: !!lateCb?.checked,
    });
    toast('Keuze opgeslagen — scores herverdeeld', 'success');
    const title = $('admin-picks-title').textContent.replace('Keuzes — ', '');
    (window as any).openAdminPicks(userId, title);
    state._cache.standings = null;
    loadStandings();
  } catch (e) { toast(e.message, 'error'); }
};

window.deleteAdminPick = async function(userId, stageId) {
  if (!confirm('Keuze verwijderen?')) return;
  try {
    await supaRpc('admin_delete_pick', { p_user_id: userId, p_stage_id: stageId });
    toast('Keuze verwijderd', 'success');
    const title = $('admin-picks-title').textContent.replace('Keuzes — ', '');
    (window as any).openAdminPicks(userId, title);
    loadStandings();
  } catch (e) { toast(e.message, 'error'); }
};

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
  state.competitions = await supaRest('competitions', { filters: 'order=year.desc,name' });
  updateCompSelectOptions();

  $('admin-comp-table').innerHTML = state.competitions.map(c => `
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
      <td>
        <div class="input-group input-group-sm" style="width:90px;">
          <span class="input-group-text" style="font-size:0.75rem;">€</span>
          <input type="number" class="form-control form-control-sm" value="${c.entry_fee ?? ''}" min="1" max="999" placeholder="—"
                 style="width:55px;" onchange="updateCompField(${c.id}, 'entry_fee', this.value ? parseInt(this.value) : null)">
        </div>
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
    const comp = state.competitions.find(c => c.id === compId);
    if (comp) comp[field] = value;
    if (field === 'color' || field === 'country_flag') {
      updateCompBanner();
      applyCompColor();
    }
    if (field === 'scoring_mode') {
      state._cache.standings = null;
      state._cache.participants = null;
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

// --- ADMIN: POT ---
async function loadAdminPot() {
  // Vul dropdown met alle rondes
  const sel = $('pot-comp-select') as HTMLSelectElement;
  if (!sel) return;
  if (sel.options.length === 0) {
    state.competitions.forEach(c => {
      const opt = document.createElement('option');
      opt.value = String(c.id);
      opt.textContent = `${c.name} (${c.year})`;
      sel.appendChild(opt);
    });
    // Selecteer actieve ronde standaard
    if (state.activeCompId) sel.value = String(state.activeCompId);
  }

  const compId = parseInt(sel.value);
  if (!compId) return;
  const comp = state.competitions.find(c => c.id === compId);
  const entryFee = comp?.entry_fee;

  // Haal betaalstatus op
  const participants = await supaRest('competition_participants', {
    select: 'user_id,has_paid',
    filters: `competition_id=eq.${compId}`,
  });
  const paidMap: Record<string, boolean> = {};
  (participants || []).forEach((p: any) => { paidMap[p.user_id] = p.has_paid; });

  const paidCount = Object.values(paidMap).filter(Boolean).length;
  const totalPot = entryFee ? paidCount * entryFee : 0;

  const badge = $('pot-total-badge');
  if (badge) {
    badge.innerHTML = entryFee
      ? `💰 <strong>€${totalPot}</strong> in de pot &nbsp;<span class="text-muted" style="font-size:0.8rem;">(${paidCount} × €${entryFee})</span>`
      : `<span class="text-muted" style="font-size:0.8rem;">Stel inleg in via Rondes-tab</span>`;
  }

  const wrap = $('pot-players-table');
  if (!wrap) return;

  // Haal actieve spelers op
  const profiles = state._cache.allProfiles || await supaRest('profiles', { filters: 'is_active=eq.true&order=display_name' });

  wrap.innerHTML = `
    <table class="table table-sm table-striped">
      <thead><tr><th>Speler</th><th>Betaald</th></tr></thead>
      <tbody>
        ${profiles.map((p: any) => {
          const paid = !!paidMap[p.id];
          return `<tr>
            <td>${escapeHtml(p.display_name || p.email || '?')}</td>
            <td>
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" ${paid ? 'checked' : ''}
                  onchange="togglePotPayment(${compId}, '${p.id}', this.checked)">
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

window.togglePotPayment = async function(compId: number, userId: string, paid: boolean) {
  try {
    await supaUpsert('competition_participants', {
      competition_id: compId,
      user_id: userId,
      has_paid: paid,
      paid_at: paid ? new Date().toISOString() : null,
    });
    const comp = state.competitions.find(c => c.id === compId);
    if (comp?.entry_fee) {
      // Badge bijwerken zonder volledige herlaad
      loadAdminPot();
    }
  } catch (e: any) { toast(e.message, 'error'); }
};

// --- ADMIN: RENNERS ---

async function loadAdminRiders() {
  const sel = $('admin-rider-comp-filter');
  const current = sel.value;
  sel.innerHTML = '<option value="">Alle rondes</option>' +
    state.competitions.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  if (current) sel.value = current;

  const compId = sel.value;
  state.allRiders = await supaRest('riders', {
    filters: compId ? `competition_id=eq.${compId}&order=bib_number` : 'order=bib_number',
  });
  renderAdminRiders();
}

function renderAdminRiders(filter = '') {
  const filtered = filter
    ? state.allRiders.filter(r => r.name.toLowerCase().includes(filter) || r.team.toLowerCase().includes(filter))
    : state.allRiders;

  $('admin-riders-table').innerHTML = filtered.map(r => `
    <tr>
      <td>${r.bib_number}</td>
      <td>${r.name}${r.photo_url && r.photo_url !== 'none' ? ` <img src="${escapeHtml(r.photo_url)}" style="height:20px;border-radius:2px;vertical-align:middle;" onerror="this.remove()">` : ''}</td>
      <td>${teamBadge(r.team)}</td>
      <td class="d-flex gap-1 flex-wrap">
        <button class="btn btn-sm ${r.dnf ? 'btn-danger' : 'btn-outline-secondary'}" onclick="toggleRiderDnf(${r.id}, ${!!r.dnf})" title="DNF aan/uit">${r.dnf ? '⬛ Uit koers' : '✅ In koers'}</button>
        <button class="btn btn-sm btn-outline-secondary" onclick="resetRiderPhoto(${r.id})" title="Foto resetten zodat scraper opnieuw haalt">📷</button>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteRider(${r.id})">🗑</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="text-muted">Geen renners gevonden</td></tr>';
}

$('admin-rider-comp-filter').addEventListener('change', async () => {
  const compId = $('admin-rider-comp-filter').value;
  state.allRiders = await supaRest('riders', {
    filters: compId ? `competition_id=eq.${compId}&order=bib_number` : 'order=bib_number',
  });
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
  const compId = parseInt($('admin-rider-comp-filter').value) || state.activeCompId;
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

window.resetRiderPhoto = async function(riderId) {
  try {
    await supaPatch('riders', `id=eq.${riderId}`, { photo_url: null });
    toast('Foto gereset — sync opnieuw om nieuwe foto op te halen', 'success');
    loadAdminRiders();
  } catch (e) { toast(e.message, 'error'); }
};

window.toggleRiderDnf = async function(riderId, currentDnf) {
  try {
    await supaPatch('riders', `id=eq.${riderId}`, { dnf: !currentDnf });
    await loadDnfRiderIds();
    loadAdminRiders();
  } catch (e) { toast(e.message, 'error'); }
};

// --- ADMIN: ETAPPES ---
async function loadAdminStages() {
  state.stages = await supaRest('stages', { filters: 'order=stage_number' });

  $('new-stage-comp').innerHTML = state.competitions.map(c =>
    `<option value="${c.id}">${c.name}</option>`
  ).join('');

  const typeLabels = { flat: 'Vlak', mountain: 'Berg', tt: 'Tijdrit', sprint: 'Sprint' };

  $('admin-stages-table').innerHTML = state.stages.map(s => {
    const comp = state.competitions.find(c => c.id === s.competition_id);
    const winnerTimeVal = s.winner_time_seconds
      ? `${Math.floor(s.winner_time_seconds / 60)}:${String(s.winner_time_seconds % 60).padStart(2, '0')}`
      : '';
    return `<tr>
      <td>${s.stage_number}</td>
      <td>${s.name}</td>
      <td>${comp ? comp.name : '<span class="text-muted">-</span>'}</td>
      <td>${new Date(s.date).toLocaleDateString('nl-NL')}</td>
      <td>${s.start_time ? new Date(s.start_time).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
      <td>${typeLabels[s.stage_type] || s.stage_type}</td>
      <td>
        <div class="input-group input-group-sm" style="min-width:180px;">
          <input type="url" class="form-control form-control-sm" value="${escapeHtml(s.pcs_url || '')}"
                 placeholder="PCS URL etappe" style="font-size:0.7rem;"
                 onchange="updateStagePcsUrl(${s.id}, this.value)">
          ${s.pcs_url ? `<button class="btn btn-outline-primary btn-sm" onclick="syncStageFromPcs(${s.id}, ${s.competition_id})" title="Sync deze etappe">⟳</button>` : ''}
        </div>
      </td>
      <td>${s.locked
        ? '<span class="badge bg-secondary">Vergrendeld</span>'
        : '<span class="badge bg-success">Open</span>'}</td>
      <td>
        <input type="text" class="form-control form-control-sm" value="${winnerTimeVal}"
               placeholder="M:SS" style="width:70px;font-size:0.7rem;" title="Winnaarstijd (M:SS)"
               onchange="updateStageWinnerTime(${s.id}, this.value)">
        <button class="btn btn-sm btn-outline-${s.locked ? 'success' : 'warning'}"
                onclick="toggleStageLock(${s.id}, ${!s.locked})">
          ${s.locked ? 'Ontgrendel' : 'Vergrendel'}
        </button>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteStage(${s.id})">Verwijder</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" class="text-muted">Geen etappes</td></tr>';
}

$('btn-add-stage').addEventListener('click', async () => {
  const num = parseInt($('new-stage-num').value);
  const name = $('new-stage-name').value.trim();
  const date = $('new-stage-date').value;
  const startTime = $('new-stage-starttime').value || '12:00';
  const type = $('new-stage-type').value;
  const compId = parseInt($('new-stage-comp').value);
  if (isNaN(num) || !name || !date || !compId) return toast('Vul alle velden in', 'warning');

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

window.updateStagePcsUrl = async function(stageId, pcsUrl) {
  try {
    await supaPatch('stages', `id=eq.${stageId}`, { pcs_url: pcsUrl.trim() || null });
    const stage = state.stages.find(s => s.id === stageId);
    if (stage) stage.pcs_url = pcsUrl.trim() || null;
    loadAdminStages();
  } catch (e) { toast(e.message, 'error'); }
};

window.updateStageWinnerTime = async function(stageId, timeStr) {
  const clean = timeStr.trim();
  let secs: number | null = null;
  if (clean) {
    const parts = clean.split(':').map(Number);
    secs = parts.length === 2 ? parts[0] * 60 + parts[1] : parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : Number(parts[0]);
    if (isNaN(secs) || secs <= 0) { toast('Ongeldige tijd (gebruik M:SS of H:MM:SS)', 'error'); return; }
  }
  try {
    await supaPatch('stages', `id=eq.${stageId}`, { winner_time_seconds: secs });
    const stage = state.stages.find(s => s.id === stageId);
    if (stage) stage.winner_time_seconds = secs;
    toast('Winnaarstijd opgeslagen', 'success');
  } catch (e) { toast(e.message, 'error'); }
};

window.syncStageFromPcs = async function(stageId, compId) {
  const status = $('pcs-sync-status');
  const log = $('pcs-sync-log');
  status.textContent = '⏳ Etappe syncen met PCS...';
  status.className = 'text-muted';
  log.innerHTML = '';

  try {
    const result = await callEdgeFunction('sync-pcs-race', {
      competition_id: compId,
      stage_id: stageId,
    });

    if (result.shirts && Object.keys(result.shirts).length) {
      const existingShirts = JSON.parse(localStorage.getItem('bagagedrager_shirts') || '{}');
      localStorage.setItem('bagagedrager_shirts', JSON.stringify({ ...existingShirts, ...result.shirts }));
    }

    status.textContent = '✅ Etappe sync voltooid!';
    status.className = 'text-success';
    log.innerHTML = (result.log || []).join('<br>');

    loadAdminStages();
    loadAdminRiders();
    await loadRidersForComp();
  } catch (e) {
    status.textContent = e.message;
    status.className = 'text-danger';
  }
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
      'Authorization': `Bearer ${state.session?.access_token}`,
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
  const comp = state.competitions.find(c => c.id === compId);
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

$('btn-pcs-sync-startlist').addEventListener('click', async () => {
  const compId = parseInt($('race-sync-comp').value);
  const comp = state.competitions.find(c => c.id === compId);
  const status = $('pcs-sync-status');
  const log = $('pcs-sync-log');
  const btn = $('btn-pcs-sync-startlist') as HTMLButtonElement;

  if (!comp) { status.textContent = 'Kies een ronde'; status.className = 'text-danger'; return; }
  if (!comp.pcs_url) { status.textContent = 'Stel eerst een PCS URL in bij de ronde'; status.className = 'text-danger'; return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span>Bezig…';
  status.textContent = '';
  log.innerHTML = '';

  try {
    const result = await callEdgeFunction('sync-pcs-race', {
      pcs_url: comp.pcs_url,
      competition_id: compId,
      startlist_only: true,
    });
    status.textContent = '✅ Startlijst bijgewerkt!';
    status.className = 'text-success';
    log.innerHTML = (result.log || []).join('<br>');
    loadAdminRiders();
    await loadRidersForComp();
  } catch (e) {
    status.textContent = (e as Error).message;
    status.className = 'text-danger';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔄 Startlijst bijwerken';
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

// Koppel PCS-resultaat aan rider_id. Bij duplicates (zelfde pcs_slug, meerdere
// rider entries) gaat pcs_slug-match voor bib-match, en gepickte riders voor
// niet-gepickte — zodat de juiste rider_id wordt gebruikt.
async function buildPcsPayload(results: any[], stageId: number) {
  const stagePicks = await supaRest('picks', { select: 'rider_id', filters: `stage_id=eq.${stageId}` });
  const pickedIds = new Set<number>(stagePicks.map((p: any) => p.rider_id as number));

  function matchRider(r: any) {
    if (r.pcs_slug) {
      const hit = state.riders.find(rd => rd.pcs_slug === r.pcs_slug && pickedIds.has(rd.id));
      if (hit) return hit;
      const fallback = state.riders.find(rd => rd.pcs_slug === r.pcs_slug);
      if (fallback) return fallback;
    }
    if (r.bib_number) {
      const hit = state.riders.find(rd => rd.bib_number === r.bib_number && pickedIds.has(rd.id));
      if (hit) return hit;
      return state.riders.find(rd => rd.bib_number === r.bib_number);
    }
    return undefined;
  }

  let matched = 0, unmatched = 0;
  const payload: any[] = [];
  for (const r of results) {
    const rider = matchRider(r);
    if (rider) {
      matched++;
      payload.push({ rider_id: rider.id, time_seconds: r.time_seconds, finish_position: r.finish_position || null, points: r.points, mountain_points: r.mountain_points, bonification_seconds: r.bonification_seconds || 0, dnf: r.dnf });
    } else { unmatched++; }
  }
  return { payload, matched, unmatched };
}

$('btn-pcs-sync-results').addEventListener('click', async () => {
  const stageId = parseInt($('sync-stage-select').value);
  const stage = state.stages.find(s => s.id === stageId);
  const status = $('pcs-results-sync-status');
  const log = $('pcs-results-sync-log');

  if (!stage) { status.textContent = 'Kies een etappe'; status.className = 'text-danger'; return; }

  const comp = state.competitions.find(c => c.id === stage.competition_id);
  if (!comp?.pcs_url && !stage.pcs_url) { status.textContent = 'Geen PCS URL ingesteld voor deze ronde of etappe'; status.className = 'text-danger'; return; }

  const pcsUrl = buildPcsStageUrl(comp, stage.stage_number, stage);

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

    // Match riders: pcs_slug vóór bib, gepickte riders vóór andere
    const { payload, matched, unmatched } = await buildPcsPayload(data.results, stageId);

    if (!matched) {
      status.textContent = `Geen renners gekoppeld (${unmatched} onbekend)`;
      status.className = 'text-danger';
      return;
    }

    status.textContent = `⏳ ${matched} resultaten opslaan...`;
    await supaRpc('admin_save_results', { p_stage_id: stageId, p_results: payload });

    // Sla de echte PCS-winnaarstijd op bij de etappe (ook als die renner niet in riders staat)
    // Gebruik ALLEEN pcs_slug voor de koppeling — bibnummers zijn race-specifiek en
    // matchen niet betrouwbaar op onze interne sequentiële bibs.
    const pcsWinner = data.results[0];
    if (pcsWinner && pcsWinner.time_seconds > 0) {
      const winnerRider = pcsWinner.pcs_slug
        ? state.riders.find(rd => rd.pcs_slug === pcsWinner.pcs_slug)
        : null;
      await supaPatch('stages', `id=eq.${stageId}`, {
        winner_time_seconds: pcsWinner.time_seconds,
        winner_name: winnerRider?.name || pcsWinner.pcs_name || null,
      });
      // Herlaad stages zodat winner_name direct zichtbaar is
      state.stages = await supaRest('stages', { filters: 'order=stage_number' });
    }

    await supaPatch('competitions', `id=eq.${state.activeCompId}`, { last_synced_at: new Date().toISOString() });

    status.textContent = `✅ ${matched} resultaten opgeslagen!` + (unmatched ? ` (${unmatched} onbekend)` : '');
    status.className = 'text-success';

    // Toon Top 10 gebaseerd op PCS-uitslag (niet op payload-volgorde)
    const pcsWinnerTime = pcsWinner?.time_seconds || 0;
    const top10PCS = data.results.slice(0, 10);
    log.innerHTML = `<strong>Top 10 (PCS):</strong><br>` + top10PCS.map((r, i) => {
      const rider = state.riders.find(rd =>
        (r.pcs_slug && rd.pcs_slug === r.pcs_slug) ||
        (r.bib_number && rd.bib_number === r.bib_number)
      );
      const timeDisplay = i === 0 ? formatTime(r.time_seconds) : formatGap(r.time_seconds - pcsWinnerTime);
      const matchMark = rider ? '' : ' ⚠️ niet in startlijst';
      return `${i + 1}. ${rider?.name || r.pcs_slug || '?'} — ${timeDisplay}${r.dnf ? ' (DNF)' : ''}${matchMark}`;
    }).join('<br>');

    loadAdminResults();
  } catch (e) {
    status.textContent = e.message;
    status.className = 'text-danger';
  }
});

// Force sync: overschrijft ook manually_edited=true rows (p_manual=true)
// Gebruik dit als de normale sync verkeerde data heeft opgeslagen (bijv. verkeerde tab gepakt).
$('btn-pcs-force-sync-results').addEventListener('click', async () => {
  const stageId = parseInt($('sync-stage-select').value);
  const stage = state.stages.find(s => s.id === stageId);
  const status = $('pcs-results-sync-status');
  const log = $('pcs-results-sync-log');

  if (!stage) { status.textContent = 'Kies een etappe'; status.className = 'text-danger'; return; }

  const comp = state.competitions.find(c => c.id === stage.competition_id);
  if (!comp?.pcs_url && !stage.pcs_url) { status.textContent = 'Geen PCS URL ingesteld'; status.className = 'text-danger'; return; }

  if (!confirm(`⚠️ FORCE SYNC: etappe ${stage.stage_number || 'P'} (${stage.name})\n\nDit overschrijft ALLE opgeslagen uitslagen voor deze etappe, ook handmatig bewerkte. Gebruik dit alleen als de normale sync verkeerde data heeft opgeslagen.\n\nDoorgaan?`)) return;

  const pcsUrl = buildPcsStageUrl(comp, stage.stage_number, stage);
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

    const { payload, matched, unmatched } = await buildPcsPayload(data.results, stageId);

    if (!matched) {
      status.textContent = `Geen renners gekoppeld (${unmatched} onbekend)`;
      status.className = 'text-danger';
      return;
    }

    status.textContent = `⏳ ${matched} resultaten opslaan (force)...`;
    // p_manual: true → overschrijft ook manually_edited=true rows
    await supaRpc('admin_save_results', { p_stage_id: stageId, p_results: payload, p_manual: true });

    const pcsWinner = data.results[0];
    if (pcsWinner && pcsWinner.time_seconds > 0) {
      const winnerRider = pcsWinner.pcs_slug
        ? state.riders.find(rd => rd.pcs_slug === pcsWinner.pcs_slug)
        : null;
      await supaPatch('stages', `id=eq.${stageId}`, {
        winner_time_seconds: pcsWinner.time_seconds,
        winner_name: winnerRider?.name || pcsWinner.pcs_name || null,
      });
      state.stages = await supaRest('stages', { filters: 'order=stage_number' });
    }

    await supaPatch('competitions', `id=eq.${state.activeCompId}`, { last_synced_at: new Date().toISOString() });

    status.textContent = `✅ Force sync: ${matched} resultaten overschreven!` + (unmatched ? ` (${unmatched} onbekend)` : '');
    status.className = 'text-success';

    const pcsWinnerTime = pcsWinner?.time_seconds || 0;
    const top10PCS = data.results.slice(0, 10);
    log.innerHTML = `<strong>Top 10 (PCS, na force sync):</strong><br>` + top10PCS.map((r, i) => {
      const rider = state.riders.find(rd =>
        (r.pcs_slug && rd.pcs_slug === r.pcs_slug) ||
        (r.bib_number && rd.bib_number === r.bib_number)
      );
      const timeDisplay = i === 0 ? formatTime(r.time_seconds) : formatGap(r.time_seconds - pcsWinnerTime);
      const matchMark = rider ? '' : ' ⚠️ niet in startlijst';
      return `${i + 1}. ${rider?.name || r.pcs_slug || '?'} — ${timeDisplay}${r.dnf ? ' (DNF)' : ''}${matchMark}`;
    }).join('<br>');

    loadAdminResults();
  } catch (e) {
    status.textContent = e.message;
    status.className = 'text-danger';
  }
});

// Resync all locked stages with results from PCS
$('btn-pcs-resync-all').addEventListener('click', async () => {
  const comp = state.competitions.find(c => c.id === state.activeCompId);
  const hasAnyPcsUrl = comp?.pcs_url || activeStages().some(s => s.pcs_url);
  if (!hasAnyPcsUrl) { toast('Geen PCS URL ingesteld voor deze ronde of etappes', 'warning'); return; }
  if (!confirm('Alle vergrendelde etappes opnieuw syncen met PCS? Dit kan even duren.')) return;

  const status = $('pcs-results-sync-status');
  const log = $('pcs-results-sync-log');
  const lockedStages = activeStages().filter(s => s.locked);

  log.innerHTML = '';
  let success = 0, failed = 0;

  for (const stage of lockedStages) {
    const pcsUrl = buildPcsStageUrl(comp, stage.stage_number, stage);
    if (!pcsUrl) { log.innerHTML += `<div class="text-warning">⚠ Etappe ${stage.stage_number}: geen PCS URL</div>`; failed++; continue; }
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

      const { payload, matched } = await buildPcsPayload(data.results, stage.id);

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
  state._cache.standings = null;
  state._cache.participants = null;
});

// Auto-sync: sync etappes waarvan de geschatte eindtijd voorbij is
$('btn-auto-sync').addEventListener('click', async () => {
  const comp = state.competitions.find(c => c.id === state.activeCompId);
  const hasAnyPcsUrl2 = comp?.pcs_url || activeStages().some(s => s.pcs_url);
  if (!hasAnyPcsUrl2) { toast('Geen PCS URL ingesteld voor deze ronde of etappes', 'warning'); return; }

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
    const pcsUrl = buildPcsStageUrl(comp, stage.stage_number, stage);
    if (!pcsUrl) { log.innerHTML += `<div class="text-warning">⚠ Etappe ${stage.stage_number}: geen PCS URL</div>`; failed++; continue; }
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

      const { payload, matched } = await buildPcsPayload(data.results, stage.id);

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
    state._cache.standings = null;
    state._cache.participants = null;
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
    const rider = state.riders.find(rd => rd.bib_number === r.bib_number);
    if (rider) {
      matched++;
      payload.push({ rider_id: rider.id, time_seconds: r.time_seconds, points: r.points, mountain_points: r.mountain_points, dnf: r.dnf });
    } else { unmatched++; }
  }

  if (!matched) { status.textContent = `Geen renners gekoppeld (${unmatched} onbekende bibnummers)`; status.className = 'text-danger'; return; }

  status.textContent = `⏳ ${matched} resultaten opslaan...`;
  status.className = 'text-muted';

  try {
    await supaRpc('admin_save_results', { p_stage_id: stageId, p_results: payload, p_manual: true });
    status.textContent = `✅ ${matched} resultaten opgeslagen!` + (unmatched ? ` (${unmatched} onbekend)` : '');
    status.className = 'text-success';

    // Preview top 10
    const top10 = payload.slice(0, 10);
    preview.innerHTML = `<table class="table table-sm mb-0">
      <thead><tr><th>Renner</th><th>Tijd</th><th>Pts</th><th>DNF</th></tr></thead>
      <tbody>${top10.map(r => {
        const rider = state._riderMap[r.rider_id];
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
        <thead><tr><th>Renner</th><th>Tijd (sec)</th><th>Pts</th><th>Berg Pts</th><th>Boni (s)</th><th>DNF</th></tr></thead>
        <tbody>
          ${state.riders.map(r => `
            <tr data-rider-id="${r.id}">
              <td>${r.name} ${teamBadge(r.team)}</td>
              <td><input type="number" class="form-control form-control-sm res-time" value="0" min="0" /></td>
              <td><input type="number" class="form-control form-control-sm res-pts" value="0" min="0" /></td>
              <td><input type="number" class="form-control form-control-sm res-mt" value="0" min="0" /></td>
              <td><input type="number" class="form-control form-control-sm res-bonus" value="0" min="0" /></td>
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
      row.querySelector('.res-bonus').value = r.bonification_seconds || 0;
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
    const bonus = parseInt(row.querySelector('.res-bonus').value) || 0;
    const dnf = row.querySelector('.res-dnf').checked;
    if (time > 0 || pts > 0 || mt > 0 || bonus > 0 || dnf) {
      results.push({ rider_id: parseInt(row.dataset.riderId), time_seconds: time, points: pts, mountain_points: mt, bonification_seconds: bonus, dnf });
    }
  });

  const status = $('admin-status');
  try {
    status.textContent = 'Opslaan...';
    status.className = 'ms-3 text-muted';
    const res = await supaRpc('admin_save_results', { p_stage_id: stageId, p_results: results, p_manual: true });
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
        state.teamShirts = { ...state.teamShirts, ...shirts };
        localStorage.setItem('bagagedrager_shirts', JSON.stringify(state.teamShirts));
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
      state.teamShirts = { ...state.teamShirts, ...shirts };
      localStorage.setItem('bagagedrager_shirts', JSON.stringify(state.teamShirts));
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
  const opts = state.competitions.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  ['import-stage-comp', 'import-rider-comp', 'sync-stages-comp', 'race-sync-comp'].forEach(id => {
    const sel = $(id);
    if (sel) sel.innerHTML = opts;
  });
}

// Edge Function race sync removed — using console script approach instead

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

