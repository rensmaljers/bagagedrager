<!--
  Dashboard — port van public/views/dashboard.ts + #section-dashboard uit index.html.
  Gedrag 1-op-1: klassementen (AK/Punten/Berg/Strijdlust/Spel), leader-hero's,
  welkom-hero, "Jouw koers"-statusstrip, rank-delta's, prijzenpot en H2H-overlay.
  Data-caching via appState._cache, identiek aan de bron. Realtime: state is reactief;
  App.svelte kan daarnaast refresh() aanroepen of appState._cache.standings = null zetten.
-->
<script module lang="ts">
  import { state as appState, ui } from '../lib/state.svelte';

  // --- ACHIEVEMENTS --- (module-export zodat History.svelte ze kan importeren,
  // zoals views/history.ts dat uit views/dashboard.ts deed)
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
    const compStages = stages.filter(s => s.competition_id === appState.activeCompId && s.locked);
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
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { escapeHtml, formatTime, formatGap, formatDeadline, riderDisplay, avatarHtml } from '../lib/utils';
  import { icon } from '../lib/icons';
  import { supaRest } from '../lib/api';
  import { activeScoringMode, activeStages, riderPhoto } from '../lib/helpers';
  import RadTheater from './RadTheater.svelte';
  import { focusTrap } from '../lib/focus-trap';

  const COMPACT_TOP = 5;

  // --- View-model state ---
  let noComp = $state(false);
  let loading = $state(false);
  let cardMode: 'all' | 'grand_tour' | 'classic' = $state('all');
  let vm: any = $state({ gc: null, points: null, mountain: null, combativity: null, game: null });
  let expanded: Record<string, boolean> = $state({});
  let statusComp: any = $state(null);
  let statusEntries: { label: string; value: string; sub?: string; deltaHtml?: string; jersey?: string }[] = $state([]);
  let statusNext: { stageTitle: string; name: string | null; deadline: string; riderName: string | null } | null = $state(null);
  let welcome: { compName: string; stageTitle: string; deadline: string } | null = $state(null);
  // Rad-theater: eenmalig per etappe, per apparaat (localStorage-vlag).
  // Getoond aan ÁLLE deelnemers zodra het Rad voor iemand gedraaid heeft
  // (Rad-picks van anderen zijn na de deadline zichtbaar via
  // stage_picks_public). Meerdere slachtoffers = meerdere spins.
  // ?radtest=1 forceert een demo met twee gefingeerde slachtoffers.
  const RAD_KEY = (stageId: number) => `bagagedrager_rad_gezien_${stageId}`;
  const MAX_SPINS = 6; // meer dan dit wordt saai — de rest staat in de eindlijst niet
  let radTheater: {
    pool: string[];
    spins: { playerName: string; riderName: string; isMe: boolean }[];
    stageLabel: string;
    stageId: number | null;
  } | null = $state(null);

  async function buildRadTheater() {
    const riders = Object.values(appState._riderMap || {});
    if (riders.length < 8) return;
    const myName = appState.profile?.display_name;

    const demo = new URLSearchParams(location.search).has('radtest');
    let victims: { playerName: string; riderName: string; isMe: boolean }[];
    let stageId: number | null = null;
    let stageLabel = 'deze etappe';

    if (demo) {
      const pick = () => (riders[Math.floor(Math.random() * riders.length)] as any).name;
      victims = [
        { playerName: myName || 'Jij', riderName: pick(), isMe: true },
        { playerName: 'Rick', riderName: pick(), isMe: false },
      ];
      stageLabel = 'de demo-etappe';
    } else {
      // Recentst afgesloten etappe (max 3 dagen terug — geen oude rads op nieuwe apparaten)
      const now = Date.now();
      const recent = activeStages()
        .filter((s: any) => (s.locked || now > new Date(s.deadline).getTime())
          && now - new Date(s.deadline).getTime() < 3 * 24 * 3600 * 1000
          && !localStorage.getItem(RAD_KEY(s.id)))
        .sort((a: any, b: any) => (b.stage_number || 0) - (a.stage_number || 0))[0];
      if (!recent) return;

      const rows = await supaRest('stage_picks_public', {
        select: 'user_id, display_name, rider_name, is_random',
        filters: `stage_id=eq.${recent.id}&is_random=eq.true`,
      });
      if (!rows?.length) {
        // Rad draait binnen ~10 min na de deadline; daarna is "geen rad-picks" definitief
        if (now - new Date(recent.deadline).getTime() > 3600 * 1000) localStorage.setItem(RAD_KEY(recent.id), '1');
        return;
      }
      victims = rows.map((r: any) => ({
        playerName: r.display_name,
        riderName: r.rider_name,
        isMe: r.display_name === myName,
      }));
      stageId = recent.id;
      stageLabel = recent.stage_number === 0 ? 'de proloog' : `etappe ${recent.stage_number}`;
    }

    // Brede namen-pool: het rad laat tijdens het draaien tientallen renners
    // langsflitsen (slot-machine-gevoel) zodat het "hele peloton" lijkt mee te
    // draaien. De toegewezen renner staat vast bij de landing (theater, geen logica).
    const pool = riders.map((r: any) => r.name).sort(() => Math.random() - 0.5).slice(0, 60);
    radTheater = {
      pool,
      spins: victims.slice(0, MAX_SPINS).map((v) => ({ ...v })),
      stageLabel,
      stageId,
    };
  }

  function dismissRadTheater() {
    if (radTheater?.stageId != null) localStorage.setItem(RAD_KEY(radTheater.stageId), '1');
    radTheater = null;
  }

  const POT_BANNER_KEY = 'bagagedrager_pot_tdf2026_dismissed';
  const POT_BETAALLINK = 'https://betaalverzoek.rabobank.nl/betaalverzoek/?id=aS3cgsxLTTGy-w-qM-B95A';
  let potBanner = $state(false);
  function dismissPotBanner() {
    localStorage.setItem(POT_BANNER_KEY, '1');
    potBanner = false;
  }
  let potVM: any = $state(null);

  // --- H2H overlay state (reactief i.p.v. window.openH2H) ---
  let h2hOpen = $state(false);
  let h2hHtml = $state('');

  // Escape sluit de H2H-modal zolang die open is
  $effect(() => {
    if (!h2hOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') h2hOpen = false; };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // H2H-verzoek van buitenaf (PlayerModal zet ui.h2hRequest en springt naar dit tabblad)
  $effect(() => {
    const req = ui.h2hRequest;
    if (!req) return;
    ui.h2hRequest = null;
    openH2H(req.name, req.mode || 'game');
  });

  const rankBadge = (i: number) => i < 3
    ? `<span class="rank-badge rank-badge-${i + 1}">${i + 1}</span>`
    : `<span class="rank-badge">${i + 1}</span>`;

  const deltaChip = (d?: number | null) => d
    ? `<span class="my-status-delta ${d > 0 ? 'rank-up' : 'rank-down'}">${d > 0 ? '↑' : '↓'}${Math.abs(d) > 1 ? Math.abs(d) : ''}</span>`
    : '';

  function goPick() {
    ui.activeTab = 'pick';
    location.hash = 'pick';
  }

  export async function loadStandings() {
    if (!appState.activeCompId) {
      noComp = true;
      loading = false;
      cardMode = 'all';
      vm = { gc: null, points: null, mountain: null, combativity: null, game: null };
      statusComp = null; statusEntries = []; statusNext = null; welcome = null; potVM = null;
      return;
    }
    noComp = false;
    const compId = appState.activeCompId;

    const lockedStages = activeStages().filter(s => s.locked).sort((a, b) => a.stage_number - b.stage_number);
    const completedStages = lockedStages.length;
    const latestStage = completedStages >= 2 ? lockedStages.at(-1) : null;
    const compStageIds = lockedStages.map(s => s.id);

    let standings;
    let latestStagePicks: any[];
    if (appState._cache.standingsCompId === appState.activeCompId && appState._cache.standings) {
      standings = appState._cache.standings;
      latestStagePicks = appState._cache.latestStagePicks || [];

      // Winnertime + latestPicks nog niet beschikbaar — haal op in achtergrond en her-render
      if ((appState._cache as any).winnerTimeSum === undefined && (compStageIds.length || latestStage)) {
        (appState._cache as any).winnerTimeSum = null; // voorkomt dubbel verzoek
        (async () => {
          const [winnerRes, latestPicks] = await Promise.all([
            compStageIds.length
              ? supaRest('stage_results', { filters: `stage_id=in.(${compStageIds.join(',')})&finish_position=eq.1&dnf=eq.false&time_seconds=gt.0`, select: 'stage_id,time_seconds' })
              : Promise.resolve([]),
            latestStage
              ? supaRest('stage_picks_public', { filters: `stage_id=eq.${latestStage.id}`, select: 'user_id,time_gap,dnf_penalty_gap,bonification,effective_points,effective_mountain_points,effective_game_points,finish_position,dnf' })
              : Promise.resolve([]),
          ]);
          (appState._cache as any).winnerTimeSum = (winnerRes || []).reduce((sum: number, r: any) => sum + r.time_seconds, 0);
          appState._cache.latestStagePicks = latestPicks || [];
          if (ui.activeTab === 'dashboard') loadStandings();
        })();
      }
    } else {
      // Skeleton alleen tonen bij echte network fetch
      loading = true;

      const [standingsData, winnerResults, latestPicksData] = await Promise.all([
        supaRest('general_classification', { filters: `competition_id=eq.${appState.activeCompId}` }),
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
      if (appState.activeCompId !== compId) return; // comp gewisseld tijdens fetch — nieuwere load rendert
      standings = standingsData;
      (appState._cache as any).winnerTimeSum = (winnerResults || []).reduce((sum: number, r: any) => sum + r.time_seconds, 0);
      appState._cache.standings = standings;
      appState._cache.standingsCompId = appState.activeCompId;
      appState._cache.latestStagePicks = latestPicksData || [];
      latestStagePicks = appState._cache.latestStagePicks;
      loading = false;
    }

    const mode = activeScoringMode();
    const isClassic = mode === 'classic';
    const myName = appState.profile?.display_name;

    // Kaarten per scoring mode: hoofdkolom toont AK (grote ronde) of Spel (klassieker)
    cardMode = isClassic ? 'classic' : 'grand_tour';

    // Her-render klapt de zijkolom-kaarten weer in (zoals de innerHTML-render in de bron)
    expanded = {};

    // Persoonlijke status-strip: gevuld tijdens het bouwen van de klassementen
    const entries: { label: string; value: string; sub?: string; deltaHtml?: string; jersey?: string }[] = [];

    // Bouw view-model per klassement (was renderClassification met innerHTML)
    function buildTable(sorted: any[], formatFn: (s: any, i: number) => any, heroLabel?: string | null, rankDelta?: Map<string, number> | null, classMode?: string, compact = false) {
      const jerseyClass = ({ gc: 'jersey-gc', points: 'jersey-points', mountain: 'jersey-mountain', game: 'jersey-game' } as Record<string, string>)[classMode || 'game'] || '';
      const collapsible = compact && sorted.length > COMPACT_TOP + 1;
      // Score-balkjes: aandeel t.o.v. de leider (alleen punten-klassementen, niet AK-tijden)
      const leaderVal = classMode !== 'gc' && sorted.length ? Number(formatFn(sorted[0], 0)) : 0;
      const rows = sorted.map((s, i) => {
        const isMe = s.display_name === myName;
        const isLeader = i === 0 && sorted.length > 0;
        const delta = rankDelta?.get(s.user_id);
        const deltaHtml = delta != null && delta !== 0
          ? `<span class="rank-change ${delta > 0 ? 'rank-up' : 'rank-down'}">${delta > 0 ? '↑' : '↓'}${Math.abs(delta) > 1 ? Math.abs(delta) : ''}</span>`
          : '';
        return {
          user_id: s.user_id,
          name: s.display_name,
          isMe,
          isLeader,
          extra: collapsible && i >= COMPACT_TOP && !isMe,
          deltaHtml,
          valueHtml: String(formatFn(s, i)),
          barPct: classMode !== 'gc' && leaderVal > 0 && isFinite(Number(formatFn(s, i)))
            ? Math.max(0, Math.min(100, (Number(formatFn(s, i)) / leaderVal) * 100))
            : null,
          showTrui: isLeader && !!jerseyClass,
          showH2h: s.display_name !== myName,
        };
      });
      const hero = sorted.length > 0
        ? { name: sorted[0].display_name, label: heroLabel != null ? String(heroLabel) : null }
        : null;
      return { mode: classMode || 'game', jerseyClass, rows, collapsible, count: sorted.length, hero };
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

    const newVm: any = { gc: null, points: null, mountain: null, combativity: null, game: null };

    if (!isClassic) {
      const gc = [...standings].sort((a, b) => a.total_time - b.total_time);
      const leaderTime = gc.length ? gc[0].total_time : 0;
      const winnerTimeSum = appState._cache.winnerTimeSum || 0;

      const gcDeltas = computeRankDeltas(gc, s => s.total_time,
        p => (p.dnf_penalty_gap ?? p.time_gap ?? 0) - (p.bonification ?? 0), true);

      const gcHeroLabel = gc.length > 0 && winnerTimeSum > 0 ? formatTime(winnerTimeSum + leaderTime) : null;
      newVm.gc = buildTable(gc, (s, i) => {
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
      }, gcHeroLabel, gcDeltas, 'gc');

      const pts = [...standings].sort((a, b) => b.total_points - a.total_points);
      const ptsDeltas = computeRankDeltas(pts, s => s.total_points, p => p.effective_points ?? 0, false);
      newVm.points = buildTable(pts, (s) => s.total_points,
        pts.length > 0 ? pts[0].total_points + ' pts' : null, ptsDeltas, 'points', true);

      const mt = [...standings].sort((a, b) => b.total_mountain_points - a.total_mountain_points);
      const mtDeltas = computeRankDeltas(mt, s => s.total_mountain_points, p => p.effective_mountain_points ?? 0, false);
      newVm.mountain = buildTable(mt, (s) => s.total_mountain_points,
        mt.length > 0 ? mt[0].total_mountain_points + ' pts' : null, mtDeltas, 'mountain', true);

      // Status-strip: AK, Punten, Berg
      const myGcIdx = gc.findIndex(s => s.display_name === myName);
      if (myGcIdx >= 0) entries.push({
        label: 'Algemeen',
        value: `${myGcIdx + 1}e`,
        sub: myGcIdx > 0 ? `${formatGap(gc[myGcIdx].total_time - leaderTime)} achter` : 'aan de leiding',
        deltaHtml: deltaChip(gcDeltas?.get(gc[myGcIdx].user_id)),
        jersey: 'gc',
      });
      const myPtsIdx = pts.findIndex(s => s.display_name === myName);
      if (myPtsIdx >= 0) entries.push({
        label: 'Punten',
        value: `${myPtsIdx + 1}e`,
        sub: `${pts[myPtsIdx].total_points} pts`,
        deltaHtml: deltaChip(ptsDeltas?.get(pts[myPtsIdx].user_id)),
        jersey: 'points',
      });
      const myMtIdx = mt.findIndex(s => s.display_name === myName);
      if (myMtIdx >= 0) entries.push({
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
    newVm.combativity = buildTable(cv, (s) => s.total_combativity_points || 0,
      cv.length > 0 ? (cv[0].total_combativity_points || 0) + ' pts' : null, cvDeltas, 'combativity', true);

    const gp = [...standings].sort((a, b) => b.total_game_points - a.total_game_points);
    const gpDeltas = computeRankDeltas(gp, s => s.total_game_points, p => p.effective_game_points ?? 0, false);
    newVm.game = buildTable(gp, (s) => s.total_game_points || 0,
      gp.length > 0 ? (gp[0].total_game_points || 0) + ' pts' : null, gpDeltas);

    // Status-strip: Spel (klassieker) + Strijdlust
    if (isClassic) {
      const myGpIdx = gp.findIndex(s => s.display_name === myName);
      if (myGpIdx >= 0) entries.push({
        label: 'Spel',
        value: `${myGpIdx + 1}e`,
        sub: `${gp[myGpIdx].total_game_points || 0} pts`,
        deltaHtml: deltaChip(gpDeltas?.get(gp[myGpIdx].user_id)),
        jersey: 'game',
      });
    }
    const myCvIdx = cv.findIndex(s => s.display_name === myName);
    if (myCvIdx >= 0) entries.push({
      label: 'Strijdlust',
      value: `${cv[myCvIdx].total_combativity_points || 0}`,
      sub: 'winnaars geraden',
      deltaHtml: deltaChip(cvDeltas?.get(cv[myCvIdx].user_id)),
    });

    vm = newVm;
    statusEntries = entries;

    // "Jouw koers": volgende etappe met pick-status (was renderMyStatus)
    const comp = appState.competitions.find(c => c.id === appState.activeCompId);
    statusComp = comp || null;
    const now = new Date();
    const nextOpen = activeStages()
      .filter(s => !s.locked && now <= new Date(s.deadline))
      .sort((a, b) => a.stage_number - b.stage_number)[0];
    if (nextOpen) {
      const pick = appState.myPicks.find(p => p.stage_id === nextOpen.id);
      const rider = pick ? appState._riderMap[pick.rider_id] : null;
      statusNext = {
        stageTitle: nextOpen.stage_number === 0 ? 'Proloog' : `Etappe ${nextOpen.stage_number}`,
        name: nextOpen.name || null,
        deadline: nextOpen.deadline,
        riderName: rider ? rider.name : null,
      };
    } else {
      statusNext = null;
    }

    // Inleg-banner: betaalverzoek voor de prijzenpot, vanaf de startdag van
    // etappe 1 tot de speler hem wegklikt (localStorage) of betaald heeft
    // (competition_participants.has_paid, admin vinkt af) — port van main
    const stage1 = activeStages().find(s => s.stage_number === 1);
    const potKandidaat = !!(
      comp?.name?.includes('Tour de France 2026') &&
      localStorage.getItem(POT_BANNER_KEY) !== '1' &&
      stage1 && new Date() >= new Date(new Date(stage1.start_time).toDateString())
    );
    if (potKandidaat) {
      try {
        const paidRows = await supaRest('competition_pot_status', {
          select: 'has_paid',
          filters: `competition_id=eq.${comp.id}&user_id=eq.${appState.session.user.id}`,
        });
        potBanner = !paidRows?.[0]?.has_paid;
      } catch (_) { potBanner = true; /* status onbekend → tonen */ }
    } else {
      potBanner = false;
    }

    // Welkom-hero: deelname is impliciet (eerste pick = meedoen) — (was renderWelcomeCard)
    const compStageIdSet = new Set(activeStages().map(s => s.id));
    const hasPicks = appState.myPicks.some(p => compStageIdSet.has(p.stage_id));
    welcome = (!comp || hasPicks || !nextOpen)
      ? null
      : {
          compName: comp.name,
          stageTitle: nextOpen.stage_number === 0 ? 'de proloog' : `etappe ${nextOpen.stage_number}`,
          deadline: nextOpen.deadline,
        };

    // Pot kaart — asynchroon renderen (blokkeert standings niet)
    renderPotCard(standings).catch(() => {});

    // Rad-theater: check of er ongeziene Rad-picks zijn (of ?radtest=1)
    if (!radTheater) buildRadTheater().catch(() => {});
  }

  export function refresh() {
    return loadStandings();
  }

  // Laden bij mount + comp-wissel; appState._cache.standings = null (realtime-invalidatie)
  // triggert eveneens een herlaad-cyclus.
  $effect(() => {
    void appState.activeCompId;
    void appState._cache.standings;
    void appState._cache.standingsCompId;
    untrack(() => { void loadStandings(); });
  });

  // --- PRIJZENPOT ---
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
    const activeComp = appState.competitions.find(c => c.id === appState.activeCompId);
    if (!activeComp?.entry_fee) { potVM = null; return; }

    const participants = await supaRest('competition_pot_status', {
      select: 'user_id,has_paid',
      filters: `competition_id=eq.${appState.activeCompId}`,
    });

    const paidIds = new Set((participants || []).filter((p: any) => p.has_paid).map((p: any) => p.user_id));
    const paidCount = paidIds.size;
    const totalPot = paidCount * activeComp.entry_fee;

    // Alleen betalende spelers komen in aanmerking voor prijzen.
    // Vóór de eerste uitslag staat iedereen op 0 — dan zou de hele groep als
    // "gedeeld winnaar" verschijnen. Toon dan wel de pot en de bedragen, maar
    // nog geen spelers.
    const hasResults = activeStages().some(s => s.locked) && standings.some(s => (s.stages_played || 0) > 0);
    const paid = hasResults ? standings.filter(s => paidIds.has(s.user_id)) : [];
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

    potVM = {
      provisional: isProvisional,
      totalPot,
      paidCount,
      entryFee: activeComp.entry_fee,
      rows: prizeRows.map(row => ({
        ...row,
        amountEach: Math.floor(totalPot * row.pctEach / 100),
        pctDisplay: Number.isInteger(row.pctEach) ? `${row.pctEach}%` : `${row.pctEach.toFixed(1)}%`,
        isTie: row.winners.length > 1,
      })),
    };
  }

  // --- HEAD-TO-HEAD ---
  async function openH2H(opponentName: string, mode = 'game') {
    h2hHtml = '<div class="text-center text-muted py-3">Laden...</div>';
    h2hOpen = true;

    try {
      // Cache per ronde: opeenvolgende H2H's (populair tijdens de Tour) delen
      // dezelfde grote query i.p.v. hem elke keer opnieuw op te halen.
      let allPicks = (appState._cache as any).h2hPicksCompId === appState.activeCompId
        ? (appState._cache as any).h2hPicks : null;
      if (!allPicks) {
        allPicks = await supaRest('stage_picks_public', {
          filters: `competition_id=eq.${appState.activeCompId}`,
          select: 'stage_id,stage_number,user_id,display_name,rider_name,time_gap,dnf_penalty_gap,bonification,effective_points,effective_mountain_points,effective_game_points,finish_position,dnf,is_late'
        });
        (appState._cache as any).h2hPicks = allPicks;
        (appState._cache as any).h2hPicksCompId = appState.activeCompId;
      }

      const myPks = allPicks.filter(p => p.display_name === appState.profile?.display_name);
      const oppPks = allPicks.filter(p => p.display_name === opponentName);
      const stageNums = [...new Set(allPicks.map(p => p.stage_number))].sort((a: any, b: any) => a - b);

      const header = `
        <div class="h2h-vs">
          <div class="h2h-player" style="color:var(--accent);">${escapeHtml(appState.profile?.display_name || '?')}</div>
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

        h2hHtml = `${header}${stageRows}
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

        h2hHtml = `${header}${stageRows}
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

        h2hHtml = `${header}${stageRows}
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

        h2hHtml = `${header}${stageRows}
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

        h2hHtml = `${header}${stageRows}
          <div class="h2h-score-summary">
            <div class="h2h-stat"><div class="h2h-stat-label">Etappes gewonnen</div><div class="h2h-stat-value" style="color:var(--green);">${myWins} – ${oppWins}</div></div>
            <div class="h2h-stat"><div class="h2h-stat-label">Totaal spelpunten</div><div class="h2h-stat-value">${myTotal} – ${oppTotal}</div></div>
          </div>`;
      }
    } catch (e: any) {
      h2hHtml = `<div class="text-danger">${e.message}</div>`;
    }
  }
</script>

<!-- Leader hero boven elk klassement. Let op: .leader-hero:not(:empty) → display:flex
     in style.css, dus zonder leider expliciet display:none (anchor-nodes veilig). -->
{#snippet heroBlock(key: string, t: any)}
  <div id="{key}-hero" class="leader-hero" style:display={t?.hero ? null : 'none'}>{#if t?.hero}<div class="leader-hero-inner">
      <div class="d-flex align-items-center gap-2">
        {@html avatarHtml(t.hero.name, appState._avatarMap[t.hero.name], '')}
        <div>
          <div class="leader-hero-name">{t.hero.name}</div>
          <div class="leader-hero-sub">Leider</div>
        </div>
      </div>
      {#if t.hero.label != null}<div class="leader-hero-score">{t.hero.label}</div>{/if}
    </div>{/if}</div>
{/snippet}

{#snippet standingsBody(key: string, t: any)}
  <tbody id="{key}-table" class={expanded[key] ? 'expanded' : undefined}>
    {#if noComp}
      {#if key !== 'combativity'}
        <tr><td colspan="3"><div class="empty-state"><div class="empty-state-icon">{@html icon('flag', '', 32)}</div><div class="empty-state-text">Selecteer een ronde om het klassement te zien</div></div></td></tr>
      {/if}
    {:else if loading && key !== 'combativity'}
      <!-- skeletonRows() levert <tr>-strings; die kunnen niet via {@html} in een tbody — zelfde markup inline -->
      {#each Array.from({ length: 5 }) as _}
        <tr><td colspan="3"><div class="skeleton skeleton-row"></div></td></tr>
      {/each}
    {:else if t}
      {#if t.rows.length === 0}
        <tr><td colspan="3" class="text-muted text-center py-3">Nog geen resultaten — wordt zichtbaar na de eerste etappe</td></tr>
      {:else}
        {#each t.rows as row, i (row.user_id)}
          <tr
            style={row.isMe ? 'background:var(--accent-bg);' : undefined}
            class={row.isLeader ? `leader-row${t.jerseyClass ? ' wears ' + t.jerseyClass : ''}` : (row.extra ? 'standings-extra' : undefined)}
          ><td class="tnum">{@html rankBadge(i)}{@html row.deltaHtml}</td><td><div class="d-flex align-items-center gap-2"><span class="player-click d-inline-flex align-items-center gap-2" role="button" tabindex="0" onclick={() => (ui.playerModalId = row.user_id)} onkeydown={(e) => { if (e.key === 'Enter') ui.playerModalId = row.user_id; }}>{@html avatarHtml(row.name, appState._avatarMap[row.name], 'sm')}{row.name}</span>{#if row.showTrui}<span class="trui-chip">trui</span>{/if}{#if row.showH2h}<button class="btn btn-ghost h2h-vs-btn" onclick={() => openH2H(row.name, t.mode)} aria-label="Vergelijk met {row.name}">vs</button>{/if}</div></td><td class="text-end tnum">{@html row.valueHtml}{#if row.barPct != null}<span class="score-bar score-bar-{t.mode}"><span style="width:{row.barPct}%"></span></span>{/if}</td></tr>
        {/each}
        {#if t.collapsible}
          <tr class="standings-expand-row"><td colspan="3"><button type="button" class="standings-expand-btn" onclick={() => expanded[key] = !expanded[key]}>{expanded[key] ? `Toon top ${COMPACT_TOP}` : `Toon alle ${t.count} spelers`}</button></td></tr>
        {/if}
      {/if}
    {/if}
  </tbody>
{/snippet}

<!-- Dashboard -->
<div class="tab-section active" id="section-dashboard">
  <!-- Welkom-hero: zichtbaar zolang je nog geen pick hebt in de actieve ronde -->
  <!-- Inleg-betaalverzoek: zichtbaar tijdens de Tour tot weggeklikt -->
  {#if potBanner}
    <div id="pot-banner-wrap" class="mb-4">
      <div class="card welcome-card">
        <div class="card-body">
          <div class="welcome-card-inner">
            <div>
              <div class="welcome-card-title">De Tour is begonnen — doe je inleg in de pot</div>
              <div class="welcome-card-sub">Inleg voor het Bagagedragerspel TdF is €10,00. Betaal via het Rabobank-betaalverzoek — dat werkt met elke Nederlandse bank. Dank je wel!</div>
            </div>
            <div class="d-flex align-items-center gap-2 welcome-card-cta">
              <a class="btn btn-accent btn-skew" href={POT_BETAALLINK} target="_blank" rel="noopener"><span>Betaal €10 inleg ↗</span></a>
              <button class="btn btn-ghost" title="Melding verbergen" onclick={dismissPotBanner}>Later</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}
  {#if welcome}
    <div id="welcome-card-wrap" class="mb-4">
      <div class="card welcome-card">
        <div class="card-body">
          <div class="welcome-card-inner">
            <div>
              <div class="welcome-card-title">Je doet nog niet mee aan {welcome.compName}</div>
              <div class="welcome-card-sub">Kies je renner voor {welcome.stageTitle} en je zit in de koers — daarna doe je automatisch mee met alle klassementen. Deadline: {formatDeadline(welcome.deadline)}.</div>
            </div>
            <button class="btn btn-accent btn-skew welcome-card-cta" onclick={goPick}><span>Kies je eerste renner</span></button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Jouw koers: persoonlijke status-strip -->
  {#if statusComp && statusEntries.length}
    <div id="my-status-wrap" class="mb-4">
      <div class="card my-status-card">
        <div class="card-body">
          <div class="my-status-label">Jouw koers — {statusComp.name}</div>
          <div class="my-status-stats">
            {#each statusEntries as e}
              <div class="my-status-stat{e.jersey ? ' jersey-' + e.jersey : ''}">
                <div class="my-status-value display tnum">{e.value}{@html e.deltaHtml || ''}</div>
                <div class="my-status-stat-label">{e.label}{#if e.sub}<span class="my-status-sub"> · {e.sub}</span>{/if}</div>
              </div>
            {/each}
          </div>
          {#if statusNext}
            <div class="my-status-next">
              <span class="my-status-next-stage">Volgende: <strong>{statusNext.stageTitle}</strong>{statusNext.name ? ` · ${statusNext.name}` : ''} · deadline {formatDeadline(statusNext.deadline)}</span>
              {#if statusNext.riderName}
                <span class="my-status-pick">✓ {statusNext.riderName}</span>
              {:else}
                <button class="btn btn-accent btn-sm" onclick={goPick}>Kies je renner</button>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <div class="row g-4" id="standings-row">
    <!-- Hoofdklassement: AK (grote ronde) of Spel (klassieker) -->
    <div class="col-lg-7 standings-col" id="standings-main">
      <div id="gc-card" style:display={cardMode === 'classic' ? 'none' : null}>
        <div class="card standings-main-card">
          <div class="card-header jersey-gc"><h5 class="mb-0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-jersey" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Algemeen Klassement <span class="info-tooltip" data-tip="Totaal tijdsverschil met de etappewinnaar per etappe.\nBonificatie: 1e −10s, 2e −6s, 3e −4s.\nTe laat of DNF = slechtste tijd.">&#9432;</span></h5></div>
          {@render heroBlock('gc', vm.gc)}
          <div class="card-body p-0 table-responsive-wrapper">
            <table class="table table-sm table-striped mb-0">
              <thead><tr><th>#</th><th>Speler</th><th class="text-end" style="min-width:8rem;">Tijd</th></tr></thead>
              {@render standingsBody('gc', vm.gc)}
            </table>
          </div>
        </div>
      </div>
      <div id="game-card" style:display={cardMode === 'grand_tour' ? 'none' : null}>
        <div class="card standings-main-card">
          <div class="card-header jersey-game"><h5 class="mb-0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-jersey" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg> Spelklassement <span class="info-tooltip" data-tip="Spelpunten op basis van finishpositie (1e=100, 2e=80, 3e=70 … 20e=5).\nDeelpenalty als meerdere spelers dezelfde renner kiezen.\nTe laat of DNF = 0 punten.">&#9432;</span></h5></div>
          {@render heroBlock('game', vm.game)}
          <div class="card-body p-0 table-responsive-wrapper">
            <table class="table table-sm table-striped mb-0">
              <thead><tr><th>#</th><th>Speler</th><th class="text-end">Pts</th></tr></thead>
              {@render standingsBody('game', vm.game)}
            </table>
          </div>
        </div>
      </div>
    </div>
    <!-- Zijkolom: compacte klassementen -->
    <div class="col-lg-5 standings-col" id="standings-side">
      <div id="points-card" style:display={cardMode === 'classic' ? 'none' : null}>
        <div class="card">
          <div class="card-header jersey-points"><h5 class="mb-0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-jersey" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Puntenklassement <span class="info-tooltip" data-tip="Totaal sprintpunten van jouw gekozen renners, overgenomen uit het puntenklassement op PCS.">&#9432;</span></h5></div>
          {@render heroBlock('points', vm.points)}
          <div class="card-body p-0 table-responsive-wrapper">
            <table class="table table-sm table-striped mb-0">
              <thead><tr><th>#</th><th>Speler</th><th class="text-end">Pts</th></tr></thead>
              {@render standingsBody('points', vm.points)}
            </table>
          </div>
        </div>
      </div>
      <div id="mountain-card" style:display={cardMode === 'classic' ? 'none' : null}>
        <div class="card">
          <div class="card-header jersey-mountain"><h5 class="mb-0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-jersey" aria-hidden="true"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg> Bergklassement <span class="info-tooltip" data-tip="Totaal bergpunten (KOM) van jouw gekozen renners, overgenomen uit het bergklassement op PCS.">&#9432;</span></h5></div>
          {@render heroBlock('mountain', vm.mountain)}
          <div class="card-body p-0 table-responsive-wrapper">
            <table class="table table-sm table-striped mb-0">
              <thead><tr><th>#</th><th>Speler</th><th class="text-end">Pts</th></tr></thead>
              {@render standingsBody('mountain', vm.mountain)}
            </table>
          </div>
        </div>
      </div>
      <div id="combativity-card">
        <div class="card">
          <div class="card-header jersey-game"><h5 class="mb-0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-jersey" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Strijdlust <span class="info-tooltip" data-tip="1 punt als je de etappewinnaar correct hebt voorspeld.\nTe laat of DNF = 0 punten.">&#9432;</span></h5></div>
          {@render heroBlock('combativity', vm.combativity)}
          <div class="card-body p-0 table-responsive-wrapper">
            <table class="table table-sm table-striped mb-0">
              <thead><tr><th>#</th><th>Speler</th><th class="text-end">Pts</th></tr></thead>
              {@render standingsBody('combativity', vm.combativity)}
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Prijzenpot -->
  {#if potVM}
    <div id="pot-card-wrap" class="mt-4 mb-5">
      <div class="card">
        <div class="card-header d-flex align-items-center justify-content-between">
          <h5 class="mb-0">Prijzenpot {#if potVM.provisional}<span class="badge bg-warning ms-1" style="font-size:0.65rem;">Voorlopig</span>{/if}</h5>
          <span style="font-size:0.85rem;color:var(--text-muted);">€{potVM.totalPot} &nbsp;<span style="font-size:0.75rem;">({potVM.paidCount} × €{potVM.entryFee})</span></span>
        </div>
        <div class="card-body p-0 table-responsive-wrapper">
          <table class="table table-sm mb-0">
            <thead><tr><th>Prijs</th><th>Speler</th><th class="text-end">Bedrag</th><th class="text-end" style="color:var(--text-muted);font-size:0.75rem;">%</th></tr></thead>
            <tbody>
              {#each potVM.rows as row}
                {#if row.winners.length === 0}
                  <tr>
                    <td style="font-size:0.85rem;">{row.label}</td>
                    <td>—</td>
                    <td class="text-end">€{row.amountEach}</td>
                    <td class="text-end" style="color:var(--text-muted);font-size:0.75rem;">{row.pctDisplay}</td>
                  </tr>
                {:else}
                  {#each row.winners as s, idx}
                    <tr style={s.user_id === appState.session?.user?.id ? 'background:var(--accent-bg);' : undefined}>
                      <td style="font-size:0.85rem;">{#if idx === 0}{row.label}{#if row.isTie}&nbsp;<span class="badge bg-secondary ms-1" style="font-size:0.6rem;vertical-align:middle;">gedeeld</span>{/if}{/if}</td>
                      <td><span class="player-click" role="button" tabindex="0" onclick={() => (ui.playerModalId = s.user_id)} onkeydown={(e) => { if (e.key === 'Enter') ui.playerModalId = s.user_id; }}>{s.display_name}</span></td>
                      <td class="text-end" style="font-weight:700;">€{row.amountEach}</td>
                      <td class="text-end" style="color:var(--text-muted);font-size:0.75rem;">{#if idx === 0}{row.pctDisplay}{/if}</td>
                    </tr>
                  {/each}
                {/if}
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  {/if}
</div>

<!-- Rad van Fortuin-theater -->
{#if radTheater}
  <RadTheater
    pool={radTheater.pool}
    spins={radTheater.spins}
    stageLabel={radTheater.stageLabel}
    onDismiss={dismissRadTheater}
  />
{/if}

<!-- Head-to-head modal -->
{#if h2hOpen}
  <div id="h2h-overlay" class="h2h-overlay" style="display:flex;" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) h2hOpen = false; }}>
    <div class="h2h-modal" role="dialog" aria-modal="true" aria-label="Head-to-head" use:focusTrap>
      <div class="h2h-header">
        <h3>Head-to-Head</h3>
        <button class="h2h-close" onclick={() => (h2hOpen = false)}>&times;</button>
      </div>
      <div id="h2h-content">{@html h2hHtml}</div>
    </div>
  </div>
{/if}
