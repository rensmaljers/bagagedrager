import { state } from '../state';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TEAMS, VAPID_PUBLIC_KEY } from '../config';
import { $, escapeHtml, formatTime, formatGap, formatDeadline, riderDisplay, avatarHtml, compBadge, skeletonRows, toast, confettiBurst } from '../utils';
import { supabase } from '../supabase-client';
import { icon } from '../icons';
import { supaPatch, supaRest } from '../api';
import { activeScoringMode, buildPcsStageUrl, riderPhoto, teamBadge } from '../helpers';

// --- DEELNEMERS (picks van iedereen, zichtbaar na deadline) ---
// --- PELOTON: alle gebruikers met wielren-rollen ---
function getPelotonRole(p, totalPicks) {
  if (p.is_admin) return { name: 'Ploegleider', badge: 'bg-danger', icon: icon('shield', '', 13) };
  if (totalPicks >= 15) return { name: 'Kopman', badge: 'bg-warning text-dark', icon: icon('crown', '', 13) };
  if (totalPicks >= 5) return { name: 'Luitenant', badge: 'bg-primary', icon: icon('star', '', 13) };
  if (totalPicks >= 1) return { name: 'Knecht', badge: 'bg-success', icon: icon('bike', '', 13) };
  return { name: 'Stagiair', badge: 'bg-secondary', icon: icon('cyclist', '', 13) };
}

