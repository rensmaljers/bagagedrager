<!--
  Renner-detailmodal — app-breed te openen via ui.riderModalId (rider id).
  Renner komt uit appState._riderMap; "gekozen door" uit stage_picks_public
  (deadline-veilig). Specialty-balken zijn ABSOLUTE PCS-careerpunten, per renner
  genormaliseerd op zijn hoogste waarde zodat de profiel-vorm zichtbaar is.
-->
<script lang="ts">
  import { state as appState, ui } from '../lib/state.svelte';
  import { supaRest } from '../lib/api';
  import { teamBadge } from '../lib/helpers';
  import { focusTrap } from '../lib/focus-trap';

  const SPECS = [
    { key: 'specialty_climber', label: 'Klim' },
    { key: 'specialty_sprint', label: 'Sprint' },
    { key: 'specialty_tt', label: 'Tijdrit' },
    { key: 'specialty_hills', label: 'Heuvel' },
    { key: 'specialty_one_day', label: 'Eendags' },
    { key: 'specialty_gc', label: 'GC' },
  ];

  const rider = $derived(ui.riderModalId ? appState._riderMap[ui.riderModalId] || null : null);
  const isDnf = $derived(!!(rider && (rider.dnf || appState.dnfRiderIds.has(rider.id))));
  const hasPhoto = $derived(!!(rider?.photo_url && rider.photo_url !== 'none'));
  const myPick = $derived(rider ? appState.myPicks.find((p: any) => p.rider_id === rider.id) : null);
  const myPickStage = $derived.by(() => {
    if (!myPick) return null;
    const s = appState.stages.find((s: any) => s.id === myPick.stage_id);
    return s ? (s.stage_number === 0 ? 'de proloog' : `etappe ${s.stage_number}`) : null;
  });

  // Profiel-vorm: normaliseer op de hoogste waarde van déze renner (0/null overslaan)
  const specs = $derived.by(() => {
    if (!rider) return [];
    const vals = SPECS
      .map((s) => ({ label: s.label, value: rider[s.key] || 0 }))
      .filter((s) => s.value > 0);
    const max = Math.max(1, ...vals.map((v) => v.value));
    return vals.map((v) => ({ ...v, pct: Math.max(2, Math.round((v.value / max) * 100)), top: v.value === max }));
  });

  function age(dob: string): number {
    const d = new Date(dob);
    const now = new Date();
    let a = now.getFullYear() - d.getFullYear();
    if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
    return a;
  }

  let pickedBy: any[] | null = $state(null);

  function close() { ui.riderModalId = null; }

  function showPlayer(userId: string) {
    // Wissel: renner-modal dicht, speler-modal open
    close();
    ui.playerModalId = userId;
  }

  // "Gekozen door" laden bij openen
  $effect(() => {
    const id = ui.riderModalId;
    if (!id) return;
    pickedBy = null;
    const compId = appState.activeCompId;
    if (!compId) { pickedBy = []; return; }
    supaRest('stage_picks_public', {
      select: 'user_id,display_name,stage_number,is_random',
      filters: `competition_id=eq.${compId}&rider_id=eq.${id}&order=stage_number`,
    })
      .then((rows: any[]) => { if (ui.riderModalId === id) pickedBy = rows || []; })
      .catch(() => { if (ui.riderModalId === id) pickedBy = []; });
  });

  // Escape sluit (deze modal kan boven de speler-modal staan; die checkt hierop)
  $effect(() => {
    if (!ui.riderModalId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

{#if ui.riderModalId}
  <div class="h2h-overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="h2h-modal detail-modal" role="dialog" aria-modal="true" aria-label="Rennerdetails" use:focusTrap>
      <div class="h2h-header">
        <h3>Renner</h3>
        <button class="h2h-close" aria-label="Sluiten" onclick={close}>&times;</button>
      </div>
      {#if rider}
        <div class="rm-head">
          {#if hasPhoto}
            <img class="rm-photo" src={rider.photo_url} alt={rider.name} loading="lazy" decoding="async">
          {/if}
          <div>
            <div class="pm-name">{rider.name}</div>
            <div class="pm-meta">
              {@html teamBadge(rider.team)}
              {#if isDnf}<span class="badge bg-danger">DNF</span>{/if}
              {#if rider.pcs_slug}<a href="https://www.procyclingstats.com/rider/{rider.pcs_slug}" target="_blank" rel="noopener noreferrer" class="pcs-link" title="Bekijk op PCS">PCS ↗</a>{/if}
            </div>
            <div class="rm-facts">
              {#if rider.nationality}<span>{rider.nationality}</span>{/if}
              {#if rider.date_of_birth}<span>{age(rider.date_of_birth)} jaar</span>{/if}
              {#if rider.height_m}<span>{String(rider.height_m).replace('.', ',')} m</span>{/if}
              {#if rider.weight_kg}<span>{rider.weight_kg} kg</span>{/if}
              {#if rider.bib_number}<span>#{rider.bib_number}</span>{/if}
            </div>
          </div>
        </div>

        {#if specs.length}
          <div class="pm-section-label">Specialiteiten <span class="rm-spec-note">PCS-careerpunten</span></div>
          <div>
            {#each specs as s (s.label)}
              <div class="spec-row">
                <span class="spec-label">{s.label}</span>
                <span class="spec-track"><span class="spec-fill{s.top ? ' top' : ''}" style="width:{s.pct}%;"></span></span>
                <span class="spec-val tnum">{s.value}</span>
              </div>
            {/each}
          </div>
        {/if}

        <div class="pm-section-label">Gekozen door</div>
        {#if myPick}
          <div class="rm-my-use">Jij hebt {rider.name} al gebruikt{myPickStage ? ` (${myPickStage})` : ''}.</div>
        {/if}
        {#if pickedBy === null}
          <div class="pm-empty">Laden...</div>
        {:else if !pickedBy.length}
          <div class="pm-empty">Nog door niemand zichtbaar gekozen in deze ronde.</div>
        {:else}
          <div>
            {#each pickedBy as p (p.user_id + '-' + p.stage_number)}
              <div class="pm-pick-row rm-picked-row">
                <span class="pm-pick-stage">{p.stage_number === 0 ? 'Prlg' : `E${p.stage_number}`}</span>
                <span class="player-click" role="button" tabindex="0"
                  onclick={() => showPlayer(p.user_id)}
                  onkeydown={(e) => { if (e.key === 'Enter') showPlayer(p.user_id); }}>{p.display_name}</span>
                <span>{#if p.is_random}<span class="badge bg-info" style="font-size:0.58rem;">Rad</span>{/if}</span>
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        <p class="text-muted">Renner niet gevonden.</p>
      {/if}
    </div>
  </div>
{/if}
