import { state } from '../state';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TEAMS, VAPID_PUBLIC_KEY } from '../config';
import { $, escapeHtml, formatTime, formatGap, formatDeadline, riderDisplay, avatarHtml, compBadge, skeletonRows, toast, confettiBurst } from '../utils';
import { supabase } from '../supabase-client';
import { icon } from '../icons';
import { supaRest } from '../api';
import { activeScoringMode, activeStages, riderPhoto } from '../helpers';

// --- DASHBOARD ---
export async function loadStandings() {
  if (!state.activeCompId) {
    const empty = `<tr><td colspan="3"><div class="empty-state"><div class="empty-state-icon">${icon('flag', '', 32)}</div><div class="empty-state-text">Selecteer een ronde om het klassement te zien</div></div></td></tr>`;
    $('gc-table').innerHTML = empty;
    $('points-table').innerHTML = empty;
    $('mountain-table').innerHTML = empty;
    $('game-table').innerHTML = empty;
    return;
  }

  const lockedStages = activeStages().filter(s => s.locked).sort((a, b) => a.stage_number - b.stage_number);
  const completedStages = lockedStages.length;
  const latestStage = completedStages >= 2 ? lockedStages.at(-1) : null;
  const compStageIds = lockedStages.map(s => s.id);

  let standings;
  let latestStagePicks: any[];
  if (state._cache.standingsCompId === state.activeCompId && state._cache.standings) {
    standings = state._cache.standings;
    latestStagePicks = state._cache.latestStagePicks || [];

    // Winnertime + latestPicks nog niet beschikbaar — haal op in achtergrond en her-render
    if ((state._cache as any).winnerTimeSum === undefined && (compStageIds.length || latestStage)) {
      (state._cache as any).winnerTimeSum = null; // voorkomt dubbel verzoek
      (async () => {
        const [winnerRes, latestPicks] = await Promise.all([
          compStageIds.length
            ? supaRest('stage_results', { filters: `stage_id=in.(${compStageIds.join(',')})&finish_position=eq.1&dnf=eq.false&time_seconds=gt.0`, select: 'stage_id,time_seconds' })
            : Promise.resolve([]),
          latestStage
            ? supaRest('stage_picks_public', { filters: `stage_id=eq.${latestStage.id}`, select: 'user_id,time_gap,dnf_penalty_gap,bonification,effective_points,effective_mountain_points,effective_game_points,finish_position,dnf' })
            : Promise.resolve([]),
        ]);
        (state._cache as any).winnerTimeSum = (winnerRes || []).reduce((sum: number, r: any) => sum + r.time_seconds, 0);
        state._cache.latestStagePicks = latestPicks || [];
        if (document.querySelector('#section-dashboard.active')) loadStandings();
      })();
    }
  } else {
    // Skeleton alleen tonen bij echte network fetch
    const skel = skeletonRows(5);
    $('gc-table').innerHTML = skel; $('points-table').innerHTML = skel;
    $('mountain-table').innerHTML = skel; $('game-table').innerHTML = skel;

    const [standingsData, winnerResults, latestPicksData] = await Promise.all([
      supaRest('general_classification', { filters: `competition_id=eq.${state.activeCompId}` }),
      compStageIds.length
        ? supaRest('stage_results', { filters: `stage_id=in.(${compStageIds.join(',')})&finish_position=eq.1&dnf=eq.false&time_seconds=gt.0`, select: 'stage_id,time_seconds' })
        : Promise.resolve([]),
      latestStage
        ? supaRest('stage_picks_public', {
            filters: `stage_id=eq.${latestStage.id}`,
            select: 'user_id,time_gap,dnf_penalty_gap,bonification,effective_points,effective_mountain_points,effective_game_points,finish_position,dnf'
          })
        : Promise.resolve([]),
    ]);
    standings = standingsData;
    (state._cache as any).winnerTimeSum = (winnerResults || []).reduce((sum: number, r: any) => sum + r.time_seconds, 0);
    state._cache.standings = standings;
    state._cache.standingsCompId = state.activeCompId;
    state._cache.latestStagePicks = latestPicksData || [];
    latestStagePicks = state._cache.latestStagePicks;
  }

  const emptyRow = '<tr><td colspan="3" class="text-muted text-center py-3">Nog geen resultaten — wordt zichtbaar na de eerste etappe</td></tr>';
  const rankBadge = (i: number) => i < 3
    ? `<span class="rank-badge rank-badge-${i + 1}">${i + 1}</span>`
    : `<span class="rank-badge">${i + 1}</span>`;
  const mode = activeScoringMode();
  const isClassic = mode === 'classic';
  const myName = state.profile?.display_name;

  // Kaarten per scoring mode: hoofdkolom toont AK (grote ronde) of Spel (klassieker)
  $('gc-card').style.display = isClassic ? 'none' : '';
  $('points-card').style.display = isClassic ? 'none' : '';
  $('mountain-card').style.display = isClassic ? 'none' : '';
  $('combativity-card').style.display = '';  // altijd zichtbaar
  $('game-card').style.display = isClassic ? '' : 'none';

  // Persoonlijke status-strip: gevuld tijdens het renderen van de klassementen
  const statusEntries: { label: string; value: string; sub?: string; deltaHtml?: string; jersey?: string }[] = [];
  const deltaChip = (d?: number | null) => d
    ? `<span class="my-status-delta ${d > 0 ? 'rank-up' : 'rank-down'}">${d > 0 ? '↑' : '↓'}${Math.abs(d) > 1 ? Math.abs(d) : ''}</span>`
    : '';

  // Rivalry tracker helper: add row showing gap to neighbor above only
  function rivalryRow(sorted, myIdx, valueFn, isTime) {
    if (myIdx <= 0 || sorted.length < 2) return '';
    const above = sorted[myIdx - 1];
    const diff = Math.abs(valueFn(sorted[myIdx]) - valueFn(above));
    if (diff === 0) return '';
    return `<tr class="rivalry-row"><td colspan="3"><div class="rivalry-info"><span class="rivalry-up">↑ ${isTime ? formatGap(diff) : diff + ' pts'} achter ${escapeHtml(above.display_name)}</span></div></td></tr>`;
  }

  // H2H button helper
  function h2hBtn(name, classMode = 'game') {
    if (name === myName) return '';
    return ` <button class="btn btn-ghost" style="padding:0.1rem 0.4rem;font-size:0.6rem;border-radius:4px;" onclick="openH2H('${escapeHtml(name).replace(/'/g, "\\'")}','${classMode}')">vs</button>`;
  }

  // Render standings with rivalry
  function renderClassification(tableId, sorted, valueFn, formatFn, isTime, heroLabel?: string, rankDelta?: Map<string, number>, classMode?: string) {
    const myIdx = sorted.findIndex(s => s.display_name === myName);
    // Truikleur per klassement — de leider "draagt de trui" (strijdlust is geen trui)
    const jerseyClass = ({ gc: 'jersey-gc', points: 'jersey-points', mountain: 'jersey-mountain', game: 'jersey-game' } as Record<string, string>)[classMode || 'game'] || '';
    const rows = sorted.map((s, i) => {
      const isMe = s.display_name === myName;
      const isLeader = i === 0 && sorted.length > 0;
      const meStyle = isMe ? ' style="background:var(--accent-bg);"' : '';
      const trClass = isLeader ? ` class="leader-row${jerseyClass ? ' wears ' + jerseyClass : ''}"` : '';
      const truiChip = isLeader && jerseyClass ? ` <span class="trui-chip">trui</span>` : '';
      const delta = rankDelta?.get(s.user_id);
      const deltaHtml = delta != null && delta !== 0
        ? `<span class="rank-change ${delta > 0 ? 'rank-up' : 'rank-down'}">${delta > 0 ? '↑' : '↓'}${Math.abs(delta) > 1 ? Math.abs(delta) : ''}</span>`
        : '';
      return `<tr${meStyle}${trClass}><td class="tnum">${rankBadge(i)}${deltaHtml}</td><td><div class="d-flex align-items-center gap-2">${avatarHtml(s.display_name, state._avatarMap[s.display_name], 'sm')}${escapeHtml(s.display_name)}${truiChip}${h2hBtn(s.display_name, classMode || 'game')}</div></td><td class="text-end tnum">${formatFn(s, i)}</td></tr>`;
    }).join('');
    $(tableId).innerHTML = rows || emptyRow;

    // Leader hero section
    const heroEl = document.getElementById(tableId.replace('-table', '-hero'));
    if (heroEl) {
      if (sorted.length > 0) {
        const leader = sorted[0];
        heroEl.innerHTML = `<div class="leader-hero-inner">
          <div class="d-flex align-items-center gap-2">
            ${avatarHtml(leader.display_name, state._avatarMap[leader.display_name])}
            <div>
              <div class="leader-hero-name">${escapeHtml(leader.display_name)}</div>
              <div class="leader-hero-sub">Leider</div>
            </div>
          </div>
          ${heroLabel != null ? `<div class="leader-hero-score">${escapeHtml(String(heroLabel))}</div>` : ''}
        </div>`;
      } else {
        heroEl.innerHTML = '';
      }
    }
  }

  // Delta helpers: compute rank change vs. standings before the latest stage
  const latestMap = new Map(latestStagePicks.map((p: any) => [p.user_id, p]));

  function computeRankDeltas(sorted: any[], getTotal: (r: any) => number, getContrib: (p: any) => number, ascending: boolean): Map<string, number> | null {
    if (completedStages < 2 || latestMap.size === 0) return null;
    const prevArr = sorted.map(row => {
      const pick = latestMap.get(row.user_id);
      return { user_id: row.user_id, prev: getTotal(row) - (pick ? getContrib(pick) : 0) };
    });
    const prevSorted = [...prevArr].sort((a, b) => ascending ? a.prev - b.prev : b.prev - a.prev);
    const prevRank = new Map(prevSorted.map((r, i) => [r.user_id, i]));
    return new Map(sorted.map((row, i) => [row.user_id, (prevRank.get(row.user_id) ?? i) - i]));
  }

  if (!isClassic) {
    const gc = [...standings].sort((a, b) => a.total_time - b.total_time);
    const leaderTime = gc.length ? gc[0].total_time : 0;
    const winnerTimeSum = state._cache.winnerTimeSum || 0;

    const gcDeltas = computeRankDeltas(gc, s => s.total_time,
      p => (p.dnf_penalty_gap ?? p.time_gap ?? 0) - (p.bonification ?? 0), true);

    const gcHeroLabel = gc.length > 0 && winnerTimeSum > 0 ? formatTime(winnerTimeSum + leaderTime) : null;
    renderClassification('gc-table', gc, s => s.total_time, (s, i) => {
      const absTime = winnerTimeSum > 0 ? winnerTimeSum + s.total_time : null;
      const absTimeNoBonif = winnerTimeSum > 0 ? winnerTimeSum + s.total_time_no_bonif : null;
      const gap = i > 0 ? formatGap(s.total_time - leaderTime) : '';
      const timeDisplay = i === 0
        ? (absTime ? formatTime(absTime) : formatTime(s.total_time))
        : (absTime ? `<div style="font-size:0.65rem;color:var(--text-muted);">${formatTime(absTime)}</div>` : '');
      const gapDisplay = gap ? `<div style="font-size:1.15rem;font-weight:700;">${gap}</div>` : '';
      const bonifDisplay = `<div style="font-size:0.65rem;color:var(--green);">${s.total_bonification ? '-' + s.total_bonification + 's bonif.' : ''}</div>`;
      const noBonifDisplay = absTimeNoBonif ? `<div style="font-size:0.65rem;color:var(--text-muted);">Rittijd: ${formatTime(absTimeNoBonif)}</div>` : '';
      return `${gapDisplay}${timeDisplay}${bonifDisplay}${noBonifDisplay}`;
    }, true, gcHeroLabel, gcDeltas, 'gc');

    const pts = [...standings].sort((a, b) => b.total_points - a.total_points);
    const ptsDeltas = computeRankDeltas(pts, s => s.total_points, p => p.effective_points ?? 0, false);
    renderClassification('points-table', pts, s => s.total_points, (s) => s.total_points, false,
      pts.length > 0 ? pts[0].total_points + ' pts' : null, ptsDeltas, 'points');

    const mt = [...standings].sort((a, b) => b.total_mountain_points - a.total_mountain_points);
    const mtDeltas = computeRankDeltas(mt, s => s.total_mountain_points, p => p.effective_mountain_points ?? 0, false);
    renderClassification('mountain-table', mt, s => s.total_mountain_points, (s) => s.total_mountain_points, false,
      mt.length > 0 ? mt[0].total_mountain_points + ' pts' : null, mtDeltas, 'mountain');

    // Status-strip: AK, Punten, Berg
    const myGcIdx = gc.findIndex(s => s.display_name === myName);
    if (myGcIdx >= 0) statusEntries.push({
      label: 'Algemeen',
      value: `${myGcIdx + 1}e`,
      sub: myGcIdx > 0 ? `${formatGap(gc[myGcIdx].total_time - leaderTime)} achter` : 'aan de leiding',
      deltaHtml: deltaChip(gcDeltas?.get(gc[myGcIdx].user_id)),
      jersey: 'gc',
    });
    const myPtsIdx = pts.findIndex(s => s.display_name === myName);
    if (myPtsIdx >= 0) statusEntries.push({
      label: 'Punten',
      value: `${myPtsIdx + 1}e`,
      sub: `${pts[myPtsIdx].total_points} pts`,
      deltaHtml: deltaChip(ptsDeltas?.get(pts[myPtsIdx].user_id)),
      jersey: 'points',
    });
    const myMtIdx = mt.findIndex(s => s.display_name === myName);
    if (myMtIdx >= 0) statusEntries.push({
      label: 'Berg',
      value: `${myMtIdx + 1}e`,
      sub: `${mt[myMtIdx].total_mountain_points} pts`,
      deltaHtml: deltaChip(mtDeltas?.get(mt[myMtIdx].user_id)),
      jersey: 'mountain',
    });
  }

  const cv = [...standings].sort((a, b) => (b.total_combativity_points || 0) - (a.total_combativity_points || 0));
  const cvDeltas = computeRankDeltas(cv, s => s.total_combativity_points || 0,
    p => (p.finish_position === 1 && !p.dnf) ? 1 : 0, false);
  renderClassification('combativity-table', cv, s => s.total_combativity_points || 0, (s) => s.total_combativity_points || 0, false,
    cv.length > 0 ? (cv[0].total_combativity_points || 0) + ' pts' : null, cvDeltas, 'combativity');

  const gp = [...standings].sort((a, b) => b.total_game_points - a.total_game_points);
  const gpDeltas = computeRankDeltas(gp, s => s.total_game_points, p => p.effective_game_points ?? 0, false);
  renderClassification('game-table', gp, s => s.total_game_points, (s) => s.total_game_points || 0, false,
    gp.length > 0 ? (gp[0].total_game_points || 0) + ' pts' : null, gpDeltas);

  // Status-strip: Spel (klassieker) + Strijdlust
  if (isClassic) {
    const myGpIdx = gp.findIndex(s => s.display_name === myName);
    if (myGpIdx >= 0) statusEntries.push({
      label: 'Spel',
      value: `${myGpIdx + 1}e`,
      sub: `${gp[myGpIdx].total_game_points || 0} pts`,
      deltaHtml: deltaChip(gpDeltas?.get(gp[myGpIdx].user_id)),
      jersey: 'game',
    });
  }
  const myCvIdx = cv.findIndex(s => s.display_name === myName);
  if (myCvIdx >= 0) statusEntries.push({
    label: 'Strijdlust',
    value: `${cv[myCvIdx].total_combativity_points || 0}`,
    sub: 'winnaars geraden',
    deltaHtml: deltaChip(cvDeltas?.get(cv[myCvIdx].user_id)),
  });

  renderMyStatus(statusEntries);
  renderWelcomeCard();

  // Pot kaart — asynchroon renderen (blokkeert standings niet)
  renderPotCard(standings).catch(() => {});
}

