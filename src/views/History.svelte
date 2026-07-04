<script lang="ts">
  // Geport uit public/views/history.ts — gedrag 1-op-1.
  import { state as appState } from '../lib/state.svelte';
  import { formatTime, formatGap, riderDisplay } from '../lib/utils';
  import { icon } from '../lib/icons';
  import { supaRest } from '../lib/api';
  import { activeScoringMode, activeStages, teamBadge } from '../lib/helpers';

  let rows: any[] = $state([]);
  let isClassic = $state(false);
  let stats: any = $state(null);
  let badges: any[] = $state([]);
  let loaded = $state(false);

  // --- ACHIEVEMENTS ---
  // Gekopieerd uit public/views/dashboard.ts; zodra Dashboard.svelte bestaat hoort
  // deze berekening in een gedeelde module (of module-export van Dashboard).
  function computeAchievements(picks: any[], results: any[], stages: any[], allPicksForStages: any[] = []) {
    const found: any[] = [];
    if (!picks.length || !results.length) return found;

    // Etappewinnaar: jouw renner won de etappe
    const stageWins = picks.filter(p => {
      const r = results.find(r => r.stage_id === p.stage_id && r.rider_id === p.rider_id);
      return r && r.finish_position === 1 && !r.dnf && !p.is_late;
    });
    if (stageWins.length) found.push({ icon: '🏆', text: `${stageWins.length}x Etappewinnaar`, cls: 'gold' });

    // Podium: top 3 finish
    const podiums = picks.filter(p => {
      const r = results.find(r => r.stage_id === p.stage_id && r.rider_id === p.rider_id);
      return r && r.finish_position <= 3 && !r.dnf && !p.is_late;
    });
    if (podiums.length >= 3) found.push({ icon: '🥉', text: `${podiums.length}x Podium`, cls: 'green' });

    // IJzeren ploegleider: alle etappes op tijd gekozen
    const compStages = stages.filter(s => s.competition_id === appState.activeCompId && s.locked);
    const latePicks = picks.filter(p => p.is_late);
    if (compStages.length >= 3 && latePicks.length === 0) found.push({ icon: '🛡️', text: 'IJzeren Ploegleider', cls: 'purple' });

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
    if (maxStreak >= 3) found.push({ icon: '🔥', text: `${maxStreak}x Op Dreef`, cls: 'red' });

    // Underdog: enige speler die deze renner koos voor die etappe, en scoorde 50+
    const soloStages = picks.filter(pick => {
      const result = results.find(r => r.stage_id === pick.stage_id && r.rider_id === pick.rider_id);
      const gp = result && !pick.is_late && !result.dnf ? (result.game_points || 0) : 0;
      if (gp < 50) return false;
      const count = allPicksForStages.filter(p => p.stage_id === pick.stage_id && p.rider_id === pick.rider_id).length;
      return count <= 1;
    });
    if (soloStages.length) found.push({ icon: '🕵️', text: `${soloStages.length}x Underdog`, cls: 'purple' });

    return found;
  }

  async function loadHistory() {
    const compStageIds = new Set(activeStages().map((s: any) => s.id));
    const compPicks = appState.myPicks.filter((p: any) => compStageIds.has(p.stage_id));

    const stageIds = compPicks.map((p: any) => p.stage_id);
    let allResults: any[] = [];
    let allPicksForStages: any[] = [];
    if (stageIds.length) {
      // Eerst picks ophalen, dan stage_results filteren op gekozen renners.
      // PostgREST max-rows=1000 is server-side; bij ~150 renners × 7+ etappes raak je die limiet.
      // Door te filteren op picked rider IDs blijf je altijd ver onder 1000 rijen.
      allPicksForStages = await supaRest('picks', {
        select: 'stage_id,rider_id',
        filters: `stage_id=in.(${stageIds.join(',')})`,
      });
      const pickedIds = [...new Set(allPicksForStages.map((p: any) => p.rider_id))];
      if (pickedIds.length) {
        allResults = await supaRest('stage_results', {
          filters: `stage_id=in.(${stageIds.join(',')})&rider_id=in.(${pickedIds.join(',')})`,
        });
      }
    }

    // Count how many players picked each rider per stage
    const pickerCounts: Record<string, number> = {};
    for (const p of allPicksForStages) {
      const key = `${p.stage_id}_${p.rider_id}`;
      pickerCounts[key] = (pickerCounts[key] || 0) + 1;
    }

    // Winnaarstijd en naam per etappe — gebruik stages.winner_time_seconds als referentie
    // zodat tijdsverschillen correct zijn ook als de winnaar niet in riders staat
    const winnerTimes: Record<number, number> = {};
    const winnerNames: Record<number, string> = {};
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
        const wr = appState._riderMap[r.rider_id];
        winnerNames[r.stage_id] = wr?.name || '?';
      }
    }
    // Straftijd per etappe: MAX tijdsverschil van gekozen renners die wél finishten
    const penaltyGaps: Record<number, number> = {};
    const pickedRiderIds: Record<number, Set<number>> = {};
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

    const histIsClassic = activeScoringMode() === 'classic';

    // Build rows with game_points for coloring
    const builtRows = compPicks.map((pick: any) => {
      const stage = appState.stages.find((s: any) => s.id === pick.stage_id);
      const rider = appState._riderMap[pick.rider_id];
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
      // Voorberekende cel-teksten (identiek aan de template-literals in history.ts)
      const stageLabel = stage ? (stage.stage_number === 0 ? 'Proloog' : `Etappe ${stage.stage_number}`) : '?';
      const winnerName = winnerNames[pick.stage_id] || null;
      const isWinner = !!(result && !pick.is_late && !result.dnf && result.finish_position === 1);
      let timeCell: string;
      if (!histIsClassic && result) {
        timeCell = result.finish_position === 1
          ? formatTime(result.time_seconds)
          : (result.dnf || pick.is_late)
            ? (penaltyGaps[pick.stage_id] != null ? formatGap(penaltyGaps[pick.stage_id]) : '-')
            : formatGap(timeGap);
      } else {
        timeCell = result ? formatTime(result.time_seconds) : '-';
      }
      return { pick, stage, rider, result, gp, timeGap, bonif, rowClass, numPickers, sharingPct, stageLabel, winnerName, isWinner, timeCell };
    });

    // Stats
    const withResults = builtRows.filter(r => r.result);
    let newStats: any = null;
    let newBadges: any[] = [];
    if (withResults.length) {
      const totalGp = withResults.reduce((s, r) => s + r.gp, 0);
      const avg = Math.round(totalGp / withResults.length);

      // Favoriete renner: meest gekozen in deze competitie
      const riderPickCount: Record<number, number> = {};
      for (const r of builtRows) if (r.rider) riderPickCount[r.rider.id] = (riderPickCount[r.rider.id] || 0) + 1;
      const favRiderId = Object.entries(riderPickCount).sort((a, b) => +b[1] - +a[1])[0]?.[0];
      const favRider = favRiderId ? builtRows.find(r => r.rider?.id === +favRiderId)?.rider : null;
      const favCount = favRiderId ? riderPickCount[+favRiderId] : 0;

      // Etappewinnaars
      const winCount = withResults.filter(r => r.result?.finish_position === 1 && !r.pick.is_late && !r.result?.dnf).length;

      newStats = { favRider, favCount, avg, count: withResults.length, winCount };
      newBadges = computeAchievements(compPicks, allResults, appState.stages, allPicksForStages);
    }

    rows = builtRows;
    isClassic = histIsClassic;
    stats = newStats;
    badges = newBadges;
    loaded = true;
  }

  // Herlaadt automatisch bij mount en als picks/stages/actieve ronde wijzigen
  // (synchrone reads aan het begin van loadHistory zijn de dependencies).
  $effect(() => { loadHistory(); });
