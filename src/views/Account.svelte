<!--
  Account-tabblad — geport uit public/index.html (#section-account) en de
  account-handlers uit public/app.ts (loadAccountView, avatar-upload, opslaan,
  verwijderen, e-mail-toggle, test-push/test-email).
  Component mount = tab-open (vervangt loadAccountView), dus de formulier-state
  wordt hier bij initialisatie uit appState.profile gelezen.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { state as appState, ui } from '../lib/state.svelte';
  import { SUPABASE_URL, TEAMS } from '../lib/config';
  import { supabase } from '../lib/supabase-client';
  import { supaPatch, supaRpc } from '../lib/api';
  import { toast } from '../lib/utils';
  import { updateNotificationButton } from '../lib/notifications';

  // Formulier-state (vanilla: loadAccountView vulde de inputs bij tab-open)
  let name = $state(appState.profile?.display_name || '');
  const email = appState.session?.user?.email || '';
  let team = $state(appState.profile?.favorite_team || '');
  let hero = $state(appState.profile?.cycling_hero || '');
  let motto = $state(appState.profile?.motto || '');
  let emailReminders = $state(!!appState.profile?.email_reminders);

  const teams = Object.keys(TEAMS).sort();
  const initials = $derived(
    (appState.profile?.display_name || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
  );

  // Statusregel naast de opslaan-knop (vanilla: #account-status)
  let status = $state({ text: '', cls: '' });
  let statusTimer: any = null;
  function setStatus(text: string, cls: string, clearAfter = 0) {
    status = { text, cls };
    clearTimeout(statusTimer);
    if (clearAfter) statusTimer = setTimeout(() => { status = { text: '', cls: status.cls }; }, clearAfter);
  }

  // Notificatieknop status — legacy DOM-helper uit notifications.ts;
  // de click wordt daar via een document-listener afgehandeld.
  onMount(() => { updateNotificationButton(); });

  async function onAvatarChange(e: any) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('Foto mag maximaal 2MB zijn', 'warning'); return; }
    if (!file.type.startsWith('image/')) { toast('Alleen afbeeldingen toegestaan', 'warning'); return; }

    setStatus('Foto uploaden...', 'text-muted');
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${appState.session.user.id}/avatar.${ext}`;

      // Upload via Supabase Storage client
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw new Error('Upload mislukt');

      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}?t=${Date.now()}`;
      await supaPatch('profiles', `id=eq.${appState.session.user.id}`, { avatar_url: publicUrl });
      appState.profile.avatar_url = publicUrl;
      appState._avatarMap[appState.profile.display_name] = publicUrl;
      setStatus('Foto opgeslagen!', 'text-success', 2000);
    } catch (err: any) {
      setStatus(err.message, 'text-danger');
    }
  }

  async function saveAccount() {
    const newName = name.trim();
    if (!newName) { setStatus('Naam mag niet leeg zijn', 'text-danger'); return; }
    try {
      const updates = {
        display_name: newName,
        favorite_team: team || null,
        cycling_hero: hero.trim() || null,
        motto: motto.trim() || null,
      };
      await supaPatch('profiles', `id=eq.${appState.session.user.id}`, updates);
      if (!appState.profile) appState.profile = {};
      Object.assign(appState.profile, updates);
      // Navbar-gebruikersnaam volgt appState.profile reactief (vanilla: $('user-name'))
      setStatus('Opgeslagen!', 'text-success', 2000);
    } catch (e: any) {
      setStatus(e.message, 'text-danger');
    }
  }

  async function deleteAccount() {
    if (!confirm('Weet je zeker dat je je account permanent wilt verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
    try {
      await supaRpc('delete_own_account');
      await supabase.auth.signOut();
      appState.session = null; appState.profile = null;
      ui.loading = false;
      ui.authScreen = true;
      toast('Account verwijderd.', 'success');
    } catch (e: any) {
      toast('Verwijderen mislukt: ' + e.message, 'error');
    }
  }

  async function onEmailRemindToggle(e: any) {
    const checked = e.currentTarget.checked;
    try {
      await supaPatch('profiles', `id=eq.${appState.session.user.id}`, { email_reminders: checked });
      if (appState.profile) appState.profile.email_reminders = checked;
      toast(checked ? 'E-mailherinneringen ingeschakeld.' : 'E-mailherinneringen uitgeschakeld.', 'info');
    } catch (err: any) {
      toast('Opslaan mislukt: ' + err.message, 'error');
      emailReminders = !checked;
    }
  }

  // Test-push (alleen admins)
  let pushBusy = $state(false);
  let pushResult = $state<{ msg: string; type: string } | null>(null);
  let pushTimer: any = null;

  async function testPush() {
    const safeMsg = (e: any): string => { try { return e?.message || e?.name || String(e) || 'onbekende fout'; } catch { return 'onbekende fout'; } };
    pushBusy = true;
    let resultMsg = '';
    let resultType: 'success' | 'error' | 'warning' | 'info' = 'info';
    try {
      const { data, error } = await supabase.functions.invoke('test-push');
      if (error) { resultMsg = safeMsg(error); resultType = 'error'; }
      else if (data?.sent > 0) { resultMsg = `Testmelding verstuurd (${data.sent}/${data.subscriptions})!`; resultType = 'success'; }
      else if (data?.error) { resultMsg = String(data.error); resultType = 'warning'; }
      else if (data?.details?.length) { const d = data.details[0]; resultMsg = `HTTP ${d.status ?? '?'} van ${d.endpoint} — ${d.body || d.error || 'geen body'}`; resultType = 'error'; }
      else { resultMsg = 'Geen subscription gevonden. Schakel app-meldingen opnieuw in.'; resultType = 'warning'; }
    } catch (e: any) {
      resultMsg = 'Aanroep mislukt: ' + safeMsg(e);
      resultType = 'error';
    } finally {
      pushBusy = false;
    }
    pushResult = { msg: resultMsg, type: resultType };
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushResult = null; }, 8000);
    toast(resultMsg, resultType);
  }

  // Test-email (alleen admins; rij staat verborgen zolang er geen afzenderdomein is)
  let emailBusy = $state(false);

  async function testEmail() {
    emailBusy = true;
    try {
      const { data, error } = await supabase.functions.invoke('test-email');
      if (error) throw error;
      if (data?.sent) toast(`Test-mail verstuurd naar ${data.to}`, 'success');
      else toast(data?.error || 'Onbekende fout', 'error');
    } catch (e: any) {
      // FunctionsHttpError: echte foutmelding zit in de response body (e.context)
      let msg = e?.message || String(e);
      try {
        const body = await e?.context?.json();
        if (body?.error) msg = body.error;
      } catch { /* body al gelezen of geen json */ }
      toast('Fout: ' + msg, 'error');
    } finally {
      emailBusy = false;
    }
  }
