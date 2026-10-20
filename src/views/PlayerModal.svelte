<!--
  Speler-detailmodal — app-breed te openen via ui.playerModalId (user_id).
  Hergebruikt de H2H-modalklassen (.h2h-overlay/.h2h-modal/.h2h-header) en de
  trui-stat-tegels (.my-status-stat). Data: profiel uit appState._cache.allProfiles,
  posities uit de standings-cache (of general_classification zoals Dashboard),
  recente picks uit stage_picks_public (view is deadline-veilig), en de geschiedenis:
  eindposities per ronde uit general_classification (per ronde apart opgehaald —
  PostgREST kapt af op 1000 rijen), DNS-spelers uit competition_pot_status.
  "Vergelijk (H2H)": zet ui.h2hRequest en springt naar het dashboard — Dashboard
  heeft een $effect dat daarop de bestaande H2H opent.
-->
<script lang="ts">
  import { state as appState, ui } from '../lib/state.svelte';
  import { formatGap, avatarHtml, riderDisplay } from '../lib/utils';
  import { icon } from '../lib/icons';
  import { supaRest } from '../lib/api';
  import { activeScoringMode, riderPhoto, teamBadge } from '../lib/helpers';
  import { focusTrap } from '../lib/focus-trap';

  // Zelfde rol-logica als Peloton.svelte (bewust klein gekopieerd)
  function getPelotonRole(p: any, totalPicks: number) {
    if (p?.is_admin) return { name: 'Ploegleider', badge: 'bg-danger', icon: icon('shield', '', 13) };
    if (totalPicks >= 15) return { name: 'Kopman', badge: 'bg-warning text-dark', icon: icon('crown', '', 13) };
    if (totalPicks >= 5) return { name: 'Luitenant', badge: 'bg-primary', icon: icon('star', '', 13) };
    if (totalPicks >= 1) return { name: 'Knecht', badge: 'bg-success', icon: icon('bike', '', 13) };
    return { name: 'Stagiair', badge: 'bg-secondary', icon: icon('cyclist', '', 13) };
  }

  const player = $derived(ui.playerModalId
    ? (appState._cache.allProfiles || []).find((p: any) => p.id === ui.playerModalId) || null
    : null);
  const isMe = $derived(ui.playerModalId === appState.session?.user?.id);

  let role: any = $state(null);
  let positions: { label: string; value: string; sub: string; jersey: string }[] = $state([]);
  let posLoaded = $state(false);
  let recentPicks: any[] | null = $state(null);

  // --- Geschiedenis: eindpositie per klassement per ronde ---
  type HistPos = { key: string; label: string; rank: number | null; jersey: string };
  type HistRow = { compId: number; name: string; year: number; flag: string; running: boolean; dns: boolean; count: number; stagesPlayed: number; pos: HistPos[] };
  let history: HistRow[] | null = $state(null);

  // Gedeelde positie: 1 + aantal spelers dat strikt beter staat
  const sharedRank = (rows: any[], me: any, better: (a: any, b: any) => boolean) =>
    1 + rows.filter((r) => better(r, me)).length;

  async function loadHistory(id: string) {
    const mine: any[] = await supaRest('general_classification', {
      select: 'competition_id,stages_played', filters: `user_id=eq.${id}`,
    }).catch(() => []);
    const compIds = (mine || []).filter((r) => (r.stages_played || 0) > 0).map((r) => r.competition_id);
    const perComp = await Promise.all(compIds.map((cid: number) => Promise.all([
      supaRest('general_classification', {
        select: 'user_id,stages_played,total_time,total_points,total_mountain_points,total_game_points',
        filters: `competition_id=eq.${cid}`,
      }).catch(() => []),
      supaRest('competition_pot_status', { select: 'user_id', filters: `competition_id=eq.${cid}&is_dns=eq.true` }).catch(() => []),
    ])));
    if (ui.playerModalId !== id) return;

    const out: HistRow[] = [];
    compIds.forEach((cid: number, i: number) => {
      const comp = appState.competitions.find((c: any) => c.id === cid);
      if (!comp) return;
      const [rows, dnsRows] = perComp[i] as [any[], any[]];
      const dnsIds = new Set((dnsRows || []).map((r: any) => r.user_id));
      const me = (rows || []).find((r: any) => r.user_id === id);
      if (!me) return;
      const dns = dnsIds.has(id);
      const active = (rows || []).filter((r: any) => !dnsIds.has(r.user_id));
      const rank = (better: (a: any, b: any) => boolean) => (dns ? null : sharedRank(active, me, better));
      const pos: HistPos[] = [];
      if (comp.scoring_mode !== 'classic') {
        pos.push({ key: 'gc', label: 'AK', jersey: 'gc', rank: rank((a, b) => a.total_time < b.total_time) });
        pos.push({ key: 'pts', label: 'Punten', jersey: 'points', rank: rank((a, b) => (a.total_points || 0) > (b.total_points || 0)) });
        pos.push({ key: 'mt', label: 'Berg', jersey: 'mountain', rank: rank((a, b) => (a.total_mountain_points || 0) > (b.total_mountain_points || 0)) });
      }
      pos.push({ key: 'game', label: 'Spel', jersey: 'game', rank: rank((a, b) => (a.total_game_points || 0) > (b.total_game_points || 0)) });
      const compStages = appState.stages.filter((st: any) => st.competition_id === cid);
      out.push({
        compId: cid, name: comp.name, year: comp.year, flag: comp.country_flag || '',
        running: !!comp.is_active && compStages.some((st: any) => !st.locked),
        dns, count: active.length, stagesPlayed: me.stages_played || 0, pos,
      });
    });
    out.sort((a, b) => b.year - a.year || b.compId - a.compId);
    history = out;
  }

  // Samenvatting: aantal rondes + gewonnen truien (alleen afgeronde rondes)
  const historySummary = $derived.by(() => {
    if (!history?.length) return '';
    const wins = history.filter((h) => !h.running).reduce((n, h) => n + h.pos.filter((p) => p.rank === 1).length, 0);
    const rondes = `${history.length} ${history.length === 1 ? 'ronde' : 'rondes'}`;
    return wins ? `${rondes} · ${wins} ${wins === 1 ? 'trui' : 'truien'} gewonnen` : rondes;
  });

  function close() { ui.playerModalId = null; }

  function openCompare() {
    const name = player?.display_name;
    if (!name) return;
    ui.h2hRequest = { name, mode: activeScoringMode() === 'classic' ? 'game' : 'gc' };
    close();
    ui.activeTab = 'dashboard';
    location.hash = 'dashboard';
  }

  async function load(id: string) {
    const compId = appState.activeCompId;
    let standingsP: Promise<any[]>;
    if (appState._cache.standingsCompId === compId && appState._cache.standings) {
      standingsP = Promise.resolve(appState._cache.standings);
    } else if (compId) {
      // Zelfde fetch + cache-vulling als Dashboard.loadStandings
      standingsP = supaRest('general_classification', { filters: `competition_id=eq.${compId}` })
        .then((data: any[]) => {
          appState._cache.standings = data;
          appState._cache.standingsCompId = compId;
          return data;
        });
    } else {
      standingsP = Promise.resolve([]);
    }

    const [pickRows, standings, recent] = await Promise.all([
      supaRest('picks', { select: 'user_id', filters: `user_id=eq.${id}` }).catch(() => []),
      standingsP.catch(() => []),
      compId
        ? supaRest('stage_picks_public', {
            select: 'stage_id,stage_number,rider_id,rider_name,effective_game_points,is_late,dnf',
            filters: `competition_id=eq.${compId}&user_id=eq.${id}&order=stage_number.desc&limit=5`,
          }).catch(() => [])
        : Promise.resolve([]),
    ]);
    if (ui.playerModalId !== id) return; // modal intussen gesloten/gewisseld

    role = getPelotonRole(player, (pickRows || []).length);
    recentPicks = recent || [];

    const entries: typeof positions = [];
    const s: any[] = standings || [];
    const row = s.find((r) => r.user_id === id);
    if (row) {
      const byId = (arr: any[]) => arr.findIndex((r) => r.user_id === id);
      if (activeScoringMode() !== 'classic') {
        const gc = [...s].sort((a, b) => a.total_time - b.total_time);
        const gi = byId(gc);
        entries.push({
          label: 'Algemeen', value: `${gi + 1}e`, jersey: 'gc',
          sub: gi > 0 ? `${formatGap(row.total_time - gc[0].total_time)} achter` : 'aan de leiding',
        });
        const pts = [...s].sort((a, b) => b.total_points - a.total_points);
        entries.push({ label: 'Punten', value: `${byId(pts) + 1}e`, sub: `${row.total_points || 0} pts`, jersey: 'points' });
        const mt = [...s].sort((a, b) => b.total_mountain_points - a.total_mountain_points);
        entries.push({ label: 'Berg', value: `${byId(mt) + 1}e`, sub: `${row.total_mountain_points || 0} pts`, jersey: 'mountain' });
      }
      const gp = [...s].sort((a, b) => b.total_game_points - a.total_game_points);
      entries.push({ label: 'Spel', value: `${byId(gp) + 1}e`, sub: `${row.total_game_points || 0} pts`, jersey: 'game' });
    }
    positions = entries;
    posLoaded = true;
  }

  // Laden bij openen; reset bij wisselen van speler
  $effect(() => {
    const id = ui.playerModalId;
    if (!id) return;
    role = null; positions = []; posLoaded = false; recentPicks = null; history = null;
    load(id);
    loadHistory(id);
  });

  // Escape sluit — tenzij de renner-modal erbovenop open staat (die sluit eerst)
  $effect(() => {
    if (!ui.playerModalId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !ui.riderModalId) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

{#if ui.playerModalId}
  <div class="h2h-overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="h2h-modal detail-modal" role="dialog" aria-modal="true" aria-label="Spelerdetails" use:focusTrap>
      <div class="h2h-header">
        <h3>Speler</h3>
        <button class="h2h-close" aria-label="Sluiten" onclick={close}>&times;</button>
      </div>
      {#if player}
        <div class="pm-head">
          {@html avatarHtml(player.display_name, player.avatar_url, 'lg')}
          <div>
            <div class="pm-name">{player.display_name}</div>
            <div class="pm-meta">
              {#if role}<span class="badge {role.badge}">{@html role.icon} {role.name}</span>{/if}
              {#if player.favorite_team}{@html teamBadge(player.favorite_team)}{/if}
              {#if player.cycling_hero}<span class="pm-hero">Held: {player.cycling_hero}</span>{/if}
            </div>
            {#if player.motto}<div class="pm-motto">"{player.motto}"</div>{/if}
          </div>
        </div>

        <div class="pm-section-label">Klassementen</div>
        {#if !posLoaded}
          <div class="pm-empty">Laden...</div>
        {:else if positions.length}
          <div class="pm-stats">
            {#each positions as e}
              <div class="my-status-stat jersey-{e.jersey}">
                <div class="my-status-value display tnum">{e.value}</div>
                <div class="my-status-stat-label">{e.label}<span class="my-status-sub"> · {e.sub}</span></div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="pm-empty">Nog geen klassement — deze speler heeft nog geen picks in deze ronde.</div>
        {/if}

        <div class="pm-section-label">Recente keuzes</div>
        {#if recentPicks === null}
          <div class="pm-empty">Laden...</div>
        {:else if !recentPicks.length}
          <div class="pm-empty">Nog geen zichtbare keuzes — keuzes verschijnen na de deadline.</div>
        {:else}
          <div>
            {#each recentPicks as p (p.stage_id)}
              <div class="pm-pick-row">
                <span class="pm-pick-stage">{p.stage_number === 0 ? 'Prlg' : `E${p.stage_number}`}</span>
                <span>{@html riderDisplay(p.rider_name, riderPhoto(p.rider_id), p.rider_id)}{#if p.dnf}&nbsp;<span class="badge bg-danger" style="font-size:0.58rem;">DNF</span>{/if}{#if p.is_late}&nbsp;<span class="badge bg-warning" style="font-size:0.58rem;">Te laat</span>{/if}</span>
                <span class="pm-pick-pts tnum">{p.is_late || p.dnf ? 0 : (p.effective_game_points ?? '—')} pts</span>
              </div>
            {/each}
          </div>
        {/if}

        <div class="pm-section-label">Geschiedenis{#if historySummary}<span class="pm-hist-summary"> · {historySummary}</span>{/if}</div>
        {#if history === null}
          <div class="skeleton skeleton-row"></div>
        {:else if !history.length}
          <div class="pm-empty">Nog geen rondes gespeeld.</div>
        {:else}
          <div>
            {#each history as h (h.compId)}
              <div class="pm-hist-row">
                <div class="pm-hist-head">
                  <span class="pm-hist-name">{h.flag} {h.name}</span>
                  <span class="pm-hist-meta">{h.year}{#if h.running} · <span class="badge bg-info">lopend</span>{/if}</span>
                </div>
                {#if h.dns}
                  <div class="pm-hist-chips"><span class="badge bg-secondary">DNS</span><span class="pm-hist-meta">na {h.stagesPlayed} etappes</span></div>
                {:else}
                  <div class="pm-hist-chips">
                    {#each h.pos as p (p.key)}
                      <span class="pm-hist-chip jersey-{p.jersey}" class:won={p.rank === 1} title="{p.label}: {p.rank}e van {h.count}">
                        {p.label} <strong class="tnum">{p.rank}e</strong>
                      </span>
                    {/each}
                    <span class="pm-hist-meta tnum">van {h.count}</span>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        {#if !isMe}
          <div class="pm-actions">
            <button class="btn btn-accent btn-sm" onclick={openCompare}>Vergelijk (H2H)</button>
          </div>
        {/if}
      {:else}
        <p class="text-muted">Speler niet gevonden.</p>
      {/if}
    </div>
  </div>
{/if}
