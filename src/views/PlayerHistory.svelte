<!--
  Spelergeschiedenis — eindposities per ronde, gegroepeerd per categorie
  (competitions.category) en per koers (PCS-slug; edities over de jaren onder één
  uitklapbare kop). Gebruikt in de speler-detailmodal (PlayerModal) én als
  "Mijn geschiedenis" op de Account-pagina. Data: general_classification per ronde
  apart opgehaald (PostgREST kapt af op 1000 rijen), DNS uit competition_pot_status.
-->
<script lang="ts">
  import { state as appState } from '../lib/state.svelte';
  import { supaRest } from '../lib/api';

  let { userId, showLabel = true }: { userId: string; showLabel?: boolean } = $props();

  // --- Geschiedenis: eindpositie per klassement per ronde ---
  // Gegroepeerd: categorie (competitions.category) → koers (PCS-slug, edities over
  // de jaren samen, uitklapbaar) → per jaar de uitslag.
  type HistPos = { key: string; label: string; rank: number | null; jersey: string };
  type HistRow = {
    compId: number; name: string; year: number; flag: string; category: string; raceKey: string;
    running: boolean; dns: boolean; count: number; stagesPlayed: number; pos: HistPos[];
  };
  let history: HistRow[] | null = $state(null);

  const CATEGORY_ORDER = [
    { id: 'grote_ronde', label: 'Grote rondes' },
    { id: 'worldtour', label: 'WorldTour' },
    { id: 'klassieker', label: 'Klassiekers' },
    { id: 'vrouwen', label: 'Vrouwenkoersen' },
  ];

  // Zelfde koers over de jaren heen: PCS-slug uit pcs_url ("race/tour-de-france/2026")
  // (ook nieuwe PCS-vorm "race/tour-of-guangxi-2026-gc/…"), anders de naam zonder jaartal
  function raceKeyOf(comp: any): string {
    const seg = (comp.pcs_url || '').match(/race\/([^/?#]+)/)?.[1];
    if (seg) return seg.replace(/-(19|20)\d{2}(-.*)?$/, '');
    return (comp.name || '').toLowerCase().replace(/\b(19|20)\d{2}\b/g, '').trim();
  }

  // Gedeelde positie: 1 + aantal spelers dat strikt beter staat
  const sharedRank = (rows: any[], me: any, better: (a: any, b: any) => boolean) =>
    1 + rows.filter((r) => better(r, me)).length;

  // Stale-guard: alleen de laatste load mag history zetten (userId kan wisselen)
  let loadToken = 0;

  async function loadHistory(id: string) {
    const token = ++loadToken;
    const mine: any[] = await supaRest('general_classification', {
      select: 'competition_id,stages_played', filters: `user_id=eq.${id}`,
    }).catch(() => []);
    const compIds = (mine || []).filter((r) => (r.stages_played || 0) > 0).map((r) => r.competition_id);
    const perComp = await Promise.all(compIds.map((cid: number) => Promise.all([
      supaRest('general_classification', {
        select: 'user_id,stages_played,total_time,total_points,total_mountain_points,total_game_points,total_combativity_points',
        filters: `competition_id=eq.${cid}`,
      }).catch(() => []),
      supaRest('competition_pot_status', { select: 'user_id', filters: `competition_id=eq.${cid}&is_dns=eq.true` }).catch(() => []),
    ])));
    if (token !== loadToken) return;

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
        // Etapperondes: AK / Punten / Berg / Strijd(lust) — zoals op het dashboard
        pos.push({ key: 'gc', label: 'AK', jersey: 'gc', rank: rank((a, b) => a.total_time < b.total_time) });
        pos.push({ key: 'pts', label: 'Punten', jersey: 'points', rank: rank((a, b) => (a.total_points || 0) > (b.total_points || 0)) });
        pos.push({ key: 'mt', label: 'Berg', jersey: 'mountain', rank: rank((a, b) => (a.total_mountain_points || 0) > (b.total_mountain_points || 0)) });
        pos.push({ key: 'cv', label: 'Strijd', jersey: 'game', rank: rank((a, b) => (a.total_combativity_points || 0) > (b.total_combativity_points || 0)) });
      } else {
        pos.push({ key: 'game', label: 'Spel', jersey: 'game', rank: rank((a, b) => (a.total_game_points || 0) > (b.total_game_points || 0)) });
      }
      const compStages = appState.stages.filter((st: any) => st.competition_id === cid);
      out.push({
        compId: cid, name: comp.name, year: comp.year, flag: comp.country_flag || '',
        category: comp.category || 'worldtour', raceKey: raceKeyOf(comp),
        running: !!comp.is_active && compStages.some((st: any) => !st.locked),
        dns, count: active.length, stagesPlayed: me.stages_played || 0, pos,
      });
    });
    history = out;
  }

  const truienIn = (h: HistRow) => (h.running ? 0 : h.pos.filter((p) => p.rank === 1).length);

  // Categorie → koersen (nieuwste editie bepaalt naam/vlag/volgorde) → edities nieuwste eerst
  const historyGroups = $derived.by(() => {
    if (!history) return [];
    return CATEGORY_ORDER.map((cat) => {
      const byRace = new Map<string, HistRow[]>();
      for (const h of history!.filter((x) => x.category === cat.id)) {
        if (!byRace.has(h.raceKey)) byRace.set(h.raceKey, []);
        byRace.get(h.raceKey)!.push(h);
      }
      const races = [...byRace.entries()].map(([key, eds]) => {
        eds.sort((a, b) => b.year - a.year || b.compId - a.compId);
        const latest = eds[0];
        return { key, name: latest.name, flag: latest.flag, editions: eds, truien: eds.reduce((n, e) => n + truienIn(e), 0) };
      }).sort((a, b) => b.editions[0].year - a.editions[0].year || b.editions[0].compId - a.editions[0].compId);
      return { ...cat, races };
    }).filter((g) => g.races.length);
  });

  // Samenvatting: aantal rondes + gewonnen truien (alleen afgeronde rondes)
  const historySummary = $derived.by(() => {
    if (!history?.length) return '';
    const wins = history.reduce((n, h) => n + truienIn(h), 0);
    const rondes = `${history.length} ${history.length === 1 ? 'ronde' : 'rondes'}`;
    return wins ? `${rondes} · ${wins} ${wins === 1 ? 'trui' : 'truien'} gewonnen` : rondes;
  });

  $effect(() => {
    const id = userId;
    history = null;
    if (id) loadHistory(id);
  });