</script>

<div class="row g-4">
  <div class="col-md-6">
    <div class="card">
      <div class="card-header"><h5 class="mb-0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg> Account Instellingen</h5></div>
      <div class="card-body">
        <div class="mb-3 d-flex align-items-center gap-3">
          <div class="avatar-upload-wrapper">
            <div id="account-avatar-preview" class="avatar avatar-lg">
              {#if appState.profile?.avatar_url}
                <img src={appState.profile.avatar_url} alt="" onerror={(e) => (e.currentTarget as HTMLElement).remove()}>
              {:else}
                <span id="account-avatar-initials">{initials}</span>
              {/if}
            </div>
            <label for="account-avatar-input" class="avatar-upload-btn" title="Foto wijzigen">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            </label>
            <input type="file" id="account-avatar-input" accept="image/*" style="display:none;" onchange={onAvatarChange} />
          </div>
          <div class="flex-grow-1">
            <label class="form-label" for="account-name" style="font-size:0.8rem; color:var(--text-muted);">Weergavenaam</label>
            <input type="text" id="account-name" class="form-control form-control-sm" placeholder="Jouw naam" bind:value={name} />
          </div>
        </div>
        <div class="mb-3">
          <label class="form-label" for="account-email" style="font-size:0.8rem; color:var(--text-muted);">Email</label>
          <input type="email" id="account-email" class="form-control form-control-sm" disabled value={email} />
        </div>
        <div class="mb-3">
          <label class="form-label" for="account-team" style="font-size:0.8rem; color:var(--text-muted);">Favoriete ploeg</label>
          <select id="account-team" class="form-select form-select-sm" bind:value={team}>
            <option value="">Kies je ploeg...</option>
            {#each teams as t (t)}
              <option value={t}>{t}</option>
            {/each}
          </select>
        </div>
        <div class="mb-3">
          <label class="form-label" for="account-hero" style="font-size:0.8rem; color:var(--text-muted);">Wielerheld</label>
          <input type="text" id="account-hero" class="form-control form-control-sm" placeholder="Je all-time favoriete renner" maxlength="50" bind:value={hero} />
        </div>
        <div class="mb-3">
          <label class="form-label" for="account-motto" style="font-size:0.8rem; color:var(--text-muted);">Motto</label>
          <input type="text" id="account-motto" class="form-control form-control-sm" placeholder="Jouw wielerspreuk of voorspelling" maxlength="80" bind:value={motto} />
        </div>
        <div class="d-flex gap-2 align-items-center">
          <button id="btn-save-account" class="btn btn-accent btn-sm" onclick={saveAccount}>Opslaan</button>
          <span id="account-status" class={status.cls} style="font-size:0.8rem;">{status.text}</span>
        </div>
        <hr class="my-3">
        <div style="font-size:0.85rem; font-weight:600; margin-bottom:0.6rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> Deadline herinneringen</div>
        <!-- App-meldingen -->
        <div class="d-flex align-items-start justify-content-between gap-3 mb-3">
          <div>
            <div style="font-size:0.82rem; font-weight:600;">App-melding</div>
            <div style="font-size:0.75rem; color:var(--text-muted); line-height:1.5;">30 en 5 minuten voor de deadline via je browser.<br>
            Vereist toestemming en een moderne browser (Chrome, Firefox, Safari 16.4+).<br>
            <strong>iOS:</strong> werkt alleen als je de app hebt toegevoegd aan je beginscherm via Deel → Zet op beginscherm.</div>
          </div>
          <div class="d-flex flex-column gap-1 flex-shrink-0">
            <button id="btn-notifications" class="btn btn-sm btn-outline-secondary" style="min-width:80px;">Laden…</button>
            {#if appState.profile?.is_admin}
              <button id="btn-test-push" class="btn btn-sm btn-outline-primary" style="min-width:110px;" disabled={pushBusy} onclick={testPush}>{pushBusy ? 'Versturen…' : 'Test sturen'}</button>
              {#if pushResult}
                <div id="push-test-result" style="font-size:0.75rem; margin-top:4px;" style:color={pushResult.type === 'success' ? 'var(--green)' : 'var(--red)'}>{pushResult.msg}</div>
              {/if}
            {/if}
          </div>
        </div>
        <!-- Email-herinnering — verborgen: geen eigen domein, dus geen afzender mogelijk.
             Weer tonen (display:flex) zodra een domein bij Resend geverifieerd is. -->
        <div class="d-flex align-items-start justify-content-between gap-3" id="email-remind-row" style="display:none !important;">
          <div>
            <div style="font-size:0.82rem; font-weight:600;">E-mail</div>
            <div style="font-size:0.75rem; color:var(--text-muted); line-height:1.5;">4 uur voor de deadline een mail als je nog geen keuze hebt gemaakt.</div>
          </div>
          <div class="d-flex flex-column align-items-end gap-1 flex-shrink-0">
            <div class="form-check form-switch mt-1">
              <input class="form-check-input" type="checkbox" id="toggle-email-remind" style="cursor:pointer;" bind:checked={emailReminders} onchange={onEmailRemindToggle}>
            </div>
            {#if appState.profile?.is_admin}
              <button id="btn-test-email" class="btn btn-sm btn-outline-primary" style="font-size:0.75rem;" disabled={emailBusy} onclick={testEmail}>{emailBusy ? 'Versturen…' : 'Test sturen'}</button>
            {/if}
          </div>
        </div>
        <hr class="my-3">
        <div class="d-flex align-items-center justify-content-between">
          <div>
            <div style="font-size:0.85rem; font-weight:600; color:var(--bs-danger);">Account verwijderen</div>
            <div style="font-size:0.78rem; color:var(--text-muted);">Al je gegevens worden permanent verwijderd.</div>
          </div>
          <button id="btn-delete-account" class="btn btn-sm btn-outline-danger" style="white-space:nowrap;" onclick={deleteAccount}>Verwijderen</button>
        </div>
      </div>
    </div>
  </div>
  <div class="col-md-6">
    <div class="card">
      <div class="card-header"><h5 class="mb-0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg> Spelregels</h5></div>
      <div class="card-body" style="font-size:0.83rem; line-height:1.7;">
        <p class="mb-2"><strong>Basis</strong></p>
        <ul class="ps-3 mb-3">
          <li><strong>Kies 1 renner per etappe</strong> — voor de starttijd van die etappe.</li>
          <li><strong>Elke renner mag maar 1x</strong> gebruikt worden per ronde.</li>
          <li><strong>Te laat?</strong> Je keuze telt, maar je krijgt de straftijd (zie DNF) + 0 punten.</li>
          <li><strong>Geen keuze?</strong> Het Rad van Fortuin wijst je een willekeurige renner toe.</li>
          <li><strong>DNF, DNS of te laat?</strong> Als straftijd krijg je het <strong>slechtste tijdverschil van een door spelers gekozen renner die finishte</strong> — het Rad telt daarbij niet mee. Plus 0 punten in de andere klassementen.</li>
          <li><strong>Renner valt uit ná punten pakken?</strong> Alleen wie de etappe <strong>uitrijdt</strong> levert punten op. Pakt je renner bijvoorbeeld het bergpunt op de eerste klim maar valt hij daarna uit, dan vervallen die punten toch — je krijgt 0 punten (sprint, berg én spel) plus de straftijd.</li>
        </ul>
        <p class="mb-2"><strong>Grote rondes</strong> <span class="badge bg-secondary" style="font-size:0.65rem;">Tour, Giro, Vuelta</span></p>
        <ul class="ps-3 mb-3">
          <li>Je krijgt de <strong>werkelijke rijtijd</strong>, <strong>sprintpunten</strong> en <strong>bergpunten</strong> van je gekozen renner.</li>
          <li><strong>Bonificatie:</strong> 1e = −10s, 2e = −6s, 3e = −4s (wordt verrekend in totaaltijd).</li>
          <li><strong>🟡 Gele trui:</strong> laagste totaaltijd wint.</li>
          <li><strong>🟢 Groene trui:</strong> meeste sprintpunten.</li>
          <li><strong>🔴 Bolletjestrui:</strong> meeste bergpunten.</li>
        </ul>
        <p class="mb-2"><strong>Klassiekers</strong> <span class="badge bg-secondary" style="font-size:0.65rem;">Monumenten, etc.</span></p>
        <ul class="ps-3 mb-2">
          <li>Punten op basis van <strong>finishpositie</strong>:</li>
        </ul>
        <table class="table table-sm mb-2" style="font-size:0.78rem; max-width:340px; margin-left:1rem;">
          <thead><tr><th>Positie</th><th>Punten</th><th>Positie</th><th>Punten</th></tr></thead>
          <tbody>
            <tr><td>1e</td><td>100</td><td>7e</td><td>35</td></tr>
            <tr><td>2e</td><td>80</td><td>8e</td><td>30</td></tr>
            <tr><td>3e</td><td>70</td><td>9e</td><td>25</td></tr>
            <tr><td>4e</td><td>60</td><td>10e</td><td>20</td></tr>
            <tr><td>5e</td><td>50</td><td>11e–13e</td><td>15</td></tr>
            <tr><td>6e</td><td>40</td><td>14e–15e</td><td>10</td></tr>
            <tr><td colspan="2"></td><td>16e–20e</td><td>5</td></tr>
          </tbody>
        </table>
        <ul class="ps-3 mb-2">
          <li><strong>Deelpenalty:</strong> als meerdere spelers dezelfde renner kiezen worden de punten verminderd:</li>
        </ul>
        <table class="table table-sm mb-3" style="font-size:0.78rem; max-width:280px; margin-left:1rem;">
          <thead><tr><th>Spelers</th><th>Je krijgt</th></tr></thead>
          <tbody>
            <tr><td>1 (uniek)</td><td>100%</td></tr>
            <tr><td>2</td><td>80%</td></tr>
            <tr><td>3</td><td>60%</td></tr>
            <tr><td>4</td><td>40%</td></tr>
            <tr><td>5+</td><td>20%</td></tr>
          </tbody>
        </table>
        <ul class="ps-3 mb-0">
          <li><strong>🎯 Spelklassement:</strong> hoogste totaal spelpunten wint.</li>
        </ul>
      </div>
    </div>
    <div class="card mt-3">
      <div class="card-header"><h5 class="mb-0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true"><circle cx="12" cy="16" r="5"/><path d="M8.56 2.9A7 7 0 0 1 19 9v1h-2"/><path d="M7 10.72V9a7 7 0 0 1 .89-3.45"/></svg> Rollen</h5></div>
      <div class="card-body" style="font-size:0.83rem; line-height:1.7;">
        <ul class="mb-0 ps-3">
          <li><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> <strong>Ploegleider</strong> — Admin</li>
          <li><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg> <strong>Kopman</strong> — 15+ etappes gespeeld</li>
          <li><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> <strong>Luitenant</strong> — 5+ etappes gespeeld</li>
          <li><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg> <strong>Knecht</strong> — 1+ etappe gespeeld</li>
          <li><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true"><circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17 8.5 10l3-2.5L14 11h4"/></svg> <strong>Stagiair</strong> — Nieuw lid</li>
        </ul>
      </div>
    </div>
  </div>
</div>