// "Jouw koers": persoonlijke status-strip bovenaan het dashboard —
// jouw posities per klassement + volgende etappe met pick-status.
function renderMyStatus(entries: { label: string; value: string; sub?: string; deltaHtml?: string; jersey?: string }[]) {
  const wrap = $('my-status-wrap');
  if (!wrap) return;

  const comp = state.competitions.find(c => c.id === state.activeCompId);
  if (!comp || !entries.length) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }

  const now = new Date();
  const nextOpen = activeStages()
    .filter(s => !s.locked && now <= new Date(s.deadline))
    .sort((a, b) => a.stage_number - b.stage_number)[0];

  let nextHtml = '';
  if (nextOpen) {
    const pick = state.myPicks.find(p => p.stage_id === nextOpen.id);
    const rider = pick ? state._riderMap[pick.rider_id] : null;
    const stageTitle = nextOpen.stage_number === 0 ? 'Proloog' : `Etappe ${nextOpen.stage_number}`;
    nextHtml = `<div class="my-status-next">
      <span class="my-status-next-stage">Volgende: <strong>${stageTitle}</strong>${nextOpen.name ? ` · ${escapeHtml(nextOpen.name)}` : ''} · deadline ${formatDeadline(nextOpen.deadline)}</span>
      ${rider
        ? `<span class="my-status-pick">✓ ${escapeHtml(rider.name)}</span>`
        : `<button class="btn btn-accent btn-sm" onclick="location.hash='pick'">Kies je renner</button>`}
    </div>`;
  }

  wrap.style.display = '';
  wrap.innerHTML = `
    <div class="card my-status-card">
      <div class="card-body">
        <div class="my-status-label">Jouw koers — ${escapeHtml(comp.name)}</div>
        <div class="my-status-stats">
          ${entries.map(e => `
            <div class="my-status-stat${e.jersey ? ' jersey-' + e.jersey : ''}">
              <div class="my-status-value display tnum">${e.value}${e.deltaHtml || ''}</div>
              <div class="my-status-stat-label">${escapeHtml(e.label)}${e.sub ? `<span class="my-status-sub"> · ${escapeHtml(e.sub)}</span>` : ''}</div>
            </div>`).join('')}
        </div>
        ${nextHtml}
      </div>
    </div>`;
}

