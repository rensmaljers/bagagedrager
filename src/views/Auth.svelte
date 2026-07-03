<!--
  Auth-scherm (login/signup) — geport uit public/index.html (#auth-screen)
  + de auth-handlers uit public/app.ts. Foutmeldingen zijn lokaal reactief
  (vervangt helpers.showError die $('auth-error') muteerde).
  Na succesvolle login/signup wordt alleen appState.session gezet;
  App.svelte ziet de sessie verschijnen en draait initApp().
-->
<script lang="ts">
  import { state as appState } from '../lib/state.svelte';
  import { login, signup } from '../lib/auth';
  import { supabase } from '../lib/supabase-client';

  let email = $state('');
  let password = $state('');
  let errorMsg = $state('');
  let successMsg = $state('');
  let successTimer: any = null;

  function showError(msg: string) {
    errorMsg = msg;
  }

  let busy = $state(false);

  async function handleLogin() {
    const em = email.trim();
    if (!em || !password) { showError('Vul je e-mailadres en wachtwoord in.'); return; }
    busy = true;
    try {
      appState.session = await login(em, password);
      // App.svelte draait initApp() zodra appState.session gezet is
    } catch (e: any) { showError(e.message); }
    finally { busy = false; }
  }

  async function handleSignup() {
    const em = email.trim();
    if (!em || !password) { showError('Vul je e-mailadres en wachtwoord in.'); return; }
    try {
      const data = await signup(em, password, em.split('@')[0]);
      if (data.session) appState.session = data.session;
      else showError('Check je email om je account te bevestigen');
    } catch (e: any) { showError(e.message); }
  }

  async function handleForgotPassword(e: Event) {
    e.preventDefault();
    const em = email.trim();
    if (!em) { showError('Vul eerst je e-mailadres in'); return; }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(em);
      if (error) throw new Error(error.message);
      errorMsg = '';
      successMsg = 'Herstelmail verzonden! Check je inbox.';
      clearTimeout(successTimer);
      successTimer = setTimeout(() => { successMsg = ''; }, 5000);
    } catch (err: any) { showError(err.message); }
  }
</script>

<!-- style.css zet #auth-screen op display:none (vanilla toggelde via JS) — hier overschrijven, {#if} in App.svelte bepaalt zichtbaarheid -->
<div id="auth-screen" class="container py-5" style="display:block;">
  <div class="row justify-content-center" style="min-height:80vh; align-items:center;">

    <!-- Intro panel -->
    <div class="col-lg-5 d-none d-lg-block">
      <div class="auth-intro">
        <h2>Speel mee met<br><span class="highlight">het wielerspel</span><br>voor echte ploegleiders.</h2>
        <p>Kies voor elke etappe jouw renner en strijd om de truien. Wie heeft het beste wielerinstinct?</p>
        <ul class="auth-features">
          <li><span class="feat-icon feat-gc"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span> Algemeen Klassement — de gele trui</li>
          <li><span class="feat-icon feat-pts"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span> Puntenklassement — de groene trui</li>
          <li><span class="feat-icon feat-mt"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg></span> Bergklassement — de bolletjestrui</li>
          <li><span class="feat-icon feat-game"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg></span> Spelklassement — de slimste ploegleider</li>
        </ul>
      </div>
    </div>

    <!-- Login card -->
    <div class="col-sm-8 col-md-5 col-lg-4">
      <div class="auth-card p-4 text-center">
        <svg class="auth-logo-svg" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="3"/>
          <path d="M16 40l8-20h16l8 20M20 30h24M24 20l8 8 8-8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="32" cy="32" r="4" fill="currentColor"/>
        </svg>
        <h1 class="mb-1">Bagagedrager</h1>
        <p class="text-muted auth-subtitle mb-4">Kies je renner, verdien de trui.<br>Het wielerspel voor echte ploegleiders.</p>
        <!-- form + submit: Enter in een veld logt ook in, en de browser/wachtwoordmanager herkent het als loginformulier -->
        <form id="auth-form" onsubmit={(e) => { e.preventDefault(); handleLogin(); }}>
          <div class="mb-3">
            <input type="email" id="auth-email" class="form-control" placeholder="Email" autocomplete="username" bind:value={email} />
          </div>
          <div class="mb-3">
            <input type="password" id="auth-password" class="form-control" placeholder="Wachtwoord" autocomplete="current-password" bind:value={password} />
          </div>
          <button id="btn-login" type="submit" class="btn btn-accent w-100 mb-2" disabled={busy}>{busy ? 'Bezig…' : 'Inloggen'}</button>
          <button id="btn-signup" type="button" class="btn btn-ghost w-100 mb-2" onclick={handleSignup} disabled={busy}>Aanmelden</button>
          <a href="#wachtwoord-vergeten" id="btn-forgot-password" style="font-size:0.8rem; color:var(--text-muted);" onclick={handleForgotPassword}>Wachtwoord vergeten?</a>
          <div id="auth-error" class="text-danger mt-3" style="font-size:0.85rem;" style:display={errorMsg ? 'block' : 'none'}>{errorMsg}</div>
          <div id="auth-success" class="text-success mt-3" style="font-size:0.85rem;" style:display={successMsg ? 'block' : 'none'}>{successMsg}</div>
        </form>
        <div class="auth-road"></div>
      </div>
    </div>

  </div>
</div>