</script>

{#if showLabel}<div class="pm-section-label">Geschiedenis{#if historySummary}<span class="pm-hist-summary"> · {historySummary}</span>{/if}</div>{:else if historySummary}<div class="pm-hist-summary-top">{historySummary}</div>{/if}
{#if history === null}
  <div class="skeleton skeleton-row"></div>
{:else if !history.length}
  <div class="pm-empty">Nog geen rondes gespeeld.</div>
{:else}
  {#each historyGroups as g (g.id)}
    <div class="pm-hist-cat">{g.label}</div>
    {#each g.races as race (race.key)}
      <details class="pm-hist-race">
        <summary>
          <span class="pm-hist-name">{race.flag} {race.name}</span>
          <span class="pm-hist-meta">
            {race.editions.length}×{#if race.truien} · {race.truien} {race.truien === 1 ? 'trui' : 'truien'}{/if}
          </span>
          <span class="pm-hist-chevron" aria-hidden="true"></span>
        </summary>
        {#each race.editions as h (h.compId)}
          <div class="pm-hist-row">
            <div class="pm-hist-head">
              <span class="pm-hist-year tnum">{h.year}</span>
              <span class="pm-hist-meta">
                {#if h.running}<span class="badge bg-info">lopend</span>{/if}
                {#if !h.dns}van {h.count}{/if}
              </span>
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
              </div>
            {/if}
          </div>
        {/each}
      </details>
    {/each}
  {/each}
{/if}