// Welkom-hero: deelname is impliciet (eerste pick = meedoen), dus maak dat
// expliciet zichtbaar voor wie nog geen pick heeft in de actieve ronde.
function renderWelcomeCard() {
  const wrap = $('welcome-card-wrap');
  if (!wrap) return;

  const comp = state.competitions.find(c => c.id === state.activeCompId);
  const compStageIds = new Set(activeStages().map(s => s.id));
  const hasPicks = state.myPicks.some(p => compStageIds.has(p.stage_id));
  const now = new Date();
  const nextOpen = activeStages()
    .filter(s => !s.locked && now <= new Date(s.deadline))
    .sort((a, b) => a.stage_number - b.stage_number)[0];

  if (!comp || hasPicks || !nextOpen) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }

  const stageTitle = nextOpen.stage_number === 0 ? 'de proloog' : `etappe ${nextOpen.stage_number}`;
  wrap.style.display = '';
  wrap.innerHTML = `
    <div class="card welcome-card">
      <div class="card-body">
        <div class="welcome-card-inner">
          <div>
            <div class="welcome-card-title">Je doet nog niet mee aan ${escapeHtml(comp.name)}</div>
            <div class="welcome-card-sub">Kies je renner voor ${stageTitle} en je zit in de koers — daarna doe je automatisch mee met alle klassementen. Deadline: ${formatDeadline(nextOpen.deadline)}.</div>
          </div>
          <button class="btn btn-accent welcome-card-cta" onclick="location.hash='pick'">Kies je eerste renner</button>
        </div>
      </div>
    </div>`;
}

