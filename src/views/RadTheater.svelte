<!--
  Rad van Fortuin-theater: eenmalige overlay per etappe (per apparaat) voor
  ÁLLE deelnemers zodra het Rad voor iemand gedraaid heeft. Bij meerdere
  vergeten picks draait het rad sequentieel — één spin per slachtoffer.
  De uitkomsten staan al vast in de database; het rad "landt" gescript.
  Dismiss zet een localStorage-vlag, zie Dashboard.svelte.
-->
<script lang="ts">
  import { icon } from '../lib/icons';
  import { confettiBurst } from '../lib/utils';

  let { names, spins, stageLabel, onDismiss } = $props<{
    names: string[]; // segmentnamen (8), bevat alle target-renners
    spins: { playerName: string; riderName: string; isMe: boolean; targetIndex: number }[];
    stageLabel: string;
    onDismiss: () => void;
  }>();

  const SEG = 360 / names.length;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let spinIdx = $state(0);
  let rotation = $state(0);
  let baseTurns = 0;
  let phase: 'spinning' | 'landed' | 'klaar' = $state(reduced ? 'klaar' : 'spinning');
  let timers: any[] = [];

  function startSpin(i: number) {
    spinIdx = i;
    phase = 'spinning';
    // Cumulatief draaien: elke spin vijf extra omwentelingen, eindigend met
    // het midden van het doelsegment onder de wijzer.
    baseTurns += 5;
    rotation = baseTurns * 360 - (spins[i].targetIndex * SEG + SEG / 2);
    timers.push(setTimeout(() => {
      phase = 'landed';
      confettiBurst();
      timers.push(setTimeout(() => {
        if (i + 1 < spins.length) startSpin(i + 1);
        else phase = 'klaar';
      }, 2200));
    }, 4300));
  }

  $effect(() => {
    if (reduced) { confettiBurst(); return; }
    // Eén frame na mount zodat de CSS-transition de rotatie oppakt
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => startSpin(0)));
    return () => { cancelAnimationFrame(raf); timers.forEach(clearTimeout); };
  });

  const huidige = $derived(spins[spinIdx]);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onDismiss();
  }

  // Truikleur-tokens als segmentkleuren (koersbord-taal)
  const COLORS = ['var(--jaune)', 'var(--vert)', 'var(--pois)', 'var(--wit)', 'var(--blue)', 'var(--purple)'];
  const wheelBg = `conic-gradient(${names.map((_: string, i: number) =>
    `${COLORS[i % COLORS.length]} ${i * SEG}deg ${(i + 1) * SEG}deg`).join(', ')})`;
</script>

<svelte:window onkeydown={onKey} />

<div class="h2h-overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}>
  <div class="rad-modal">
    <div class="rad-title">{@html icon('wheel', '', 16)} Het Rad van Fortuin</div>
    <div class="rad-sub">Niet iedereen koos op tijd voor {stageLabel} — het Rad besliste.</div>

    {#if phase !== 'klaar'}
      <div class="rad-turn {huidige.isMe ? 'is-me' : ''}">
        {#if phase === 'spinning'}
          Het Rad draait voor {huidige.isMe ? 'JOU' : huidige.playerName}…
        {:else}
          {huidige.isMe ? 'Jij krijgt' : `${huidige.playerName} krijgt`} {huidige.riderName}!
        {/if}
        {#if spins.length > 1}<span class="rad-count tnum">{spinIdx + 1}/{spins.length}</span>{/if}
      </div>
    {/if}

    <div class="rad-stage">
      <div class="rad-pointer"></div>
      <div class="rad-wheel" style="background:{wheelBg}; transform:rotate({rotation}deg);">
        {#each names as name, i}
          <span class="rad-label" style="transform:rotate({i * SEG + SEG / 2}deg)">
            <span class="rad-label-text">{name.split(' ')[0]}</span>
          </span>
        {/each}
      </div>
      <div class="rad-hub">{@html icon('wheel', '', 22)}</div>
    </div>

    {#if phase === 'klaar'}
      <div class="rad-result">
        <div class="rad-result-label">Het Rad heeft gesproken</div>
        {#each spins as s}
          <div class="rad-result-row {s.isMe ? 'is-me' : ''}">
            <span>{s.isMe ? 'Jij' : s.playerName}</span>
            <span class="rad-result-rider">{s.riderName}</span>
          </div>
        {/each}
        <button class="btn btn-accent btn-skew mt-3" onclick={onDismiss}><span>{spins.some((s: any) => s.isMe) ? 'Ah joh, prima' : 'Mooi wel'}</span></button>
      </div>
    {/if}
  </div>
</div>
