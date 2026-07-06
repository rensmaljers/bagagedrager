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
  import { focusTrap } from '../lib/focus-trap';

  let { pool, spins, stageLabel, onDismiss } = $props<{
    pool: string[]; // brede namen-pool waaruit het rad tijdens het draaien flitst
    spins: { playerName: string; riderName: string; isMe: boolean }[];
    stageLabel: string;
    onDismiss: () => void;
  }>();

  const SEGMENTS = 12;               // meer segmenten = voller peloton-gevoel
  const SEG = 360 / SEGMENTS;
  const TARGET_SLOT = 0;             // de toegewezen renner landt altijd in slot 0 (onder de wijzer)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const sample = () => {
    const s = [...pool].sort(() => Math.random() - 0.5).slice(0, SEGMENTS);
    while (s.length < SEGMENTS) s.push(pool[Math.floor(Math.random() * pool.length)] || '—');
    return s;
  };

  let spinIdx = $state(0);
  let rotation = $state(0);
  let displayNames = $state<string[]>(sample()); // labels die tijdens de spin snel wisselen
  let baseTurns = 0;
  let phase: 'spinning' | 'landed' | 'klaar' = $state(reduced ? 'klaar' : 'spinning');
  let timers: any[] = [];
  let cycleTimer: any = null;
  const SPIN_MS = 5200; // lange, spannende uitroltijd (zie CSS-transition)

  // Meerdere confetti-uitbarstingen kort na elkaar = voller feest
  function celebrate(times: number) {
    for (let k = 0; k < times; k++) timers.push(setTimeout(() => confettiBurst(), k * 180));
  }

  function startSpin(i: number) {
    spinIdx = i;
    phase = 'spinning';
    // Namen laten flitsen: elke ~110ms een verse greep uit de pool → het lijkt
    // of tientallen renners voorbijkomen. Vertraagt mee met het rad (interval
    // groeit) voor een natuurlijke "uitrol".
    clearInterval(cycleTimer);
    let tick = 0;
    const cycle = () => {
      displayNames = sample();
      tick++;
      // laatste ~1,3s: stoppen met wisselen zodat het rad rustig uitrolt
      if (tick * 130 < SPIN_MS - 1300) cycleTimer = setTimeout(cycle, 130);
    };
    cycleTimer = setTimeout(cycle, 130);

    // Cumulatief draaien; landt slot 0 (midden) onder de wijzer.
    baseTurns += 7;
    rotation = baseTurns * 360 - (TARGET_SLOT * SEG + SEG / 2);
    timers.push(setTimeout(() => {
      clearInterval(cycleTimer); clearTimeout(cycleTimer);
      // Bevries met de toegewezen renner in slot 0 (rest blijft peloton-vulling)
      const finalNames = sample();
      finalNames[TARGET_SLOT] = spins[i].riderName;
      displayNames = finalNames;
      phase = 'landed';
      celebrate(2);
      timers.push(setTimeout(() => {
        if (i + 1 < spins.length) startSpin(i + 1);
        else { phase = 'klaar'; celebrate(4); }
      }, 2400));
    }, SPIN_MS));
  }

  $effect(() => {
    if (reduced) { confettiBurst(); return; }
    // Eén frame na mount zodat de CSS-transition de rotatie oppakt
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => startSpin(0)));
    return () => { cancelAnimationFrame(raf); clearTimeout(cycleTimer); timers.forEach(clearTimeout); };
  });

  const huidige = $derived(spins[spinIdx]);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onDismiss();
  }

  // Truikleur-tokens als segmentkleuren (koersbord-taal)
  const COLORS = ['var(--jaune)', 'var(--vert)', 'var(--pois)', 'var(--wit)', 'var(--blue)', 'var(--purple)'];
  const wheelBg = `conic-gradient(${Array.from({ length: SEGMENTS }, (_, i) =>
    `${COLORS[i % COLORS.length]} ${i * SEG}deg ${(i + 1) * SEG}deg`).join(', ')})`;
</script>

<svelte:window onkeydown={onKey} />

<div class="h2h-overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}>
  <div class="rad-modal" role="dialog" aria-modal="true" aria-label="Rad van Fortuin" use:focusTrap>
    <div class="rad-title">{@html icon('wheel', '', 16)} Het Rad van Fortuin</div>
    <div class="rad-sub">Niet iedereen koos op tijd voor {stageLabel} — het Rad besliste.</div>

    {#if phase !== 'klaar'}
      <div class="rad-turn {huidige.isMe ? 'is-me' : ''} {phase === 'landed' ? 'landed' : ''}">
        {#if phase === 'spinning'}
          Het Rad draait voor {huidige.isMe ? 'JOU' : huidige.playerName}<span class="rad-dots"><i>.</i><i>.</i><i>.</i></span>
        {:else}
          {huidige.isMe ? 'Jij krijgt' : `${huidige.playerName} krijgt`} {huidige.riderName}!
        {/if}
        {#if spins.length > 1}<span class="rad-count tnum">{spinIdx + 1}/{spins.length}</span>{/if}
      </div>
    {/if}

    <div class="rad-stage {phase === 'spinning' ? 'is-spinning' : ''} {phase === 'landed' ? 'is-landed' : ''}">
      <div class="rad-pointer"></div>
      <div class="rad-glow"></div>
      <div class="rad-wheel" style="background:{wheelBg}; transform:rotate({rotation}deg); transition-duration:{SPIN_MS}ms;">
        {#each displayNames as name, i}
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
