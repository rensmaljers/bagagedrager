<!--
  FeedbackBar — footer-widget (app-breed, onder de tab-content in App.svelte).
  Speler stuurt feedback of een vraag in; belandt via submit_feedback-RPC in de
  feedback-tabel, die admins in de Admin-tab teruglezen. Prop-loos, leest alleen
  ui/appState voor de context (welk tabblad).
-->
<script lang="ts">
  import { state as appState, ui } from '../lib/state.svelte';
  import { supaRpc } from '../lib/api';
  import { toast } from '../lib/utils';

  let open = $state(false);
  let message = $state('');
  let sending = $state(false);

  async function send() {
    const text = message.trim();
    if (!text || sending) return;
    sending = true;
    try {
      const comp = appState.competitions.find((c: any) => c.id === appState.activeCompId);
      const context = `tab:${ui.activeTab}${comp ? ` · ${comp.name}` : ''}`;
      await supaRpc('submit_feedback', { p_message: text, p_context: context });
      message = '';
      open = false;
      toast('Bedankt! Je bericht is verstuurd.', 'success');
    } catch (e: any) {
      toast('Versturen mislukte: ' + (e?.message || 'onbekende fout'), 'error');
    } finally {
      sending = false;
    }
  }
</script>

<div class="feedback-bar">
  {#if !open}
    <button class="feedback-toggle" onclick={() => (open = true)}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      Feedback of een vraag?
    </button>
  {:else}
    <div class="feedback-form card">
      <div class="card-body">
        <label for="feedback-msg" class="feedback-label">Feedback of een vraag insturen</label>
        <textarea id="feedback-msg" class="form-control" rows="3" maxlength="2000"
          placeholder="Wat wil je kwijt? (bug, idee, vraag…)"
          bind:value={message} disabled={sending}></textarea>
        <div class="feedback-actions">
          <button class="btn btn-ghost btn-sm" onclick={() => { open = false; message = ''; }} disabled={sending}>Annuleren</button>
          <button class="btn btn-accent btn-sm" onclick={send} disabled={sending || !message.trim()}>
            {sending ? 'Versturen…' : 'Versturen'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
