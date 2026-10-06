<!--
  Inschrijf-popup ("Ik doe mee"): toont de spelregels en vraagt expliciet
  akkoord. Pas na het aanvinken kan de speler zich inschrijven; de RPC legt
  tijdstip + RULES_VERSION vast in competition_participants (bewijs van akkoord).
  Geopend via ui.joinCompId vanuit Dashboard en Pick.
-->
<script lang="ts">
  import { state as appState, ui } from '../lib/state.svelte';
  import { toast } from '../lib/utils';
  import { joinCompetition } from '../lib/helpers';
  import { focusTrap } from '../lib/focus-trap';
  import Spelregels from './Spelregels.svelte';

  let agreed = $state(false);
  let busy = $state(false);

  const comp = $derived(ui.joinCompId != null ? appState.competitions.find((c: any) => c.id === ui.joinCompId) : null);

  // Elke keer dat de popup opengaat opnieuw akkoord vragen
  $effect(() => {
    void ui.joinCompId;
    agreed = false;
  });

  function close() {
    if (busy) return;
    ui.joinCompId = null;
  }

  async function confirmJoin() {
    if (ui.joinCompId == null || !agreed || busy) return;
    busy = true;
    try {
      await joinCompetition(ui.joinCompId);
      toast(`Je doet mee met ${comp?.name || 'deze ronde'}!`, 'success');
      ui.joinCompId = null;
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      busy = false;
    }
  }
</script>

{#if ui.joinCompId != null}
  <div class="h2h-overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) close(); }} onkeydown={(e) => { if (e.key === 'Escape') close(); }}>
    <div class="h2h-modal" role="dialog" aria-modal="true" aria-labelledby="join-modal-title" use:focusTrap>
      <div class="h2h-header">
        <h3 id="join-modal-title">Meedoen met {comp?.name || 'deze ronde'}</h3>
        <button class="h2h-close" aria-label="Sluiten" onclick={close}>&times;</button>
      </div>
      <p style="font-size:0.85rem;" class="mb-2">Lees de spelregels. Door je in te schrijven ga je ermee akkoord.</p>
      <div class="join-rules" style="font-size:0.8rem; line-height:1.6; max-height:45vh; overflow-y:auto; border:1px solid var(--border); border-radius:10px; padding:0.75rem 0.9rem;">
        <Spelregels />
      </div>
      <label class="form-check d-flex align-items-start gap-2 mt-3 mb-3" style="font-size:0.85rem; cursor:pointer;">
        <input type="checkbox" class="form-check-input mt-1" style="float:none; margin-left:0;" bind:checked={agreed}>
        <span>Ik heb de spelregels gelezen en ga ermee akkoord.</span>
      </label>
      <div class="d-flex justify-content-end gap-2">
        <button class="btn btn-ghost" onclick={close} disabled={busy}>Annuleren</button>
        <button class="btn btn-accent btn-skew" onclick={confirmJoin} disabled={!agreed || busy}><span>{busy ? 'Bezig…' : 'Ik doe mee'}</span></button>
      </div>
    </div>
  </div>
{/if}
