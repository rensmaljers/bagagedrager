import { state } from '../state';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TEAMS, VAPID_PUBLIC_KEY } from '../config';
import { $, escapeHtml, formatTime, formatGap, formatDeadline, riderDisplay, avatarHtml, compBadge, skeletonRows, toast, confettiBurst } from '../utils';
import { supabase } from '../supabase-client';
import { icon } from '../icons';
import { supaRest, supaRpc } from '../api';
import { activeStages, buildPcsStageUrl, riderPhoto, teamBadge } from '../helpers';

// --- PICK VIEW ---
export async function loadPickView() {
  const compStages = activeStages();
  const sel = $('stage-select');
  const now = new Date();
  const typeLabels: Record<string, string> = { flat: '→', mountain: '▲', tt: '⏱', sprint: '⚡', hills: '~' };
  sel.innerHTML = compStages.map(s => {
    const locked = s.locked || now > new Date(s.deadline);
    const typeLabel = typeLabels[s.stage_type] || '';
    const stageLabel = s.stage_number === 0 ? 'Proloog' : `Etappe ${s.stage_number}`;
    return `<option value="${s.id}">${locked ? '🔒 ' : ''}${typeLabel} ${stageLabel}: ${s.name}</option>`;
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

export function renderPickStage() {
  const sel = $('stage-select');
  const stageId = parseInt(sel.value);
  const stage = state.stages.find(s => s.id === stageId);
  if (!stage) return;

  // Update prev/next buttons
  $('btn-prev-stage').disabled = sel.selectedIndex === 0;
  $('btn-next-stage').disabled = sel.selectedIndex === sel.options.length - 1;

  const now = new Date();
  const isLocked = stage.locked || now > new Date(stage.deadline);

  // Build PCS link for this stage
  const comp = state.competitions.find(c => c.id === stage.competition_id);
  const pcsStageUrl = buildPcsStageUrl(comp, stage.stage_number, stage);
  const pcsLink = pcsStageUrl ? ` <a href="${pcsStageUrl}" target="_blank" rel="noopener" class="pcs-link" title="Bekijk op PCS">PCS ↗</a>` : '';

  const pickStageLabel = stage.stage_number === 0 ? 'Proloog' : `Etappe ${stage.stage_number}`;
  $('pick-stage-name').innerHTML = `${pickStageLabel}: ${escapeHtml(stage.name)}${pcsLink}`;
  const stageDetails = [
    `Start: ${formatDeadline(stage.start_time || stage.deadline)}`,
    stage.distance_km ? `${stage.distance_km} km` : null,
    stage.departure && stage.arrival ? `${stage.departure} → ${stage.arrival}` : null,
    isLocked ? '(VERGRENDELD)' : null,
  ].filter(Boolean).join(' · ');
  $('pick-deadline').textContent = stageDetails;

  // Stats-strip in letour-stijl: Afstand / Type / Hoogtemeters
  const STAGE_TYPES = {
    flat: { label: 'Vlak', icon: 'bike' },
    sprint: { label: 'Sprint', icon: 'zap' },
    hills: { label: 'Heuvels', icon: 'chart' },
    mountain: { label: 'Bergrit', icon: 'mountain' },
    tt: { label: 'Tijdrit', icon: 'clock' },
  };
  const typeInfo = STAGE_TYPES[stage.stage_type];
  const stats = [
    stage.distance_km ? { icon: 'flag', label: 'Afstand', value: `${stage.distance_km} km` } : null,
    typeInfo ? { icon: typeInfo.icon, label: 'Type', value: typeInfo.label } : null,
    stage.vertical_meters ? { icon: 'mountain', label: 'Hoogtemeters', value: `${stage.vertical_meters} m` } : null,
  ].filter(Boolean);
  const statsEl = $('pick-stage-stats');
  if (statsEl) {
    statsEl.innerHTML = stats.length ? `<div class="stage-stats">` + stats.map(s => `
      <div class="stage-stat">
        <span class="stage-stat-icon">${icon(s.icon, '', 18)}</span>
        <span class="stage-stat-body"><span class="stage-stat-label">${s.label}</span><span class="stage-stat-value tnum">${s.value}</span></span>
      </div>`).join('') + `</div>` : '';
  }

  // Extra race-info badges (hoogtemeters zit al in de stats-strip)
  const infoBadges = [
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

  // Etappe-visuals: officiële ASO-afbeeldingen (profiel + kaart + interactieve
  // route) hebben voorrang, PCS-profiel is fallback. Meerdere visuals → toggle-chips.
  const profileContainer = $('pick-stage-profile');
  if (profileContainer) {
    const profileSrc = stage.official_profile_image_url || stage.profile_image_url;
    // onerror: officieel profiel → val terug op PCS; anders afbeelding weg
    const profileFallback = stage.official_profile_image_url && stage.profile_image_url
      ? `data-fb="${escapeHtml(stage.profile_image_url)}"` : '';
    const imgTag = (src, kind, hidden, alt, extra = '') =>
      `<img src="${escapeHtml(src)}" alt="${alt}" class="stage-profile-img" data-kind="${kind}" ${hidden ? 'hidden' : ''} ${extra} onclick="this.classList.toggle('expanded')" onerror="if(this.dataset.fb){this.src=this.dataset.fb;delete this.dataset.fb}else{this.hidden=true}">`;

    const visuals = [];
    if (profileSrc) visuals.push({ kind: 'profile', label: 'Profiel', html: (hidden) => imgTag(profileSrc, 'profile', hidden, 'Etappeprofiel', profileFallback) });
    if (stage.route_map_url) visuals.push({ kind: 'map', label: 'Kaart', html: (hidden) => imgTag(stage.route_map_url, 'map', hidden, 'Routekaart') });
    // Interactieve kaart lazy: iframe-src pas zetten bij eerste activatie
    if (stage.interactive_map_url) visuals.push({ kind: 'route', label: 'Interactief', html: (hidden) =>
      `<div class="stage-route-frame" data-kind="route" ${hidden ? 'hidden' : ''}><iframe data-src="${escapeHtml(stage.interactive_map_url)}" title="Interactieve routekaart" loading="lazy" allowfullscreen allow="geolocation"></iframe></div>` });

    const tabs = visuals.length > 1
      ? `<div class="stage-visual-tabs">` + visuals.map((v, i) =>
          `<button type="button" class="stage-visual-tab ${i === 0 ? 'active' : ''}" data-kind="${v.kind}">${v.label}</button>`).join('') + `</div>`
      : '';
    profileContainer.innerHTML = tabs + visuals.map((v, i) => v.html(i !== 0)).join('');

    const activateFrame = (kind) => {
      if (kind !== 'route') return;
      const frame = profileContainer.querySelector('.stage-route-frame iframe') as HTMLIFrameElement | null;
      if (frame && !frame.src && frame.dataset.src) frame.src = frame.dataset.src;
    };
    profileContainer.querySelectorAll('.stage-visual-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = (btn as HTMLElement).dataset.kind;
        profileContainer.querySelectorAll('.stage-visual-tab').forEach(b => b.classList.toggle('active', b === btn));
        profileContainer.querySelectorAll('[data-kind]').forEach(el => {
          if (!el.classList.contains('stage-visual-tab')) (el as HTMLElement).hidden = (el as HTMLElement).dataset.kind !== kind;
        });
        activateFrame(kind);
      });
    });
  }
  $('pick-locked-msg').style.display = isLocked ? 'block' : 'none';

  const currentPick = state.myPicks.find(p => p.stage_id === stageId);
  state.selectedRiderId = currentPick?.rider_id || null;

  const compStageIds = new Set(activeStages().map(s => s.id));
  const usedInOtherStages = new Set(
    state.myPicks.filter(p => p.stage_id !== stageId && compStageIds.has(p.stage_id)).map(p => p.rider_id)
  );

  renderRiderGrid(usedInOtherStages, isLocked);
  $('btn-submit-pick').disabled = !state.selectedRiderId || isLocked;
  updatePickBar(stage, currentPick);
  updateRiderAvailability(usedInOtherStages);
  updateOthersPicks(stageId, isLocked);
}

function updateRiderAvailability(usedInOtherStages) {
  const stageId = parseInt($('stage-select').value);
  const stageRiderSet = state.stageRiders[stageId];
  const stageRiderList = (stageRiderSet && stageRiderSet.size > 0)
    ? state.riders.filter(r => stageRiderSet.has(r.id))
    : state.riders;
  const total = stageRiderList.length;
  const dnf = stageRiderList.filter(r => state.dnfRiderIds.has(r.id)).length;
  const used = stageRiderList.filter(r => usedInOtherStages.has(r.id) && !state.dnfRiderIds.has(r.id)).length;
  const available = total - used - dnf;
  $('rider-availability').innerHTML = `
    <span class="avail-stat available">${available} beschikbaar</span>
    <span class="avail-stat used">${used} gebruikt</span>
    ${dnf ? `<span class="avail-stat dnf">${dnf} uit koers</span>` : ''}
    <span class="avail-stat total">${total} totaal</span>`;
}

async function updateOthersPicks(stageId, isLocked) {
  const container = $('others-picks');
  const body = $('others-picks-body');
  if (!isLocked) { container.style.display = 'none'; return; }

  // Fetch picks for this stage from cache or API
  let stagePicks;
  if (state._cache.participantsCompId === state.activeCompId && state._cache.participants) {
    stagePicks = state._cache.participants.filter(p => p.stage_id === stageId);
  } else {
    stagePicks = await supaRest('stage_picks_public', {
      filters: `stage_id=eq.${stageId}&order=display_name`
    });
  }

  if (!stagePicks.length) { container.style.display = 'none'; return; }
  container.style.display = 'block';
  body.innerHTML = stagePicks.map(p => {
    const isMe = p.user_id === state.session.user.id;
    return `<div class="others-pick-row${isMe ? ' fw-bold' : ''}">
      <span>${escapeHtml(p.display_name)}</span>
      <span>${riderDisplay(p.rider_name, riderPhoto(p.rider_id))} ${teamBadge(p.rider_team)}${p.is_random ? ' <span class="badge bg-info" style="font-size:0.6rem;">🎡</span>' : ''}</span>
    </div>`;
  }).join('');
}

let _countdownInterval;
function updatePickBar(stage, currentPick) {
  const bar = $('pick-bar');
  const rider = state.selectedRiderId ? state._riderMap[state.selectedRiderId] : null;
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
    $('pick-bar-rider').innerHTML = `${riderDisplay(rider.name, rider.photo_url)} #${rider.bib_number} — ${status}`;
    // Bij wijziging: laat op een eigen regel zien welke bevestigde keuze vervangen wordt
    // (zelfde regel als de naam wordt op mobiel te lang)
    const currentRider = isChanged ? state._riderMap[currentPick.rider_id] : null;
    const replacesEl = $('pick-bar-replaces');
    replacesEl.textContent = currentRider ? `vervangt ${currentRider.name}` : '';
    replacesEl.style.display = currentRider ? 'block' : 'none';
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
  const stageId = parseInt($('stage-select').value);
  const stageRiderSet = state.stageRiders[stageId];
  // Bij klassiekers: filter op de startlijst van deze specifieke etappe
  const stageFilteredRiders = (stageRiderSet && stageRiderSet.size > 0)
    ? state.riders.filter(r => stageRiderSet.has(r.id))
    : state.riders;

  const search = $('rider-search').value.toLowerCase();
  const teamFilter = $('rider-team-filter').value;
  const nationalityFilter = $('rider-nationality-filter').value;
  const hideUsed = $('rider-hide-used').checked;

  // Herlaad dropdowns bij etappewissel (klassiekers hebben andere renners per etappe)
  if ($('rider-team-filter').options.length <= 1 || state._riderDropdownStageId !== stageId) {
    state._riderDropdownStageId = stageId;
    const teams = [...new Set(stageFilteredRiders.map(r => r.team))].sort();
    $('rider-team-filter').innerHTML = '<option value="">Alle teams</option>' +
      teams.map(t => `<option value="${t}">${t}</option>`).join('');
  }

  if ($('rider-nationality-filter').options.length <= 1 || state._riderDropdownStageId !== stageId) {
    const nats = [...new Set(stageFilteredRiders.map(r => r.nationality).filter(Boolean))].sort();
    $('rider-nationality-filter').innerHTML = '<option value="">Alle landen</option>' +
      nats.map(n => `<option value="${n}">${n}</option>`).join('');
  }

  const filtered = stageFilteredRiders.filter(r =>
    (r.name.toLowerCase().includes(search) || r.team.toLowerCase().includes(search)) &&
    (!teamFilter || r.team === teamFilter) &&
    (!nationalityFilter || r.nationality === nationalityFilter) &&
    (!hideUsed || (!usedInOtherStages.has(r.id) && !state.dnfRiderIds.has(r.id)))
  );

  // Group riders by team
  const grouped = {};
  for (const r of filtered) {
    if (!grouped[r.team]) grouped[r.team] = [];
    grouped[r.team].push(r);
  }
  const teamNames = Object.keys(grouped).sort();

  // Bevestigde keuze voor deze etappe blijft zichtbaar, ook als een andere renner geselecteerd is
  const currentPickRiderId = state.myPicks.find(p => p.stage_id === stageId)?.rider_id ?? null;

  $('rider-grid').innerHTML = teamNames.length ? teamNames.map(team => {
    const teamRiders = grouped[team];
    return `
      <div class="col-12 rider-team-group">
        <div class="team-group-header">${teamBadge(team)}</div>
        <div class="row g-2">
          ${teamRiders.map(r => {
            const used = usedInOtherStages.has(r.id);
            const dnf = state.dnfRiderIds.has(r.id);
            const blocked = used || dnf;
            const selected = r.id === state.selectedRiderId;
            const isCurrent = r.id === currentPickRiderId;
            return `
              <div class="col-6 col-md-4 col-lg-4">
                <div class="card pick-card ${selected ? 'selected' : ''} ${isCurrent && !selected ? 'current-pick' : ''} ${used ? 'used' : ''} ${dnf ? 'used dnf-rider' : ''}"
                     data-rider-id="${r.id}" ${fullyLocked || blocked ? '' : `onclick="selectRider(${r.id})"`}>
                  <div class="card-body py-2 px-3">
                    <div class="d-flex align-items-center gap-2">
                      ${r.photo_url && r.photo_url !== 'none' ? `<img src="${escapeHtml(r.photo_url)}" class="rider-photo" alt="" onerror="this.style.display='none'">` : ''}
                      <div class="flex-grow-1 min-width-0">
                        <div class="d-flex justify-content-between align-items-start">
                          <div class="fw-bold d-flex align-items-center gap-1" style="font-size:0.88rem;"><span class="text-truncate">${escapeHtml(r.name)}</span>${r.pcs_slug ? `<a href="https://www.procyclingstats.com/rider/${escapeHtml(r.pcs_slug)}" target="_blank" rel="noopener" class="rider-pcs-icon ms-auto" title="Bekijk op PCS" onclick="event.stopPropagation()">↗</a>` : ''}</div>
                          <span class="bib-badge">${r.bib_number}</span>
                        </div>
                        ${r.nationality ? `<div class="rider-specs">${[
                          r.nationality || null,
                          r.weight_kg ? `${r.weight_kg}kg` : null,
                        ].filter(Boolean).join(' ')}</div>` : ''}
                        ${dnf ? '<small class="text-secondary mt-1 d-block">Uit koers (DNF)</small>' : used ? '<small class="text-danger mt-1 d-block">Al gebruikt</small>' : isCurrent ? '<small class="current-pick-label mt-1 d-block">✓ Huidige keuze</small>' : ''}
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

window.selectRider = function selectRider(riderId) {
  state.selectedRiderId = riderId;
  const stageId = parseInt($('stage-select').value);
  const compStageIds = new Set(activeStages().map(s => s.id));
  const usedInOtherStages = new Set(
    state.myPicks.filter(p => p.stage_id !== stageId && compStageIds.has(p.stage_id)).map(p => p.rider_id)
  );
  const stage = state.stages.find(s => s.id === stageId);
  const isLocked = !stage || stage.locked || new Date() > new Date(stage.deadline);
  const currentPick = state.myPicks.find(p => p.stage_id === stageId);
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
$('rider-nationality-filter').addEventListener('change', () => renderPickStage());
$('rider-hide-used').addEventListener('change', () => renderPickStage());

// Filter toggle (mobiel)
$('filter-toggle').addEventListener('click', () => {
  const panel = document.getElementById('filter-panel')!;
  const btn = $('filter-toggle') as HTMLElement;
  const isOpen = panel.classList.toggle('open');
  btn.classList.toggle('active', isOpen);
  btn.setAttribute('aria-expanded', String(isOpen));
});

// Submit pick via Postgres RPC
$('btn-submit-pick').addEventListener('click', async () => {
  if (!state.selectedRiderId) return;
  const stageId = parseInt($('stage-select').value);
  const status = $('pick-status');
  try {
    status.textContent = 'Bezig...';
    status.className = 'ms-3 text-muted';
    const result = await supaRpc('submit_pick', { p_stage_id: stageId, p_rider_id: state.selectedRiderId });
    status.textContent = result.warning || 'Keuze opgeslagen!';
    status.className = result.warning ? 'ms-3 text-warning' : 'ms-3 text-success';
    if (!result.warning) { confettiBurst(); toast('Keuze bevestigd!', 'success'); }
    state.myPicks = await supaRest('picks', { filters: `user_id=eq.${state.session.user.id}&order=stage_id` });
    state._cache.standings = null; state._cache.participants = null;
    renderPickStage();
  } catch (e) {
    status.textContent = e.message;
    status.className = 'ms-3 text-danger';
  }
});

