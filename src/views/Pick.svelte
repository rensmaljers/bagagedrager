<script lang="ts">
  // Kies-renner-view — port van public/views/pick.ts + #section-pick uit index.html.
  // Gedrag 1-op-1; DOM-manipulatie vervangen door runes/derived markup.
  // LET OP: alias verplicht — een lokale binding met de naam `state` schaduwt
  // de $state-rune (compiler leest $state dan als store-subscription).
  import { state as appState } from '../lib/state.svelte';
  import { formatDeadline, riderDisplay, toast, confettiBurst } from '../lib/utils';
  import { icon } from '../lib/icons';
  import { supaRest, supaRpc } from '../lib/api';
  import { activeStages, buildPcsStageUrl, buildStageNewsUrl, riderPhoto, teamBadge } from '../lib/helpers';

  const typeLabels: Record<string, string> = { flat: '→', mountain: '▲', tt: '⏱', ttt: '⏱', sprint: '⚡', hills: '~' };
  const STAGE_TYPES: Record<string, { label: string; icon: string }> = {
    flat: { label: 'Vlak', icon: 'bike' },
    sprint: { label: 'Sprint', icon: 'zap' },
    hills: { label: 'Heuvels', icon: 'chart' },
    mountain: { label: 'Bergrit', icon: 'mountain' },
    tt: { label: 'Tijdrit', icon: 'clock' },
    ttt: { label: 'Ploegentijdrit', icon: 'users' },
  };
  // Tijdslimiet = aankomst + rittijd × percentage (vereenvoudigd UCI/ASO-reglement)
  const TIME_LIMIT_PCT: Record<string, number> = { flat: 0.07, sprint: 0.07, hills: 0.11, mountain: 0.15 };
  const SPEC_BY_TYPE: Record<string, { field: string; label: string }> = {
    mountain: { field: 'specialty_climber', label: 'Klim' },
    hills: { field: 'specialty_hills', label: 'Heuvel' },
    sprint: { field: 'specialty_sprint', label: 'Sprint' },
    flat: { field: 'specialty_sprint', label: 'Sprint' },
    tt: { field: 'specialty_tt', label: 'Tijdrit' },
    ttt: { field: 'specialty_tt', label: 'Tijdrit' },
  };

  // --- UI-state ---
  let selectedStageId = $state<number | null>(null);
  let searchInput = $state('');
  let search = $state('');           // gedebounced (150ms, zoals vanilla)
  let teamFilter = $state('');
  let nationalityFilter = $state('');
  let hideUsed = $state(false);
  let filterOpen = $state(false);
  let activeVisualKind = $state<string | null>(null);
  let routeActivated = $state(false); // iframe-src pas zetten bij eerste activatie (lazy)
  let expandedVisuals = $state<Record<string, boolean>>({});
  let pickStatus = $state({ text: '', cls: 'ms-3 text-muted' });
  let countdownText = $state('');
  let countdownClass = $state('pick-bar-countdown');
  let othersPicks = $state<any[]>([]);
  let adminPreview = $state(false);
  let showOthers = $state(false);
  let othersRefresh = $state(0);

  // --- Deriveds ---
  const compStages = $derived(activeStages());
  const stage = $derived(appState.stages.find((s: any) => s.id === selectedStageId));
  const stageIdx = $derived(compStages.findIndex((s: any) => s.id === selectedStageId));
  const isLocked = $derived(!!stage && (stage.locked || new Date() > new Date(stage.deadline)));
  const comp = $derived(stage ? appState.competitions.find((c: any) => c.id === stage.competition_id) : null);
  const pcsStageUrl = $derived(stage ? buildPcsStageUrl(comp, stage.stage_number, stage) : null);
  const newsUrl = $derived(stage ? buildStageNewsUrl(comp, stage.stage_number, stage) : null);
  const pickStageLabel = $derived(stage ? (stage.stage_number === 0 ? 'Proloog' : `Etappe ${stage.stage_number}`) : '');

  const stageDetails = $derived.by(() => {
    if (!stage) return '';
    return [
      `Start: ${formatDeadline(stage.start_time || stage.deadline)}`,
      stage.distance_km ? `${stage.distance_km} km` : null,
      stage.departure && stage.arrival ? `${stage.departure} → ${stage.arrival}` : null,
      isLocked ? '(VERGRENDELD)' : null,
    ].filter(Boolean).join(' · ');
  });

  // Stats-strip in letour-stijl: Afstand / Type / Hoogtemeters / Aankomst / Tijdslimiet
  const stageStats = $derived.by(() => {
    if (!stage) return [];
    const typeInfo = STAGE_TYPES[stage.stage_type];
    let arrivalStat: any = null, limitStat: any = null;
    const endTs = stage.estimated_end_time ? new Date(stage.estimated_end_time).getTime() : 0;
    const startTs = stage.start_time ? new Date(stage.start_time).getTime() : 0;
    if (endTs && startTs && endTs > startTs) {
      const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
      arrivalStat = { icon: 'clock', label: 'Aankomst (verw.)', value: `± ${fmtTime(endTs)}` };
      const pct = TIME_LIMIT_PCT[stage.stage_type];
      if (pct) {
        const limitTs = endTs + (endTs - startTs) * pct;
        limitStat = {
          icon: 'lock', label: 'Tijdslimiet', value: `± ${fmtTime(limitTs)}`,
          tip: `Eigen schatting: verwachte aankomst + rittijd × ${Math.round(pct * 100)}% (vlak 7%, heuvels 11%, berg 15%).\nDe officiële ASO-coëfficiënt hangt af van het winnaarsgemiddelde — bij bergritten varieert die van 10% tot 18%.`,
        };
      }
    }
    return [
      stage.distance_km ? { icon: 'flag', label: 'Afstand', value: `${stage.distance_km} km` } : null,
      typeInfo ? { icon: typeInfo.icon, label: 'Type', value: typeInfo.label } : null,
      stage.vertical_meters ? { icon: 'mountain', label: 'Hoogtemeters', value: `${stage.vertical_meters} m` } : null,
      arrivalStat,
      limitStat,
    ].filter(Boolean);
  });

  // Extra race-info badges (HTML-strings, zoals vanilla — profile_score bevat een title-attribuut)
  const infoBadges = $derived.by(() => {
    if (!stage) return [];
    return [
      stage.profile_score ? `<span title="PCS ProfileScore: hoe zwaar het parcours weegt (hoger = zwaarder)">Zwaarte: ${stage.profile_score}</span>` : null,
      stage.classification || null,
      stage.parcours_type || null,
      stage.avg_speed_winner && stage.avg_speed_winner !== '-' ? `Gem: ${stage.avg_speed_winner} km/u` : null,
      stage.avg_temperature && stage.avg_temperature !== '-' ? `${stage.avg_temperature}` : null,
    ].filter(Boolean) as string[];
  });

  // Etappe-visuals: officiële ASO-afbeeldingen (profiel + kaart + interactieve route)
  // hebben voorrang, PCS-profiel is fallback. Meerdere visuals → toggle-chips.
  const visuals = $derived.by(() => {
    if (!stage) return [] as { kind: string; label: string; src: string; fb?: string }[];
    const list: { kind: string; label: string; src: string; fb?: string }[] = [];
    const profileSrc = stage.official_profile_image_url || stage.profile_image_url;
    if (profileSrc) {
      list.push({
        kind: 'profile', label: 'Profiel', src: profileSrc,
        // onerror: officieel profiel → val terug op PCS; anders afbeelding weg
        fb: stage.official_profile_image_url && stage.profile_image_url ? stage.profile_image_url : undefined,
      });
    }
    if (stage.route_map_url) list.push({ kind: 'map', label: 'Kaart', src: stage.route_map_url });
    if (stage.interactive_map_url) list.push({ kind: 'route', label: 'Interactief', src: stage.interactive_map_url });
    return list;
  });
  const effectiveVisualKind = $derived(
    activeVisualKind && visuals.some(v => v.kind === activeVisualKind) ? activeVisualKind : (visuals[0]?.kind ?? null)
  );

  const currentPick = $derived(appState.myPicks.find((p: any) => p.stage_id === selectedStageId));
  const compStageIds = $derived(new Set(compStages.map((s: any) => s.id)));
  const usedInOtherStages = $derived(new Set(
    appState.myPicks
      .filter((p: any) => p.stage_id !== selectedStageId && compStageIds.has(p.stage_id))
      .map((p: any) => p.rider_id)
  ));

  // Bij klassiekers: filter op de startlijst van deze specifieke etappe
  const stageRiderList = $derived.by(() => {
    const set = selectedStageId != null ? appState.stageRiders[selectedStageId] : null;
    return (set && set.size > 0) ? appState.riders.filter((r: any) => set.has(r.id)) : appState.riders;
  });

  const teamOptions = $derived([...new Set(stageRiderList.map((r: any) => r.team))].sort());
  const nationalityOptions = $derived([...new Set(stageRiderList.map((r: any) => r.nationality).filter(Boolean))].sort());

  const filteredRiders = $derived.by(() => {
    const q = search.toLowerCase();
    return stageRiderList.filter((r: any) =>
      (r.name.toLowerCase().includes(q) || r.team.toLowerCase().includes(q)) &&
      (!teamFilter || r.team === teamFilter) &&
      (!nationalityFilter || r.nationality === nationalityFilter) &&
      (!hideUsed || (!usedInOtherStages.has(r.id) && !appState.dnfRiderIds.has(r.id)))
    );
  });

  // Pick-hulp: match tussen rittype en renner-specialty (PCS careerpunten per
  // discipline). Score = punten t.o.v. de beste van de startlijst — chip bij
  // ≥25%, sterk (accent) bij ≥60%.
  const spec = $derived(stage ? SPEC_BY_TYPE[stage.stage_type] : undefined);
  const specMax = $derived(spec ? Math.max(0, ...stageRiderList.map((r: any) => r[spec.field] || 0)) : 0);

  function matchPct(r: any): number {
    return (spec && specMax > 0) ? Math.round(((r[spec.field] || 0) / specMax) * 100) : 0;
  }
  function matchChipHtml(r: any): string {
    const pct = matchPct(r);
    if (pct < 25) return '';
    return `<span class="match-chip ${pct >= 60 ? 'strong' : ''}" title="${spec!.label}-score: ${pct}% van de beste van de startlijst (PCS-punten per specialiteit)">${spec!.label} ${pct}</span>`;
  }
  function riderSpecsHtml(r: any): string {
    const chip = matchChipHtml(r);
    if (!r.nationality && !chip) return '';
    return [
      chip || null,
      r.nationality || null,
      r.weight_kg ? `${r.weight_kg}kg` : null,
    ].filter(Boolean).join(' ');
  }

  // Renners gegroepeerd per team; binnen elk team beste specialty-match eerst
  const teamGroups = $derived.by(() => {
    const grouped: Record<string, any[]> = {};
    for (const r of filteredRiders) {
      if (!grouped[r.team]) grouped[r.team] = [];
      grouped[r.team].push(r);
    }
    const teamNames = Object.keys(grouped).sort();
    if (spec && specMax > 0) {
      for (const t of teamNames) grouped[t].sort((a, b) => (b[spec.field] || 0) - (a[spec.field] || 0));
    }
    return teamNames.map(team => ({ team, riders: grouped[team] }));
  });

  // Beschikbaarheids-teller
  const availability = $derived.by(() => {
    const total = stageRiderList.length;
    const dnf = stageRiderList.filter((r: any) => appState.dnfRiderIds.has(r.id)).length;
    const used = stageRiderList.filter((r: any) => usedInOtherStages.has(r.id) && !appState.dnfRiderIds.has(r.id)).length;
    return { total, dnf, used, available: total - used - dnf };
  });

  // Pick-bar
  const selectedRider = $derived(appState.selectedRiderId ? appState._riderMap[appState.selectedRiderId] : null);
  const showPickBar = $derived(!!selectedRider || !!currentPick);
  const isChangedPick = $derived(!!selectedRider && !!currentPick && selectedRider.id !== currentPick.rider_id);
  const pickBarUnconfirmed = $derived((!!selectedRider && !currentPick) || isChangedPick);
  const pickBarStatus = $derived(currentPick && selectedRider && selectedRider.id === currentPick.rider_id ? '✓ Bevestigd' : '⚠ Nog niet bevestigd');
  const replacesRider = $derived(isChangedPick ? appState._riderMap[currentPick.rider_id] : null);
  const submitDisabled = $derived(!appState.selectedRiderId || isLocked);

  // Bevestigde keuze blijft zichtbaar in de grid, ook als een andere renner geselecteerd is
  const currentPickRiderId = $derived(currentPick?.rider_id ?? null);

  // --- Acties ---
  function selectStage(id: number | null) {
    selectedStageId = id;
    const cp = id != null ? appState.myPicks.find((p: any) => p.stage_id === id) : null;
    appState.selectedRiderId = cp?.rider_id || null;
    // Dropdowns herladen bij etappewissel (klassiekers hebben andere renners per etappe)
    teamFilter = '';
    nationalityFilter = '';
    activeVisualKind = null;
    routeActivated = false;
    expandedVisuals = {};
  }

  function navigateStage(dir: number) {
    const next = stageIdx + dir;
    if (next >= 0 && next < compStages.length) selectStage(compStages[next].id);
  }

  function selectVisual(kind: string) {
    activeVisualKind = kind;
    if (kind === 'route') routeActivated = true;
  }

  function toggleExpanded(kind: string) {
    expandedVisuals[kind] = !expandedVisuals[kind];
  }

  // img-onerror: officieel profiel → PCS-fallback → verbergen
  function visualImgError(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    if (img.dataset.fb) { img.src = img.dataset.fb; delete img.dataset.fb; }
    else img.hidden = true;
  }
  function hidePhoto(e: Event) {
    (e.currentTarget as HTMLElement).style.display = 'none';
  }

  function selectRider(riderId: number) {
    appState.selectedRiderId = riderId;
  }

  let searchTimer: any;
  function onSearchInput(e: Event) {
    searchInput = (e.currentTarget as HTMLInputElement).value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { search = searchInput; }, 150);
  }

  function toggleFilterPanel() {
    filterOpen = !filterOpen;
  }

  // Submit pick via Postgres RPC
  async function submitPick() {
    if (!appState.selectedRiderId || selectedStageId == null) return;
    const stageId = selectedStageId;
    try {
      pickStatus = { text: 'Bezig...', cls: 'ms-3 text-muted' };
      const result = await supaRpc('submit_pick', { p_stage_id: stageId, p_rider_id: appState.selectedRiderId });
      pickStatus = { text: result.warning || 'Keuze opgeslagen!', cls: result.warning ? 'ms-3 text-warning' : 'ms-3 text-success' };
      if (!result.warning) { confettiBurst(); toast('Keuze bevestigd!', 'success'); }
      appState.myPicks = await supaRest('picks', { filters: `user_id=eq.${appState.session.user.id}&order=stage_id` });
      appState._cache.standings = null; appState._cache.participants = null;
      // renderPickStage-equivalent: selectie terug naar de (nieuwe) bevestigde keuze
      const cp = appState.myPicks.find((p: any) => p.stage_id === stageId);
      appState.selectedRiderId = cp?.rider_id || null;
      othersRefresh++;
    } catch (e: any) {
      pickStatus = { text: e.message, cls: 'ms-3 text-danger' };
    }
  }

  // --- Init bij mount: eerstvolgende niet-vergrendelde etappe ---
  {
    const cs = activeStages();
    const next = cs.find((s: any) => !s.locked) || cs[0];
    if (next) selectStage(next.id);
  }

  // Ronde-wissel terwijl de tab open staat → herselecteer eerstvolgende etappe
  let _compId = appState.activeCompId;
  $effect(() => {
    const cid = appState.activeCompId;
    if (cid !== _compId) {
      _compId = cid;
      const cs = activeStages();
      const next = cs.find((s: any) => !s.locked) || cs[0];
      selectStage(next?.id ?? null);
    }
  });

  // Picks van anderen (na deadline) + admin-voorvertoning ervóór
  $effect(() => {
    const stageId = selectedStageId;
    const locked = isLocked;
    void othersRefresh; // her-laden na submit
    const isAdmin = !!appState.profile?.is_admin;
    if (stageId == null || !stage || (!locked && !isAdmin)) { showOthers = false; return; }
    let cancelled = false;
    (async () => {
      let stagePicks: any[];
      let preview = false;
      if (!locked) {
        // Admin-voorvertoning vóór de deadline: alléén AI-picks (met renner) en
        // wie nog geen keuze heeft — menselijke keuzes blijven verborgen (fair play).
        preview = true;
        const [rawPicks, participants] = await Promise.all([
          supaRest('picks', { filters: `stage_id=eq.${stageId}`, select: 'user_id,rider_id,is_random' }),
          supaRest('competition_participants', { filters: `competition_id=eq.${appState.activeCompId}`, select: 'user_id' }),
        ]);
        const profileById = new Map<string, any>((appState._cache.allProfiles || []).map((p: any) => [p.id, p]));
        const pickedIds = new Set((rawPicks || []).map((p: any) => p.user_id));
        const aiPicks = (rawPicks || [])
          .filter((p: any) => profileById.get(p.user_id)?.is_ai)
          .map((p: any) => ({
            ...p,
            display_name: profileById.get(p.user_id)?.display_name || '?',
            rider_name: appState._riderMap[p.rider_id]?.name || '?',
            rider_team: appState._riderMap[p.rider_id]?.team || '',
          }));
        const missing = (participants || [])
          .filter((p: any) => !pickedIds.has(p.user_id))
          .map((p: any) => ({
            user_id: p.user_id,
            display_name: profileById.get(p.user_id)?.display_name || '?',
            rider_name: null, rider_team: '', is_random: false,
          }));
        stagePicks = [...aiPicks, ...missing].sort((a, b) => a.display_name.localeCompare(b.display_name));
      } else if (appState._cache.participantsCompId === appState.activeCompId && appState._cache.participants) {
        stagePicks = appState._cache.participants.filter((p: any) => p.stage_id === stageId);
      } else {
        stagePicks = await supaRest('stage_picks_public', {
          filters: `stage_id=eq.${stageId}&order=display_name`,
        });
      }
      if (cancelled) return;
      adminPreview = preview;
      othersPicks = stagePicks || [];
      showOthers = (stagePicks || []).length > 0;
    })();
    return () => { cancelled = true; };
  });

  // Countdown in de pick-bar — interval netjes opruimen in de $effect-cleanup
  $effect(() => {
    const st = stage;
    if (!showPickBar || !st) return;
    const locked = st.locked || new Date() > new Date(st.deadline);
    if (locked) {
      countdownText = '🔒 Etappe gestart';
      countdownClass = 'pick-bar-countdown';
      return;
    }
    let iv: any = null;
    const updateCountdown = () => {
      const deadline = new Date(st.start_time || st.deadline).getTime();
      const diff = deadline - Date.now();
      if (diff <= 0) {
        countdownText = '🔒 Etappe gestart';
        countdownClass = 'pick-bar-countdown urgent';
        if (iv) clearInterval(iv);
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const parts: string[] = [];
      if (d > 0) parts.push(`${d}d`);
      parts.push(`${h}u ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`);
      countdownText = `⏱ Nog ${parts.join(' ')} tot start`;
      countdownClass = diff < 3600000 ? 'pick-bar-countdown urgent' : 'pick-bar-countdown';
    };
    updateCountdown();
    iv = setInterval(updateCountdown, 1000);
    return () => clearInterval(iv);
  });

  // Zoek-debounce opruimen bij unmount
  $effect(() => () => clearTimeout(searchTimer));
</script>

<div class="tab-section active" id="section-pick">
  <!-- Etappe-hero: nav-balk boven, koersbord-titel, schuine stat-tegels, visual volle breedte -->
  <div class="card mb-3">
    <div class="stage-hero-nav">
      <button id="btn-prev-stage" class="btn btn-sm btn-outline-secondary stage-nav-btn" title="Vorige etappe" disabled={stageIdx <= 0} onclick={() => navigateStage(-1)}>&lsaquo;</button>
      <select id="stage-select" class="form-select form-select-sm" bind:value={selectedStageId} onchange={() => selectStage(selectedStageId)}>
        {#each compStages as s}
          {@const optLocked = s.locked || new Date() > new Date(s.deadline)}
          <option value={s.id}>{optLocked ? '🔒 ' : ''}{typeLabels[s.stage_type] || ''} {s.stage_number === 0 ? 'Proloog' : `Etappe ${s.stage_number}`}: {s.name}</option>
        {/each}
      </select>
      <button id="btn-next-stage" class="btn btn-sm btn-outline-secondary stage-nav-btn" title="Volgende etappe" disabled={stageIdx === -1 || stageIdx === compStages.length - 1} onclick={() => navigateStage(1)}>&rsaquo;</button>
    </div>
    <div class="card-body">
      <div class="stage-hero-head">
        <div style="min-width:0;">
          <div class="stage-eyebrow">
            <span class="stage-eyebrow-chip"><span>{stage ? pickStageLabel : 'Kies een etappe'}</span></span>
            {#each infoBadges as b}<span class="stage-info-badge">{@html b}</span>{/each}
          </div>
          <h4 id="pick-stage-name" class="stage-hero-title">{stage ? stage.name : ''}</h4>
          <span id="pick-deadline" class="stage-hero-sub">{stageDetails}</span>
          {#if pcsStageUrl || newsUrl}
            <div class="stage-hero-links">
              {#if pcsStageUrl}<a href={pcsStageUrl} target="_blank" rel="noopener" class="stage-link-chip" title="Uitslag en startlijst op ProCyclingStats">PCS ↗</a>{/if}
              {#if newsUrl}<a href={newsUrl} target="_blank" rel="noopener" class="stage-link-chip" title="Nieuws over deze etappe">Nieuws ↗</a>{/if}
            </div>
          {/if}
        </div>
      </div>
      <div id="pick-stage-stats">
        {#if stageStats.length}
          <div class="stage-stats">
            {#each stageStats as s}
              <div class="stage-stat">
                <span class="stage-stat-icon">{@html icon(s.icon, '', 18)}</span>
                <span class="stage-stat-body"><span class="stage-stat-label">{s.label}{#if s.tip} <span class="info-tooltip" data-tip={s.tip}>&#9432;</span>{/if}</span><span class="stage-stat-value tnum">{s.value}</span></span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
      <div id="pick-stage-profile">
        {#if visuals.length > 1}
          <div class="stage-visual-tabs">
            {#each visuals as v}
              <button type="button" class="stage-visual-tab {effectiveVisualKind === v.kind ? 'active' : ''}" data-kind={v.kind} onclick={() => selectVisual(v.kind)}>{v.label}</button>
            {/each}
          </div>
        {/if}
        {#each visuals as v (`${stage?.id}-${v.kind}`)}
          {#if v.kind === 'route'}
            <!-- Interactieve kaart lazy: iframe-src pas zetten bij eerste activatie -->
            <div class="stage-route-frame" data-kind="route" hidden={effectiveVisualKind !== 'route'}><iframe src={routeActivated ? v.src : undefined} data-src={v.src} title="Interactieve routekaart" loading="lazy" allowfullscreen allow="geolocation"></iframe></div>
          {:else}
            <!-- role=button mag niet op <img>; style-loze div-wrapper draagt de interactie -->
            <div role="button" tabindex="0" hidden={effectiveVisualKind !== v.kind} aria-label={expandedVisuals[v.kind] ? 'Afbeelding verkleinen' : 'Afbeelding vergroten'} onclick={() => toggleExpanded(v.kind)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(v.kind); } }}>
              <img src={v.src} alt={v.kind === 'map' ? 'Routekaart' : 'Etappeprofiel'} class="stage-profile-img {expandedVisuals[v.kind] ? 'expanded' : ''}" data-kind={v.kind} data-fb={v.fb} onerror={visualImgError}>
            </div>
          {/if}
        {/each}
      </div>
    </div>
  </div>

  {#if isLocked}
    <div id="pick-locked-msg" class="alert alert-warning" style="font-size:0.85rem;">
      {@html icon('lock', '', 14)} Deze etappe is vergrendeld. Je kunt nog wel kiezen, maar krijgt de slechtste tijd + 0 punten (te laat straf).
    </div>
  {/if}

  <!-- Keuzes van anderen (na deadline) + admin-voorvertoning -->
  {#if showOthers}
    <div id="others-picks" class="card mb-3">
      <div class="card-header" style="padding:0.5rem 0.85rem;">
        <h6 class="mb-0" style="font-size:0.85rem;">{@html icon('users', '', 14)} Keuzes van andere spelers</h6>
      </div>
      <div id="others-picks-body" class="card-body p-0">
        {#if adminPreview}
          <div class="others-pick-row" style="color:var(--text-muted);font-size:0.72rem;">Admin-voorvertoning — AI-picks en wie nog geen keuze heeft</div>
        {/if}
        {#each othersPicks as p}
          <div class="others-pick-row{p.user_id === appState.session?.user?.id ? ' fw-bold' : ''}">
            <span>{p.display_name}</span>
            <span>
              {#if p.rider_name}
                {@html riderDisplay(p.rider_name, riderPhoto(p.rider_id), p.rider_id)} {@html teamBadge(p.rider_team)}{#if p.is_random} <span class="badge bg-info" style="font-size:0.6rem;">🎡</span>{/if}
              {:else}
                <span style="color:var(--red);font-size:0.78rem;">nog geen keuze</span>
              {/if}
            </span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Renner beschikbaarheid teller -->
  <div id="rider-availability" class="rider-availability mb-2">
    <span class="avail-stat available">{availability.available} beschikbaar</span>
    <span class="avail-stat used">{availability.used} gebruikt</span>
    {#if availability.dnf}<span class="avail-stat dnf">{availability.dnf} uit koers</span>{/if}
    <span class="avail-stat total">{availability.total} totaal</span>
  </div>

  <div class="mb-3 pick-filters">
    <!-- Rij 1: zoeken + filter toggle (mobiel) -->
    <div class="d-flex gap-2 mb-2">
      <input type="text" id="rider-search" class="form-control" placeholder="Zoek renner..." value={searchInput} oninput={onSearchInput} />
      <button id="filter-toggle" class="btn btn-outline-secondary d-md-none px-3 {filterOpen ? 'active' : ''}" type="button" title="Meer filters" aria-expanded={filterOpen} onclick={toggleFilterPanel}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
      </button>
    </div>
    <!-- Filter panel: ingeklapt op mobiel, altijd zichtbaar op desktop -->
    <div id="filter-panel" class="d-flex gap-2 flex-wrap {filterOpen ? 'open' : ''}">
      <select id="rider-team-filter" class="form-select" style="max-width:220px;" bind:value={teamFilter}>
        <option value="">Alle teams</option>
        {#each teamOptions as t}<option value={t}>{t}</option>{/each}
      </select>
      <select id="rider-nationality-filter" class="form-select" style="max-width:180px;" bind:value={nationalityFilter}>
        <option value="">Alle landen</option>
        {#each nationalityOptions as n}<option value={n}>{n}</option>{/each}
      </select>
      <label class="form-check d-flex align-items-center gap-1 mb-0 ms-1" style="white-space:nowrap;">
        <input type="checkbox" id="rider-hide-used" class="form-check-input" bind:checked={hideUsed}> Verberg gebruikt
      </label>
    </div>
  </div>

  <div id="rider-grid" class="row g-2">
    {#each teamGroups as group}
      <div class="col-12 rider-team-group">
        <div class="team-group-header">{@html teamBadge(group.team)}</div>
        <div class="row g-2">
          {#each group.riders as r (r.id)}
            {@const used = usedInOtherStages.has(r.id)}
            {@const dnf = appState.dnfRiderIds.has(r.id)}
            {@const blocked = used || dnf}
            {@const selected = r.id === appState.selectedRiderId}
            {@const isCurrent = r.id === currentPickRiderId}
            <div class="col-6 col-md-4 col-lg-4">
              <div class="card pick-card {selected ? 'selected' : ''} {isCurrent && !selected ? 'current-pick' : ''} {used ? 'used' : ''} {dnf ? 'used dnf-rider' : ''}"
                   data-rider-id={r.id} role="button" tabindex="0" aria-disabled={isLocked || blocked}
                   onclick={isLocked || blocked ? undefined : () => selectRider(r.id)}
                   onkeydown={isLocked || blocked ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRider(r.id); } }}>
                <div class="card-body py-2 px-3">
                  <div class="d-flex align-items-center gap-2">
                    {#if r.photo_url && r.photo_url !== 'none'}
                      <img src={r.photo_url} class="rider-photo" alt="" loading="lazy" decoding="async" onerror={hidePhoto}>
                    {/if}
                    <div class="flex-grow-1 min-width-0">
                      <div class="d-flex justify-content-between align-items-start">
                        <div class="fw-bold d-flex align-items-center gap-1" style="font-size:0.88rem;"><span class="text-truncate">{r.name}</span>{#if r.pcs_slug}<a href="https://www.procyclingstats.com/rider/{r.pcs_slug}" target="_blank" rel="noopener" class="rider-pcs-icon ms-auto" title="Bekijk op PCS" onclick={(e) => e.stopPropagation()}>↗</a>{/if}</div>
                        <span class="bib-badge">{r.bib_number}</span>
                      </div>
                      {#if riderSpecsHtml(r)}
                        <div class="rider-specs">{@html riderSpecsHtml(r)}</div>
                      {/if}
                      {#if dnf}
                        <small class="text-secondary mt-1 d-block">Uit koers (DNF)</small>
                      {:else if used}
                        <small class="text-danger mt-1 d-block">Al gebruikt</small>
                      {:else if isCurrent}
                        <small class="current-pick-label mt-1 d-block">✓ Huidige keuze</small>
                      {/if}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <div class="col-12"><p class="text-muted text-center py-4">Geen renners gevonden</p></div>
    {/each}
  </div>

  <!-- Sticky pick confirmation bar -->
  {#if showPickBar}
    <div id="pick-bar" class="pick-bar {pickBarUnconfirmed ? 'unconfirmed' : ''}">
      <div class="pick-bar-inner">
        <div class="pick-bar-info">
          <span id="pick-bar-rider" class="pick-bar-rider">
            {#if selectedRider}
              {@html riderDisplay(selectedRider.name, selectedRider.photo_url, selectedRider.id)} #{selectedRider.bib_number} — {pickBarStatus}
            {/if}
          </span>
          <!-- Bij wijziging: op een eigen regel welke bevestigde keuze vervangen wordt -->
          {#if replacesRider}
            <span id="pick-bar-replaces" class="pick-bar-replaces">vervangt {replacesRider.name}</span>
          {/if}
          <span id="pick-bar-countdown" class={countdownClass}>{countdownText}</span>
        </div>
        <div class="pick-bar-actions">
          <button id="btn-submit-pick" class="btn btn-accent" disabled={submitDisabled} onclick={submitPick}><span>Bevestigen</span></button>
          <span id="pick-status" class={pickStatus.cls} style="font-size:0.8rem;">{pickStatus.text}</span>
        </div>
      </div>
    </div>
  {/if}
</div>