function computePrizeSplits(
  sorted: any[],
  valueFn: (s: any) => number,
  slots: { label: string; pct: number }[]
): { label: string; winners: any[]; pctEach: number }[] {
  const rows: { label: string; winners: any[]; pctEach: number }[] = [];
  let i = 0;
  let slotIdx = 0;

  while (slotIdx < slots.length) {
    if (i >= sorted.length) {
      rows.push({ label: slots[slotIdx].label, winners: [], pctEach: slots[slotIdx].pct });
      slotIdx++;
      continue;
    }

    const val = valueFn(sorted[i]);
    let j = i + 1;
    while (j < sorted.length && valueFn(sorted[j]) === val) j++;
    const tiedCount = j - i;

    const slotsConsumed = Math.min(tiedCount, slots.length - slotIdx);
    const combinedPct = slots.slice(slotIdx, slotIdx + slotsConsumed).reduce((s, r) => s + r.pct, 0);
    const pctEach = combinedPct / tiedCount;

    const slotLabels = slots.slice(slotIdx, slotIdx + slotsConsumed).map(r => r.label);
    // "1e AK" + "2e AK" → "1e/2e AK"
    const label = slotLabels.length === 1
      ? slotLabels[0]
      : `${slotLabels[0].split(' ')[0]}/${slotLabels[slotLabels.length - 1].split(' ')[0]} ${slotLabels[0].split(' ').slice(1).join(' ')}`;

    rows.push({ label, winners: sorted.slice(i, j), pctEach });
    slotIdx += slotsConsumed;
    i += tiedCount;
  }

  return rows;
}

