<script lang="ts">
  // Geport uit public/views/peloton.ts — gedrag 1-op-1.
  // Dekt het hele Uitslagen-tabblad: uitslagen per etappe (loadParticipants)
  // + "Het Peloton"-ledenlijst (loadPeloton), zoals #section-participants in index.html.
  import { state as appState, ui } from '../lib/state.svelte';
  import { avatarHtml, formatTime, formatGap, riderDisplay, toast } from '../lib/utils';
  import { icon } from '../lib/icons';
  import { supaPatch, supaRest } from '../lib/api';
  import { activeScoringMode, buildPcsStageUrl, buildStageNewsUrl, riderPhoto, teamBadge } from '../lib/helpers';

  // --- Uitslagen (picks van iedereen, zichtbaar na deadline) ---
  let participantsMsg: string | null = $state('Laden...');
  let stageGroups: any[] = $state([]);
  let isClassic = $state(false);

  // --- PELOTON: alle gebruikers met wielren-rollen ---
  let profiles: any[] = $state([]);
  let pelotonLoaded = $state(false);
  const isAdmin = $derived(!!appState.profile?.is_admin);

  function getPelotonRole(p: any, totalPicks: number) {
    if (p.is_admin) return { name: 'Ploegleider', badge: 'bg-danger', icon: icon('shield', '', 13) };
    if (totalPicks >= 15) return { name: 'Kopman', badge: 'bg-warning text-dark', icon: icon('crown', '', 13) };
    if (totalPicks >= 5) return { name: 'Luitenant', badge: 'bg-primary', icon: icon('star', '', 13) };
    if (totalPicks >= 1) return { name: 'Knecht', badge: 'bg-success', icon: icon('bike', '', 13) };
    return { name: 'Stagiair', badge: 'bg-secondary', icon: icon('cyclist', '', 13) };
  }

  async function loadPeloton() {
    const [allProfiles, allPicks] = await Promise.all([
      appState._cache.allProfiles || supaRest('profiles', { filters: 'order=created_at' }),
      supaRest('picks', { select: 'user_id' }),
    ]);

    // Count picks per user
    const pickCounts: Record<string, number> = {};
    allPicks.forEach((p: any) => { pickCounts[p.user_id] = (pickCounts[p.user_id] || 0) + 1; });

    profiles = allProfiles
      .filter((p: any) => p.is_active !== false)
      .map((p: any) => ({ ...p, role: getPelotonRole(p, pickCounts[p.id] || 0) }));
    pelotonLoaded = true;
  }

  async function toggleAdmin(userId: string, makeAdmin: boolean) {
    try {
      await supaPatch('profiles', `id=eq.${userId}`, { is_admin: makeAdmin });
      loadPeloton();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function loadParticipants() {
    if (!appState.activeCompId) {
      participantsMsg = 'Geen ronde geselecteerd';
      stageGroups = [];
      return;
    }
    // Comp-guard: bij ronde-wissel tijdens de fetch mag een oudere run de
    // nieuwe ronde niet overschrijven (zelfde patroon als Dashboard)
    const loadCompId = appState.activeCompId;

    // Fetch public picks (view only shows locked/past-deadline stages) — cached
    let allPicks: any[];
    if (appState._cache.participantsCompId === appState.activeCompId && appState._cache.participants) {
      allPicks = appState._cache.participants;
    } else {
      allPicks = await supaRest('stage_picks_public', {
        filters: `competition_id=eq.${appState.activeCompId}&order=stage_number.desc,display_name`,
      });
      appState._cache.participants = allPicks;
      appState._cache.participantsCompId = appState.activeCompId;
    }

    if (!allPicks.length) {
      participantsMsg = 'Nog geen keuzes zichtbaar. Keuzes worden getoond na de deadline.';
      stageGroups = [];
      return;
    }

    // Winnaar per etappe: gebruik winner_name uit stage_picks_public (= stages.winner_name)
    // of val terug op finish_position=1 uit stage_results
    const lockedStageIds = [...new Set(allPicks.map((p: any) => p.stage_id))];
    const stageWinners: Record<number, { name: string; time: number }> = {};

    // Eerst: stage.winner_name via allPicks (stage_picks_public bevat winner_name)
    for (const p of allPicks) {
      if (p.winner_name && !stageWinners[p.stage_id]) {
        const stg = appState.stages.find((s: any) => s.id === p.stage_id);
        stageWinners[p.stage_id] = { name: p.winner_name, time: stg?.winner_time_seconds || 0 };
      }
    }

    // Fallback: finish_position=1 uit stage_results voor etappes zonder winner_name
    const missingWinnerStageIds = lockedStageIds.filter(id => !stageWinners[id]);
    if (missingWinnerStageIds.length) {
      const winnerResults = await supaRest('stage_results', {
        select: 'stage_id,rider_id,time_seconds,finish_position',
        filters: `stage_id=in.(${missingWinnerStageIds.join(',')})&finish_position=eq.1`,
      });
      for (const w of winnerResults) {
        const rider = appState._riderMap[w.rider_id];
        stageWinners[w.stage_id] = { name: rider?.name || '?', time: w.time_seconds };
      }
    }

    // Group by stage
    const byStage: Record<number, { picks: any[]; stage_id: number }> = {};
    allPicks.forEach((p: any) => {
      if (!byStage[p.stage_number]) byStage[p.stage_number] = { picks: [], stage_id: p.stage_id };
      byStage[p.stage_number].picks.push(p);
    });

    const stageNums = Object.keys(byStage).map(Number).sort((a, b) => b - a);

    const classic = activeScoringMode() === 'classic';

    if (appState.activeCompId !== loadCompId) return; // ronde gewisseld — nieuwere load rendert

    stageGroups = stageNums.map(num => {
      const { picks } = byStage[num];
      const partComp = appState.competitions.find((c: any) => c.id === appState.activeCompId);
      const partStage = appState.stages.find((s: any) => s.competition_id === appState.activeCompId && s.stage_number === num);
      const pcsUrl = buildPcsStageUrl(partComp, num, partStage);
      const newsUrl = buildStageNewsUrl(partComp, num, partStage);
      const stageId = byStage[num].stage_id;
      const winner = stageWinners[stageId] || null;
      const enriched = picks.map((p: any) => {
        const stg = appState.stages.find((s: any) => s.id === p.stage_id);
        const isLocked = stg?.locked;
        const sharingPct = p.num_pickers <= 1 ? 100 : p.num_pickers === 2 ? 80 : p.num_pickers === 3 ? 60 : p.num_pickers === 4 ? 40 : 20;
        const showPickersBadge = classic && isLocked && p.num_pickers > 1;
        // Voorberekende cel-teksten (identiek aan de template-literals in peloton.ts)
        const timeCell = p.finish_position === 1
          ? formatTime(p.time_seconds)
          : (p.dnf || p.is_late)
            ? (p.dnf_penalty_gap != null ? formatGap(p.dnf_penalty_gap) : '-')
            : (p.time_gap != null ? formatGap(p.time_gap) : '-');
        const bonifCell = p.bonification ? '-' + p.bonification + 's' : '-';
        const ptsCell = p.effective_points != null ? p.effective_points : (p.points != null ? (p.is_late ? '0' : p.points) : '-');
        const bergCell = p.effective_mountain_points != null ? p.effective_mountain_points : (p.mountain_points != null ? (p.is_late ? '0' : p.mountain_points) : '-');
        return { ...p, sharingPct, showPickersBadge, timeCell, bonifCell, ptsCell, bergCell };
      });
      return { num, pcsUrl, newsUrl, winner, picks: enriched };
    });
    isClassic = classic;
    participantsMsg = null;
  }

  // Herladen bij mount en als de actieve ronde / caches wijzigen
  // (synchrone reads aan het begin van de load-functies zijn de dependencies).
  $effect(() => { loadParticipants(); });
  $effect(() => { loadPeloton(); });
</script>

<div class="tab-section active" id="section-participants">
  <div id="participants-content">
    {#if participantsMsg}
      <p class="text-muted">{participantsMsg}</p>
    {:else}
      {#each stageGroups as group}
        <div class="card mb-3">
          <div class="card-header d-flex align-items-center flex-wrap">
            <h6 class="mb-0">Etappe {group.num}{#if group.pcsUrl}{' '}<a href={group.pcsUrl} target="_blank" rel="noopener" class="pcs-link" title="Bekijk op PCS">PCS ↗</a>{/if}{#if group.newsUrl}{' '}<a href={group.newsUrl} target="_blank" rel="noopener" class="pcs-link" title="Nieuws over deze etappe">Nieuws ↗</a>{/if}</h6>{#if group.winner}<span style="font-size:0.75rem; color:var(--text-muted); font-weight:400; margin-left:0.5rem;">{@html icon('trophy', '', 12)} {group.winner.name} — {formatTime(group.winner.time)}</span>{/if}
          </div>
          <div class="card-body p-0">
            <table class="table table-sm mb-0 results-table">
              <thead>
                {#if isClassic}
                  <tr><th>Speler</th><th>Renner</th><th class="text-end col-num">Positie</th><th class="text-end col-num"><span class="info-tooltip" data-tip="Spelpunten op basis van positie, na deelpenalty">Spel &#9432;</span></th><th class="col-status">Status</th></tr>
                {:else}
                  <tr><th>Speler</th><th>Renner</th><th class="text-end col-time"><span class="info-tooltip" data-tip="Tijdsverschil met etappewinnaar">Verschil &#9432;</span></th><th class="text-end col-num"><span class="info-tooltip" data-tip="Bonificatieseconden uit PCS (finish + tussensprints), worden van AK-tijd afgetrokken">Bonif. &#9432;</span></th><th class="text-end col-num"><span class="info-tooltip" data-tip="Sprintpunten uit puntenklassement">Pts &#9432;</span></th><th class="text-end col-num"><span class="info-tooltip" data-tip="Bergpunten (KOM)">Berg &#9432;</span></th><th class="col-status">Status</th></tr>
                {/if}
              </thead>
              <tbody>
                {#each group.picks as p}
                  {@const isWinner = p.finish_position === 1 && !p.dnf}
                  {#if isClassic}
                    <tr class={isWinner ? 'winner-row' : undefined}>
                      <td><span class="player-click" role="button" tabindex="0" onclick={() => (ui.playerModalId = p.user_id)} onkeydown={(e) => { if (e.key === 'Enter') ui.playerModalId = p.user_id; }}>{p.display_name}</span></td>
                      <td><div class="rider-cell">{@html riderDisplay(p.rider_name, riderPhoto(p.rider_id), p.rider_id)} <span class="team-badge-sm">{@html teamBadge(p.rider_team)}</span>{#if p.showPickersBadge}<span class="badge bg-secondary" style="font-size:0.6rem;">{p.num_pickers}x → {p.sharingPct}%</span>{/if}</div></td>
                      <td class="text-end tnum">{p.finish_position || '-'}</td>
                      <td class="text-end tnum">{p.effective_game_points != null ? p.effective_game_points : '-'}</td>
                      <td class="col-status">{#if p.is_late}<span class="badge bg-warning">Te laat</span>{/if}{#if p.is_random}<span class="badge bg-info">{@html icon('wheel', '', 11)} Rad</span>{/if}{#if p.dnf}<span class="badge bg-danger">DNF</span>{/if}</td>
                    </tr>
                  {:else}
                    <tr class={isWinner ? 'winner-row' : undefined}>
                      <td><span class="player-click" role="button" tabindex="0" onclick={() => (ui.playerModalId = p.user_id)} onkeydown={(e) => { if (e.key === 'Enter') ui.playerModalId = p.user_id; }}>{p.display_name}</span></td>
                      <td><div class="rider-cell">{@html riderDisplay(p.rider_name, null, p.rider_id)} <span class="team-badge-sm">{@html teamBadge(p.rider_team)}</span>{#if p.showPickersBadge}<span class="badge bg-secondary" style="font-size:0.6rem;">{p.num_pickers}x → {p.sharingPct}%</span>{/if}</div></td>
                      <td class="time text-end">{p.timeCell}</td>
                      <td class="text-end tnum">{p.bonifCell}</td>
                      <td class="text-end tnum">{p.ptsCell}</td>
                      <td class="text-end tnum">{p.bergCell}</td>
                      <td class="col-status">{#if p.is_late}<span class="badge bg-warning">Te laat</span>{/if}{#if p.is_random}<span class="badge bg-info">{@html icon('wheel', '', 11)} Rad</span>{/if}{#if p.dnf}<span class="badge bg-danger">DNF</span>{/if}</td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Peloton: alle gebruikers -->
  <div class="card mb-3">
    <div class="card-header"><h5 class="mb-0">Het Peloton</h5></div>
    <div class="card-body p-0 table-responsive-wrapper">
      <table class="table table-sm table-striped mb-0 results-table">
        <thead>
          <tr>
            <th>Naam</th>
            {#if isAdmin}<th id="peloton-email-col">Email</th>{/if}
            <th class="d-none d-md-table-cell" style="width:9rem;">Rol</th>
            <th class="d-none d-md-table-cell" style="width:7rem;">Lid sinds</th>
            <th class="d-none d-md-table-cell" style="width:8.5rem;">Laatst gezien</th>
            {#if isAdmin}<th id="peloton-actions-col" style="width:7.5rem;">Acties</th>{/if}
          </tr>
        </thead>
        <tbody id="peloton-table">
          {#if pelotonLoaded && !profiles.length}
            <tr><td colspan="5" class="text-muted">Nog geen renners in het peloton</td></tr>
          {:else}
            {#each profiles as p}
              <tr>
                <td>
                  <div class="d-flex align-items-center gap-2">
                    {@html avatarHtml(p.display_name, appState._avatarMap[p.display_name], 'sm')}
                    <div style="min-width:0;">
                      <div class="d-flex align-items-center gap-2">
                        <span class="player-click" role="button" tabindex="0" onclick={() => (ui.playerModalId = p.id)} onkeydown={(e) => { if (e.key === 'Enter') ui.playerModalId = p.id; }}>{p.display_name}</span>
                        <span class="badge {p.role.badge} d-md-none" style="font-size:0.65rem;">{@html p.role.icon} {p.role.name}</span>
                      </div>
                      {#if p.favorite_team || p.cycling_hero}
                        <div class="d-flex align-items-center gap-2 mt-1">
                          {#if p.favorite_team}{@html teamBadge(p.favorite_team)}{/if}
                          {#if p.cycling_hero}<span style="font-size:0.7rem;color:var(--text-muted);">{p.cycling_hero}</span>{/if}
                        </div>
                      {/if}
                      {#if p.motto}<div style="font-size:0.7rem;color:var(--text-muted);font-style:italic;">"{p.motto}"</div>{/if}
                    </div>
                  </div>
                </td>
                {#if isAdmin}<td class="cell-dim">{p.email || '-'}</td>{/if}
                <td class="d-none d-md-table-cell"><span class="badge {p.role.badge}">{@html p.role.icon} {p.role.name}</span></td>
                <td class="d-none d-md-table-cell cell-dim">{new Date(p.created_at).toLocaleDateString('nl-NL')}</td>
                <td class="d-none d-md-table-cell cell-dim">{p.last_seen_at ? new Date(p.last_seen_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                {#if isAdmin}
                  <td>
                    <button class="btn btn-sm btn-outline-{p.is_admin ? 'secondary' : 'danger'}" onclick={() => toggleAdmin(p.id, !p.is_admin)}>
                      {p.is_admin ? 'Degradeer' : 'Promoveer'}
                    </button>
                  </td>
                {/if}
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