</script>

<div class="tab-section active" id="section-history">
  <div id="history-stats" class="row g-3 mb-3">
    {#if stats}
      <div class="col-4"><div class="history-stat">
        <div class="history-stat-label">Favoriete renner</div>
        <div class="history-stat-value" style="font-size:0.85rem;">{#if stats.favRider}{@html riderDisplay(stats.favRider.name, stats.favRider.photo_url, stats.favRider.id)}{:else}—{/if}</div>
        <div class="history-stat-sub">{stats.favCount}× gekozen</div>
      </div></div>
      <div class="col-4"><div class="history-stat">
        <div class="history-stat-label">Gemiddeld</div>
        <div class="history-stat-value">{stats.avg} pts</div>
        <div class="history-stat-sub">{stats.count} etappes</div>
      </div></div>
      <div class="col-4"><div class="history-stat">
        <div class="history-stat-label">Etappewinnaars</div>
        <div class="history-stat-value" style="color:var(--green); font-size:1.4rem;">{stats.winCount}</div>
        <div class="history-stat-sub">van {stats.count} etappes</div>
      </div></div>
      {#if badges.length}
        <div class="col-12">
          <div class="achievements-wrap">
            {#each badges as b}<span class="achievement-badge {b.cls}">{b.icon} {b.text}</span>{/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
  <div class="card">
    <div class="card-body p-0 table-responsive-wrapper">
      <table class="table table-striped mb-0">
        <thead>
          <tr id="history-table-header">
            {#if isClassic}
              <th>Etappe</th><th>Renner</th><th class="text-end">Tijd</th><th class="text-end mob-hide"><span class="info-tooltip" data-tip="Sprintpunten uit het puntenklassement">Pts &#9432;</span></th><th class="text-end mob-hide"><span class="info-tooltip" data-tip="Bergpunten (KOM)">Berg &#9432;</span></th><th class="text-end"><span class="info-tooltip" data-tip="Spelpunten op basis van finishpositie, na deelpenalty">Spel &#9432;</span></th><th>Status</th>
            {:else}
              <th>Etappe</th><th>Renner</th><th class="text-end"><span class="info-tooltip" data-tip="Tijdsverschil met etappewinnaar">Verschil &#9432;</span></th><th class="text-end mob-hide"><span class="info-tooltip" data-tip="Bonificatie: 1e −10s, 2e −6s, 3e −4s">Bonif. &#9432;</span></th><th class="text-end mob-hide"><span class="info-tooltip" data-tip="Sprintpunten uit het puntenklassement">Pts &#9432;</span></th><th class="text-end mob-hide"><span class="info-tooltip" data-tip="Bergpunten (KOM)">Berg &#9432;</span></th><th class="text-end"><span class="info-tooltip" data-tip="1 punt als je de etappewinnaar correct voorspelde">&#11088; &#9432;</span></th><th>Status</th>
            {/if}
          </tr>
        </thead>
        <tbody id="history-table">
          {#if loaded && !rows.length}
            <tr><td colspan={isClassic ? 7 : 8}>
              <div class="empty-state">
                <div class="empty-state-icon">{@html icon('target', '', 32)}</div>
                <div class="empty-state-text">Nog geen keuzes gemaakt.<br>Ga naar de Keuze tab om je eerste renner te kiezen!</div>
              </div>
            </td></tr>
          {:else}
            {#each rows as row}
              <tr class={row.rowClass}>
                <td>
                  <div>{row.stageLabel}</div>
                  {#if row.winnerName}<div style="font-size:0.65rem;color:var(--text-muted);">{@html icon('trophy', '', 11)} {row.winnerName}</div>{/if}
                </td>
                <td>{@html riderDisplay(row.rider?.name, row.rider?.photo_url, row.rider?.id)} <span class="team-badge-sm">{@html row.rider ? teamBadge(row.rider.team) : ''}</span></td>
                <td class="time text-end">{row.timeCell}</td>
                {#if !isClassic}<td class="text-end mob-hide">{row.bonif ? '-' + row.bonif + 's' : '-'}</td>{/if}
                <td class="text-end mob-hide">{row.result ? (row.pick.is_late ? '0' : row.result.points) : '-'}</td>
                <td class="text-end mob-hide">{row.result ? (row.pick.is_late ? '0' : row.result.mountain_points) : '-'}</td>
                {#if !isClassic}
                  <td class="text-end">{#if row.isWinner}<span style="color:var(--green);font-weight:700;">⭐ 1</span>{:else}{row.result ? '0' : '-'}{/if}</td>
                {:else}
                  <td class="text-end">{row.gp}</td>
                {/if}
                <td>{#if row.pick.is_late}<span class="badge bg-warning">Te laat</span>{/if}{#if row.pick.is_random}<span class="badge bg-info">🎡 Rad</span>{/if}</td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