export async function loadPeloton() {
  const [allProfiles, allPicks] = await Promise.all([
    state._cache.allProfiles || supaRest('profiles', { filters: 'order=created_at' }),
    supaRest('picks', { select: 'user_id' }),
  ]);
  const isAdmin = state.profile?.is_admin;

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
        <div class="d-flex align-items-center gap-2">
          <span>${escapeHtml(p.display_name)}</span>
          <span class="badge ${role.badge} d-md-none" style="font-size:0.65rem;">${role.icon} ${role.name}</span>
        </div>
        ${extras.length ? `<div class="d-flex align-items-center gap-2 mt-1">${extras.join('')}</div>` : ''}
        ${mottoHtml}
      </td>
      ${isAdmin ? `<td style="font-size:0.8rem;">${escapeHtml(p.email || '-')}</td>` : ''}
      <td class="d-none d-md-table-cell"><span class="badge ${role.badge}">${role.icon} ${role.name}</span></td>
      <td class="d-none d-md-table-cell">${new Date(p.created_at).toLocaleDateString('nl-NL')}</td>
      <td class="d-none d-md-table-cell" style="font-size:0.8rem;color:var(--text-muted);">${p.last_seen_at ? new Date(p.last_seen_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
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

export async function loadParticipants() {
  if (!state.activeCompId) {
    $('participants-content').innerHTML = '<p class="text-muted">Geen ronde geselecteerd</p>';
    return;
  }

  // Fetch public picks (view only shows locked/past-deadline stages) — cached
  let allPicks;
  if (state._cache.participantsCompId === state.activeCompId && state._cache.participants) {
    allPicks = state._cache.participants;
  } else {
    allPicks = await supaRest('stage_picks_public', {
      filters: `competition_id=eq.${state.activeCompId}&order=stage_number.desc,display_name`
    });
    state._cache.participants = allPicks;
    state._cache.participantsCompId = state.activeCompId;
  }

  if (!allPicks.length) {
    $('participants-content').innerHTML = '<p class="text-muted">Nog geen keuzes zichtbaar. Keuzes worden getoond na de deadline.</p>';
    return;
  }

  // Winnaar per etappe: gebruik winner_name uit stage_picks_public (= stages.winner_name)
  // of val terug op finish_position=1 uit stage_results
  const lockedStageIds = [...new Set(allPicks.map(p => p.stage_id))];
  const stageWinners = {};

  // Eerst: stage.winner_name via allPicks (stage_picks_public bevat winner_name)
  for (const p of allPicks) {
    if (p.winner_name && !stageWinners[p.stage_id]) {
      const stg = state.stages.find(s => s.id === p.stage_id);
      stageWinners[p.stage_id] = { name: p.winner_name, time: stg?.winner_time_seconds || 0 };
    }
  }

  // Fallback: finish_position=1 uit stage_results voor etappes zonder winner_name
  const missingWinnerStageIds = lockedStageIds.filter(id => !stageWinners[id]);
  if (missingWinnerStageIds.length) {
    const winnerResults = await supaRest('stage_results', {
      select: 'stage_id,rider_id,time_seconds,finish_position',
      filters: `stage_id=in.(${missingWinnerStageIds.join(',')})&finish_position=eq.1`
    });
    for (const w of winnerResults) {
      const rider = state._riderMap[w.rider_id];
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
    const partComp = state.competitions.find(c => c.id === state.activeCompId);
    const partStage = state.stages.find(s => s.competition_id === state.activeCompId && s.stage_number === num);
    const partPcsUrl = buildPcsStageUrl(partComp, num, partStage);
    const partPcsLink = partPcsUrl ? ` <a href="${partPcsUrl}" target="_blank" rel="noopener" class="pcs-link" title="Bekijk op PCS">PCS ↗</a>` : '';
    const stageName = `Etappe ${num}${partPcsLink}`;
    const stageId = byStage[num].stage_id;
    const winner = stageWinners[stageId];
    const winnerInfo = winner ? `<span style="font-size:0.75rem; color:var(--text-muted); font-weight:400; margin-left:0.5rem;">${icon('trophy', '', 12)} ${escapeHtml(winner.name)} — ${formatTime(winner.time)}</span>` : '';
    const header = isClassic
      ? '<tr><th>Speler</th><th>Renner</th><th class="text-end">Positie</th><th class="text-end"><span class="info-tooltip" data-tip="Spelpunten op basis van positie, na deelpenalty">Spel &#9432;</span></th><th>Status</th></tr>'
      : '<tr><th>Speler</th><th>Renner</th><th class="text-end"><span class="info-tooltip" data-tip="Tijdsverschil met etappewinnaar">Verschil &#9432;</span></th><th class="text-end"><span class="info-tooltip" data-tip="Bonificatieseconden uit PCS (finish + tussensprints), worden van AK-tijd afgetrokken">Bonif. &#9432;</span></th><th class="text-end"><span class="info-tooltip" data-tip="Sprintpunten uit puntenklassement">Pts &#9432;</span></th><th class="text-end"><span class="info-tooltip" data-tip="Bergpunten (KOM)">Berg &#9432;</span></th><th>Status</th></tr>';
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
                const stg = state.stages.find(s => s.id === p.stage_id);
                const isLocked = stg?.locked;
                const sharingPct = p.num_pickers <= 1 ? 100 : p.num_pickers === 2 ? 80 : p.num_pickers === 3 ? 60 : p.num_pickers === 4 ? 40 : 20;
                const pickersBadge = isClassic && isLocked && p.num_pickers > 1 ? ` <span class="badge bg-secondary" style="font-size:0.6rem;">${p.num_pickers}x → ${sharingPct}%</span>` : '';
                if (isClassic) {
                  return `<tr>
                  <td>${escapeHtml(p.display_name)}</td>
                  <td>${riderDisplay(p.rider_name, riderPhoto(p.rider_id))} <span class="team-badge-sm">${teamBadge(p.rider_team)}</span>${pickersBadge}</td>
                  <td class="text-end">${p.finish_position || '-'}</td>
                  <td class="text-end">${p.effective_game_points != null ? p.effective_game_points : '-'}</td>
                  <td>${p.is_late ? '<span class="badge bg-warning">Te laat</span>' : ''}${p.is_random ? '<span class="badge bg-info">🎡 Rad</span>' : ''}${p.dnf ? '<span class="badge bg-danger">DNF</span>' : ''}</td>
                </tr>`;
                }
                return `<tr>
                <td>${escapeHtml(p.display_name)}</td>
                <td>${escapeHtml(p.rider_name)} <span class="team-badge-sm">${teamBadge(p.rider_team)}</span>${pickersBadge}</td>
                <td class="time text-end">${p.finish_position === 1 ? formatTime(p.time_seconds) : (p.dnf || p.is_late) ? (p.dnf_penalty_gap != null ? formatGap(p.dnf_penalty_gap) : '-') : (p.time_gap != null ? formatGap(p.time_gap) : '-')}</td>
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

