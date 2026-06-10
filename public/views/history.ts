import { state } from '../state';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TEAMS, VAPID_PUBLIC_KEY } from '../config';
import { $, escapeHtml, formatTime, formatGap, formatDeadline, riderDisplay, avatarHtml, compBadge, skeletonRows, toast, confettiBurst } from '../utils';
import { supabase } from '../supabase-client';
import { icon } from '../icons';
import { supaRest } from '../api';
import { activeScoringMode, activeStages, teamBadge } from '../helpers';
import { computeAchievements, renderAchievements } from '../views/dashboard';

// --- HISTORY ---
export async function loadHistory() {
  const compStageIds = new Set(activeStages().map(s => s.id));
  const compPicks = state.myPicks.filter(p => compStageIds.has(p.stage_id));

  const stageIds = compPicks.map(p => p.stage_id);
  let allResults = [];
  let allPicksForStages = [];
  if (stageIds.length) {
    // Eerst picks ophalen, dan stage_results filteren op gekozen renners.
    // PostgREST max-rows=1000 is server-side; bij ~150 renners × 7+ etappes raak je die limiet.
    // Door te filteren op picked rider IDs blijf je altijd ver onder 1000 rijen.
    allPicksForStages = await supaRest('picks', {
      select: 'stage_id,rider_id',
      filters: `stage_id=in.(${stageIds.join(',')})`,
    });
    const pickedRiderIds = [...new Set(allPicksForStages.map((p: any) => p.rider_id))];
    if (pickedRiderIds.length) {
      allResults = await supaRest('stage_results', {
        filters: `stage_id=in.(${stageIds.join(',')})&rider_id=in.(${pickedRiderIds.join(',')})`,
      });
    }
  }

  // Count how many players picked each rider per stage
  const pickerCounts = {};
  for (const p of allPicksForStages) {
    const key = `${p.stage_id}_${p.rider_id}`;
    pickerCounts[key] = (pickerCounts[key] || 0) + 1;
  }

  // Winnaarstijd en naam per etappe — gebruik stages.winner_time_seconds als referentie
  // zodat tijdsverschillen correct zijn ook als de winnaar niet in riders staat
  const winnerTimes = {};
  const winnerNames = {};
  for (const stage of activeStages()) {
    if (stage.winner_time_seconds) winnerTimes[stage.id] = stage.winner_time_seconds;
    if (stage.winner_name) winnerNames[stage.id] = stage.winner_name;
  }
  // Vul aan met finish_position=1 voor etappes zonder stages.winner_time_seconds
  for (const r of allResults) {
    if (!winnerTimes[r.stage_id] && r.finish_position === 1 && !r.dnf && r.time_seconds > 0) {
      winnerTimes[r.stage_id] = r.time_seconds;
    }
    if (!winnerNames[r.stage_id] && r.finish_position === 1 && !r.dnf) {
      const wr = state._riderMap[r.rider_id];
      winnerNames[r.stage_id] = wr?.name || '?';
    }
  }
  // Straftijd per etappe: slechtste tijdsverschil van een gekozen renner
  const penaltyGaps = {};
  // Straftijd per etappe: MAX tijdsverschil van gekozen renners die wél finishten
  const pickedRiderIds = {};
  for (const p of allPicksForStages) {
    if (!pickedRiderIds[p.stage_id]) pickedRiderIds[p.stage_id] = new Set();
    pickedRiderIds[p.stage_id].add(p.rider_id);
  }
  for (const r of allResults) {
    if (!r.dnf && r.time_seconds > 0 && winnerTimes[r.stage_id] && pickedRiderIds[r.stage_id]?.has(r.rider_id)) {
      const gap = r.time_seconds - winnerTimes[r.stage_id];
      if (gap > (penaltyGaps[r.stage_id] ?? -1)) penaltyGaps[r.stage_id] = gap;
    }
  }

  // Build rows with game_points for coloring
  const rows = compPicks.map(pick => {
    const stage = state.stages.find(s => s.id === pick.stage_id);
    const rider = state._riderMap[pick.rider_id];
    const result = allResults.find(r => r.stage_id === pick.stage_id && r.rider_id === pick.rider_id);
    const gp = result && !pick.is_late && !result.dnf ? (result.game_points || 0) : 0;
    const timeGap = result && result.time_seconds && winnerTimes[pick.stage_id]
      ? Math.max(result.time_seconds - winnerTimes[pick.stage_id], 0) : null;
    const bonif = result && !pick.is_late && !result.dnf ? (result.bonification_seconds || 0) : 0;
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
    const totalGp = withResults.reduce((s, r) => s + r.gp, 0);
    const avg = Math.round(totalGp / withResults.length);

    // Favoriete renner: meest gekozen in deze competitie
    const riderPickCount: Record<number, number> = {};
    for (const r of rows) if (r.rider) riderPickCount[r.rider.id] = (riderPickCount[r.rider.id] || 0) + 1;
    const favRiderId = Object.entries(riderPickCount).sort((a, b) => +b[1] - +a[1])[0]?.[0];
    const favRider = favRiderId ? rows.find(r => r.rider?.id === +favRiderId)?.rider : null;
    const favCount = favRiderId ? riderPickCount[+favRiderId] : 0;

    // Etappewinnaars
    const winCount = withResults.filter(r => r.result?.finish_position === 1 && !r.pick.is_late && !r.result?.dnf).length;

    $('history-stats').innerHTML = `
      <div class="col-4"><div class="card"><div class="card-body py-2 px-3 text-center">
        <div class="text-muted" style="font-size:0.7rem;">Favoriete renner</div>
        <div style="font-size:0.85rem; font-weight:700; margin:2px 0;">${favRider ? riderDisplay(favRider.name, favRider.photo_url) : '—'}</div>
        <div style="font-size:0.7rem; color:var(--text-muted);">${favCount}× gekozen</div>
      </div></div></div>
      <div class="col-4"><div class="card"><div class="card-body py-2 px-3 text-center">
        <div class="text-muted" style="font-size:0.7rem;">Gemiddeld</div>
        <div style="font-size:1.1rem; font-weight:700;">${avg} pts</div>
        <div style="font-size:0.75rem;">${withResults.length} etappes</div>
      </div></div></div>
      <div class="col-4"><div class="card"><div class="card-body py-2 px-3 text-center">
        <div class="text-muted" style="font-size:0.7rem;">Etappewinnaars ⭐</div>
        <div style="font-size:1.6rem; font-weight:700; color:var(--green);">${winCount}</div>
        <div style="font-size:0.7rem; color:var(--text-muted);">van ${withResults.length} etappes</div>
      </div></div></div>`;

    // Achievements
    const badges = computeAchievements(compPicks, allResults, state.stages, allPicksForStages);
    if (badges.length) {
      $('history-stats').innerHTML += `<div class="col-12">${renderAchievements(badges)}</div>`;
    }
  } else {
    $('history-stats').innerHTML = '';
  }

  const histIsClassic = activeScoringMode() === 'classic';
  $('history-table-header').innerHTML = histIsClassic
    ? '<th>Etappe</th><th>Renner</th><th class="text-end">Tijd</th><th class="text-end mob-hide"><span class="info-tooltip" data-tip="Sprintpunten uit het puntenklassement">Pts &#9432;</span></th><th class="text-end mob-hide"><span class="info-tooltip" data-tip="Bergpunten (KOM)">Berg &#9432;</span></th><th class="text-end"><span class="info-tooltip" data-tip="Spelpunten op basis van finishpositie, na deelpenalty">Spel &#9432;</span></th><th>Status</th>'
    : '<th>Etappe</th><th>Renner</th><th class="text-end"><span class="info-tooltip" data-tip="Tijdsverschil met etappewinnaar">Verschil &#9432;</span></th><th class="text-end mob-hide"><span class="info-tooltip" data-tip="Bonificatie: 1e −10s, 2e −6s, 3e −4s">Bonif. &#9432;</span></th><th class="text-end mob-hide"><span class="info-tooltip" data-tip="Sprintpunten uit het puntenklassement">Pts &#9432;</span></th><th class="text-end mob-hide"><span class="info-tooltip" data-tip="Bergpunten (KOM)">Berg &#9432;</span></th><th class="text-end"><span class="info-tooltip" data-tip="1 punt als je de etappewinnaar correct voorspelde">&#11088; &#9432;</span></th><th>Status</th>';
  $('history-table').innerHTML = rows.map(({ pick, stage, rider, result, gp, timeGap, bonif, rowClass, numPickers, sharingPct }) => {
    const isWinner = result && !pick.is_late && !result.dnf && result.finish_position === 1;
    const combativityCell = !histIsClassic
      ? `<td class="text-end">${isWinner ? '<span style="color:var(--green);font-weight:700;">⭐ 1</span>' : (result ? '0' : '-')}</td>`
      : `<td class="text-end">${gp}</td>`;
    return `<tr class="${rowClass}">
      <td><div>${stage ? (stage.stage_number === 0 ? 'Proloog' : `Etappe ${stage.stage_number}`) : '?'}</div>${winnerNames[pick.stage_id] ? `<div style="font-size:0.65rem;color:var(--text-muted);">${icon('trophy', '', 11)} ${escapeHtml(winnerNames[pick.stage_id])}</div>` : ''}</td>
      <td>${riderDisplay(rider?.name, rider?.photo_url)} <span class="team-badge-sm">${rider ? teamBadge(rider.team) : ''}</span></td>
      <td class="time text-end">${!histIsClassic && result ? (result.finish_position === 1 ? formatTime(result.time_seconds) : (result.dnf || pick.is_late) ? (penaltyGaps[pick.stage_id] != null ? formatGap(penaltyGaps[pick.stage_id]) : '-') : formatGap(timeGap)) : result ? formatTime(result.time_seconds) : '-'}</td>
      ${!histIsClassic ? `<td class="text-end mob-hide">${bonif ? '-' + bonif + 's' : '-'}</td>` : ''}
      <td class="text-end mob-hide">${result ? (pick.is_late ? '0' : result.points) : '-'}</td>
      <td class="text-end mob-hide">${result ? (pick.is_late ? '0' : result.mountain_points) : '-'}</td>
      ${combativityCell}
      <td>${pick.is_late ? '<span class="badge bg-warning">Te laat</span>' : ''}${pick.is_random ? '<span class="badge bg-info">🎡 Rad</span>' : ''}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="${histIsClassic ? 7 : 8}">
    <div class="empty-state">
      <div class="empty-state-icon">${icon('target', '', 32)}</div>
      <div class="empty-state-text">Nog geen keuzes gemaakt.<br>Ga naar de Keuze tab om je eerste renner te kiezen!</div>
    </div></td></tr>`;
}