async function renderPotCard(standings: any[]) {
  const potWrap = $('pot-card-wrap');
  if (!potWrap) return;

  const activeComp = state.competitions.find(c => c.id === state.activeCompId);
  if (!activeComp?.entry_fee) { potWrap.style.display = 'none'; return; }

  const participants = await supaRest('competition_participants', {
    select: 'user_id,has_paid',
    filters: `competition_id=eq.${state.activeCompId}`,
  });

  const paidIds = new Set((participants || []).filter((p: any) => p.has_paid).map((p: any) => p.user_id));
  const paidCount = paidIds.size;
  const totalPot = paidCount * activeComp.entry_fee;

  // Alleen betalende spelers komen in aanmerking voor prijzen
  const paid = standings.filter(s => paidIds.has(s.user_id));
  const gc  = [...paid].sort((a, b) => a.total_time - b.total_time);
  const pts = [...paid].sort((a, b) => b.total_points - a.total_points);
  const mtn = [...paid].sort((a, b) => b.total_mountain_points - a.total_mountain_points);
  const cmb = [...paid].sort((a, b) => b.total_combativity_points - a.total_combativity_points);

  const prizeRows = [
    ...computePrizeSplits(gc,  s => s.total_time,                 [{label:'1e AK', pct:35},{label:'2e AK', pct:25},{label:'3e AK', pct:15}]),
    ...computePrizeSplits(pts, s => s.total_points,               [{label:'Winnaar punten', pct:10}]),
    ...computePrizeSplits(mtn, s => s.total_mountain_points,      [{label:'Winnaar berg', pct:10}]),
    ...computePrizeSplits(cmb, s => s.total_combativity_points,   [{label:'Winnaar strijdlust', pct:5}]),
  ];

  const isProvisional = activeStages().some(s => !s.locked) && gc.length > 0;
  const myId = state.session?.user?.id;

  potWrap.style.display = '';
  potWrap.innerHTML = `
    <div class="card">
      <div class="card-header d-flex align-items-center justify-content-between">
        <h5 class="mb-0">Prijzenpot${isProvisional ? ' <span class="badge bg-warning ms-1" style="font-size:0.65rem;">Voorlopig</span>' : ''}</h5>
        <span style="font-size:0.85rem;color:var(--text-muted);">€${totalPot} &nbsp;<span style="font-size:0.75rem;">(${paidCount} × €${activeComp.entry_fee})</span></span>
      </div>
      <div class="card-body p-0 table-responsive-wrapper">
        <table class="table table-sm mb-0">
          <thead><tr><th>Prijs</th><th>Speler</th><th class="text-end">Bedrag</th><th class="text-end" style="color:var(--text-muted);font-size:0.75rem;">%</th></tr></thead>
          <tbody>
            ${prizeRows.flatMap(row => {
              const amountEach = Math.floor(totalPot * row.pctEach / 100);
              const pctDisplay = Number.isInteger(row.pctEach) ? `${row.pctEach}%` : `${row.pctEach.toFixed(1)}%`;
              const isTie = row.winners.length > 1;

              if (row.winners.length === 0) {
                return [`<tr>
                  <td style="font-size:0.85rem;">${row.label}</td>
                  <td>—</td>
                  <td class="text-end">€${amountEach}</td>
                  <td class="text-end" style="color:var(--text-muted);font-size:0.75rem;">${pctDisplay}</td>
                </tr>`];
              }

              return row.winners.map((s, idx) => {
                const isMe = s.user_id === myId;
                return `<tr${isMe ? ' style="background:var(--accent-bg);"' : ''}>
                  <td style="font-size:0.85rem;">${idx === 0 ? escapeHtml(row.label) + (isTie ? ' <span class="badge bg-secondary ms-1" style="font-size:0.6rem;vertical-align:middle;">gedeeld</span>' : '') : ''}</td>
                  <td>${escapeHtml(s.display_name)}</td>
                  <td class="text-end" style="font-weight:700;">€${amountEach}</td>
                  <td class="text-end" style="color:var(--text-muted);font-size:0.75rem;">${idx === 0 ? pctDisplay : ''}</td>
                </tr>`;
              });
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

// --- HEAD-TO-HEAD ---
window.openH2H = async function(opponentName, mode = 'game') {
  const overlay = $('h2h-overlay');
  const content = $('h2h-content');
  content.innerHTML = '<div class="text-center text-muted py-3">Laden...</div>';
  overlay.style.display = 'flex';

  try {
    const allPicks = await supaRest('stage_picks_public', {
      filters: `competition_id=eq.${state.activeCompId}`,
      select: 'stage_id,stage_number,user_id,display_name,rider_name,time_gap,dnf_penalty_gap,bonification,effective_points,effective_mountain_points,effective_game_points,finish_position,dnf,is_late'
    });

    const myPks = allPicks.filter(p => p.display_name === state.profile?.display_name);
    const oppPks = allPicks.filter(p => p.display_name === opponentName);
    const stageNums = [...new Set(allPicks.map(p => p.stage_number))].sort((a, b) => a - b);

    const header = `
      <div class="h2h-vs">
        <div class="h2h-player" style="color:var(--accent);">${escapeHtml(state.profile?.display_name || '?')}</div>
        <div class="h2h-vs-label">TEGEN</div>
        <div class="h2h-player">${escapeHtml(opponentName)}</div>
      </div>`;

    if (mode === 'gc') {
      const effGap = (p) => (p.dnf_penalty_gap ?? p.time_gap ?? 0) - (p.bonification ?? 0);
      let myWins = 0, oppWins = 0;

      const stageRows = stageNums.map(num => {
        const my = myPks.find(p => p.stage_number === num);
        const opp = oppPks.find(p => p.stage_number === num);
        if (!my || !opp) return '';
        const myGap = effGap(my);
        const oppGap = effGap(opp);
        const myWin = myGap < oppGap;
        const oppWin = oppGap < myGap;
        if (myWin) myWins++;
        if (oppWin) oppWins++;
        const penIcon = (p) => p.dnf_penalty_gap != null ? '<span style="color:var(--text-muted);font-size:0.65em;" title="Straftijd">⚠</span>' : '';
        const myLabel = `${formatGap(myGap)}${penIcon(my)}`;
        const oppLabel = `${formatGap(oppGap)}${penIcon(opp)}`;
        return `<div class="h2h-stage-row">
          <div class="${myWin ? 'h2h-winner' : oppWin ? 'h2h-loser' : ''}" style="text-align:right;">${myLabel} <span style="font-size:0.7rem;color:var(--text-muted);">${riderDisplay(my.rider_name, riderPhoto(my.rider_id))}</span></div>
          <div class="h2h-stage-label">E${num}</div>
          <div class="${oppWin ? 'h2h-winner' : myWin ? 'h2h-loser' : ''}">${oppLabel} <span style="font-size:0.7rem;color:var(--text-muted);">${riderDisplay(opp.rider_name, riderPhoto(opp.rider_id))}</span></div>
        </div>`;
      }).join('');

      const myTotalGap = myPks.reduce((s, p) => s + effGap(p), 0);
      const oppTotalGap = oppPks.reduce((s, p) => s + effGap(p), 0);
      const diff = Math.abs(myTotalGap - oppTotalGap);
      const diffLabel = myTotalGap < oppTotalGap
        ? `<span style="color:var(--green);">Jij wint met ${formatGap(diff)}</span>`
        : myTotalGap > oppTotalGap
          ? `<span style="color:var(--red, #ef4444);">${escapeHtml(opponentName)} wint met ${formatGap(diff)}</span>`
          : 'Gelijk';

      content.innerHTML = `${header}${stageRows}
        <div class="h2h-score-summary">
          <div class="h2h-stat"><div class="h2h-stat-label">Etappes gewonnen (tijd)</div><div class="h2h-stat-value" style="color:var(--green);">${myWins} – ${oppWins}</div></div>
          <div class="h2h-stat"><div class="h2h-stat-label">Tijdsverschil AK</div><div class="h2h-stat-value">${diffLabel}</div></div>
        </div>`;
    } else if (mode === 'points') {
      let myWins = 0, oppWins = 0;
      const stageRows = stageNums.map(num => {
        const my = myPks.find(p => p.stage_number === num);
        const opp = oppPks.find(p => p.stage_number === num);
        if (!my || !opp) return '';
        const myPts = my.effective_points || 0;
        const oppPts = opp.effective_points || 0;
        const myWin = myPts > oppPts;
        const oppWin = oppPts > myPts;
        if (myWin) myWins++;
        if (oppWin) oppWins++;
        return `<div class="h2h-stage-row">
          <div class="${myWin ? 'h2h-winner' : oppWin ? 'h2h-loser' : ''}" style="text-align:right;">${myPts} pts <span style="font-size:0.7rem;color:var(--text-muted);">${riderDisplay(my.rider_name, riderPhoto(my.rider_id))}</span></div>
          <div class="h2h-stage-label">E${num}</div>
          <div class="${oppWin ? 'h2h-winner' : myWin ? 'h2h-loser' : ''}">${oppPts} pts <span style="font-size:0.7rem;color:var(--text-muted);">${riderDisplay(opp.rider_name, riderPhoto(opp.rider_id))}</span></div>
        </div>`;
      }).join('');

      const myTotal = myPks.reduce((s, p) => s + (p.effective_points || 0), 0);
      const oppTotal = oppPks.reduce((s, p) => s + (p.effective_points || 0), 0);

      content.innerHTML = `${header}${stageRows}
        <div class="h2h-score-summary">
          <div class="h2h-stat"><div class="h2h-stat-label">Etappes gewonnen (punten)</div><div class="h2h-stat-value" style="color:var(--green);">${myWins} – ${oppWins}</div></div>
          <div class="h2h-stat"><div class="h2h-stat-label">Totaal sprintpunten</div><div class="h2h-stat-value">${myTotal} – ${oppTotal}</div></div>
        </div>`;
    } else if (mode === 'mountain') {
      let myWins = 0, oppWins = 0;
      const stageRows = stageNums.map(num => {
        const my = myPks.find(p => p.stage_number === num);
        const opp = oppPks.find(p => p.stage_number === num);
        if (!my || !opp) return '';
        const myPts = my.effective_mountain_points || 0;
        const oppPts = opp.effective_mountain_points || 0;
        const myWin = myPts > oppPts;
        const oppWin = oppPts > myPts;
        if (myWin) myWins++;
        if (oppWin) oppWins++;
        return `<div class="h2h-stage-row">
          <div class="${myWin ? 'h2h-winner' : oppWin ? 'h2h-loser' : ''}" style="text-align:right;">${myPts} pts <span style="font-size:0.7rem;color:var(--text-muted);">${riderDisplay(my.rider_name, riderPhoto(my.rider_id))}</span></div>
          <div class="h2h-stage-label">E${num}</div>
          <div class="${oppWin ? 'h2h-winner' : myWin ? 'h2h-loser' : ''}">${oppPts} pts <span style="font-size:0.7rem;color:var(--text-muted);">${riderDisplay(opp.rider_name, riderPhoto(opp.rider_id))}</span></div>
        </div>`;
      }).join('');

      const myTotal = myPks.reduce((s, p) => s + (p.effective_mountain_points || 0), 0);
      const oppTotal = oppPks.reduce((s, p) => s + (p.effective_mountain_points || 0), 0);

      content.innerHTML = `${header}${stageRows}
        <div class="h2h-score-summary">
          <div class="h2h-stat"><div class="h2h-stat-label">Etappes gewonnen (berg)</div><div class="h2h-stat-value" style="color:var(--green);">${myWins} – ${oppWins}</div></div>
          <div class="h2h-stat"><div class="h2h-stat-label">Totaal bergpunten</div><div class="h2h-stat-value">${myTotal} – ${oppTotal}</div></div>
        </div>`;
    } else if (mode === 'combativity') {
      let myWins = 0, oppWins = 0;
      const stageRows = stageNums.map(num => {
        const my = myPks.find(p => p.stage_number === num);
        const opp = oppPks.find(p => p.stage_number === num);
        if (!my || !opp) return '';
        const myPts = (my.finish_position === 1 && !my.dnf) ? 1 : 0;
        const oppPts = (opp.finish_position === 1 && !opp.dnf) ? 1 : 0;
        const myWin = myPts > oppPts;
        const oppWin = oppPts > myPts;
        if (myWin) myWins++;
        if (oppWin) oppWins++;
        const badge = (p, pts) => pts ? '🏆 ' : '';
        return `<div class="h2h-stage-row">
          <div class="${myWin ? 'h2h-winner' : oppWin ? 'h2h-loser' : ''}" style="text-align:right;">${badge(my, myPts)}${myPts} pt <span style="font-size:0.7rem;color:var(--text-muted);">${riderDisplay(my.rider_name, riderPhoto(my.rider_id))}</span></div>
          <div class="h2h-stage-label">E${num}</div>
          <div class="${oppWin ? 'h2h-winner' : myWin ? 'h2h-loser' : ''}">${badge(opp, oppPts)}${oppPts} pt <span style="font-size:0.7rem;color:var(--text-muted);">${riderDisplay(opp.rider_name, riderPhoto(opp.rider_id))}</span></div>
        </div>`;
      }).join('');

      const myTotal = myPks.reduce((s, p) => s + ((p.finish_position === 1 && !p.dnf) ? 1 : 0), 0);
      const oppTotal = oppPks.reduce((s, p) => s + ((p.finish_position === 1 && !p.dnf) ? 1 : 0), 0);

      content.innerHTML = `${header}${stageRows}
        <div class="h2h-score-summary">
          <div class="h2h-stat"><div class="h2h-stat-label">Etappewinnaar geraden</div><div class="h2h-stat-value" style="color:var(--green);">${myWins} – ${oppWins}</div></div>
          <div class="h2h-stat"><div class="h2h-stat-label">Totaal strijdlustpunten</div><div class="h2h-stat-value">${myTotal} – ${oppTotal}</div></div>
        </div>`;
    } else {
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
          <div class="${myWin ? 'h2h-winner' : oppWin ? 'h2h-loser' : ''}" style="text-align:right;">${myGp} <span style="font-size:0.7rem;color:var(--text-muted);">${riderDisplay(my.rider_name, riderPhoto(my.rider_id))}</span></div>
          <div class="h2h-stage-label">E${num}</div>
          <div class="${oppWin ? 'h2h-winner' : myWin ? 'h2h-loser' : ''}">${oppGp} <span style="font-size:0.7rem;color:var(--text-muted);">${riderDisplay(opp.rider_name, riderPhoto(opp.rider_id))}</span></div>
        </div>`;
      }).join('');

      const myTotal = myPks.reduce((s, p) => s + (p.is_late || p.dnf ? 0 : (p.effective_game_points || 0)), 0);
      const oppTotal = oppPks.reduce((s, p) => s + (p.is_late || p.dnf ? 0 : (p.effective_game_points || 0)), 0);

      content.innerHTML = `${header}${stageRows}
        <div class="h2h-score-summary">
          <div class="h2h-stat"><div class="h2h-stat-label">Etappes gewonnen</div><div class="h2h-stat-value" style="color:var(--green);">${myWins} – ${oppWins}</div></div>
          <div class="h2h-stat"><div class="h2h-stat-label">Totaal spelpunten</div><div class="h2h-stat-value">${myTotal} – ${oppTotal}</div></div>
        </div>`;
    }
  } catch (e) {
    content.innerHTML = `<div class="text-danger">${e.message}</div>`;
  }
};

// --- ACHIEVEMENTS ---
export function computeAchievements(picks, results, stages, allPicksForStages = []) {
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
  const compStages = stages.filter(s => s.competition_id === state.activeCompId && s.locked);
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

  // Underdog: enige speler die deze renner koos voor die etappe, en scoorde 50+
  const soloStages = picks.filter(pick => {
    const result = results.find(r => r.stage_id === pick.stage_id && r.rider_id === pick.rider_id);
    const gp = result && !pick.is_late && !result.dnf ? (result.game_points || 0) : 0;
    if (gp < 50) return false;
    const count = allPicksForStages.filter(p => p.stage_id === pick.stage_id && p.rider_id === pick.rider_id).length;
    return count <= 1;
  });
  if (soloStages.length) badges.push({ icon: '🕵️', text: `${soloStages.length}x Underdog`, cls: 'purple' });

  return badges;
}

export function renderAchievements(badges) {
  if (!badges.length) return '';
  return `<div class="achievements-wrap">${badges.map(b =>
    `<span class="achievement-badge ${b.cls}">${b.icon} ${b.text}</span>`
  ).join('')}</div>`;
}

