<!--
  App-shell — geport uit public/app.ts + de shell-delen van public/index.html.
  Bevat: boot (getSession → initApp), auth-scherm ↔ app, navbar (comp-select,
  gebruikersnaam, thema-toggle, uitloggen), tab-navigatie (hash-sync), realtime,
  toast/overlay-containers en de foto-hover-preview.

  Views (Dashboard/Pick/History/Peloton/Account) zijn prop-loze componenten die
  hun eigen data laden bij mount. Tab-wissel of ui.refreshTick++ remount de
  actieve view ({#key}) — dat vervangt het "activeTab.click()"-patroon uit app.ts.
-->
<script lang="ts" module>
  import { state as appState, ui } from './lib/state.svelte';
  import { loadAdmin } from './views/admin-lazy';
  import { supabase } from './lib/supabase-client';
  import { supaRest } from './lib/api';
  import { toast } from './lib/utils';
  import { activeScoringMode, activeStages } from './lib/helpers';
  import { setupDeadlineNotifications } from './lib/notifications';

  // Refresh-teller: bump = actieve view remount (vervangt activeTab.click()).
  // ui is een $state-proxy dus deze dynamisch toegevoegde property is reactief.
  ui.refreshTick = 0;

  export const TABS = ['dashboard', 'pick', 'history', 'participants', 'account', 'admin'];

  export function navigateToTab(tab: string) {
    if (!TABS.includes(tab)) return;
    ui.activeTab = tab;
    window.location.hash = tab;
  }

  // Supabase client houdt de sessie automatisch vers — session blijft in sync
  supabase.auth.onAuthStateChange((_event, newSession) => {
    appState.session = newSession;
  });

  // Service worker vroeg registreren: push + offline app-shell (zie public/sw.js).
  // Bij een nieuwe versie (controllerchange ná een bestaande controller) melden we
  // dat een verversing de nieuwste versie laadt — geen auto-reload midden in een pick.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) toast('App bijgewerkt — ververs de pagina voor de nieuwste versie', 'info', 7000);
      hadController = true;
    });
  }

  // --- INIT ---
  export async function initApp() {
    // Gebruik opgeslagen compId om riders mee te batchen in de eerste round-trip
    const savedCompId = parseInt(localStorage.getItem('bagagedrager_comp') as any) || null;

    const [profiles, comps, allStages, picks, allProfiles, preloadedRiders, preloadedStandings, teamShirts] = await Promise.all([
      supaRest('profiles', { filters: `id=eq.${appState.session.user.id}` }),
      supaRest('competitions', { filters: 'order=year.desc,name' }),
      supaRest('stages', { filters: 'order=stage_number' }),
      supaRest('picks', { filters: `user_id=eq.${appState.session.user.id}&order=stage_id` }),
      supaRest('profiles'),
      savedCompId ? supaRest('riders', { filters: `competition_id=eq.${savedCompId}&order=bib_number` }) : Promise.resolve(null),
      savedCompId ? supaRest('general_classification', { filters: `competition_id=eq.${savedCompId}` }) : Promise.resolve(null),
      supaRest('team_shirts').catch(() => []),
    ]);

    appState.profile = profiles[0];
    appState.competitions = comps;
    appState.stages = allStages;
    appState.myPicks = picks;
    appState._cache.allProfiles = allProfiles;
    allProfiles.forEach((p: any) => { appState._avatarMap[p.display_name] = p.avatar_url; });

    // Tenues uit de DB — localStorage is alleen nog cache/fallback
    if (teamShirts?.length) {
      teamShirts.forEach((s: any) => { appState.teamShirts[s.team_name] = s.shirt_url; });
      localStorage.setItem('bagagedrager_shirts', JSON.stringify(appState.teamShirts));
    }

    // Vanilla flipte hier de display van #app-loading/#auth-screen/#app — nu reactief
    ui.loading = false;
    ui.authScreen = false;
    supaRest('profiles', { method: 'PATCH', filters: `id=eq.${appState.session.user.id}`, body: { last_seen_at: new Date().toISOString() } }).catch(() => {});

    // Onthoud laatst gekozen ronde, val terug op actieve, dan eerste
    // (comp-select opties, banner, logo en sync-info volgen reactief)
    const activeComps = appState.competitions.filter((c: any) => c.is_active);
    const savedComp = savedCompId ? activeComps.find((c: any) => c.id === savedCompId) : null;
    const activeComp = savedComp || activeComps[0];
    if (activeComp) appState.activeCompId = activeComp.id;

    if (preloadedRiders && appState.activeCompId === savedCompId) {
      appState.riders = preloadedRiders;
      appState.stageRiders = {};
      appState._riderMap = {};
      for (const r of appState.riders) appState._riderMap[r.id] = r;
      appState._riderDropdownStageId = null;
      // Klassiekers hebben per-etappe startlijsten — laad die alsnog
      if (activeScoringMode() === 'classic') {
        const compStageIds = activeStages().map((s: any) => s.id);
        if (compStageIds.length) {
          const srData = await supaRest('stage_riders', {
            filters: `stage_id=in.(${compStageIds.join(',')})`,
            select: 'stage_id,rider_id',
          });
          for (const sr of srData) {
            if (!appState.stageRiders[sr.stage_id]) appState.stageRiders[sr.stage_id] = new Set();
            appState.stageRiders[sr.stage_id].add(sr.rider_id);
          }
        }
      }
    } else {
      await loadRidersForComp();
    }

    // Vul standings cache alvast zodat Dashboard direct kan renderen (geen skeleton flash)
    if (preloadedStandings && appState.activeCompId === savedCompId) {
      appState._cache.standings = preloadedStandings;
      appState._cache.standingsCompId = appState.activeCompId;
      // winnerTimeSum blijft undefined → achtergrondverzoek in Dashboard
    }

    // Navigate to hash tab or default to dashboard
    const hashTab = window.location.hash.replace('#', '');
    ui.activeTab = TABS.includes(hashTab) ? hashTab : 'dashboard';

    setupDeadlineNotifications();
    setupRealtime();
  }

  export async function loadDnfRiderIds() {
    if (!appState.activeCompId) return;
    const compStageIds = activeStages().map((s: any) => s.id);
    const [fromResults, fromRiders] = await Promise.all([
      compStageIds.length
        ? supaRest('stage_results', { select: 'rider_id', filters: `stage_id=in.(${compStageIds.join(',')})&dnf=eq.true` })
        : Promise.resolve([]),
      supaRest('riders', { select: 'id', filters: `competition_id=eq.${appState.activeCompId}&dnf=eq.true` }),
    ]);
    appState.dnfRiderIds = new Set([
      ...(fromResults || []).map((r: any) => r.rider_id),
      ...(fromRiders || []).map((r: any) => r.id),
    ]);
  }

  export async function loadRidersForComp() {
    if (appState.activeCompId) {
      // stage_riders alleen nodig voor klassiekers (per-etappe startlijst)
      const isClassic = activeScoringMode() === 'classic';
      const compStageIds = isClassic ? activeStages().map((s: any) => s.id) : [];
      const srFetch = (isClassic && compStageIds.length)
        ? supaRest('stage_riders', { filters: `stage_id=in.(${compStageIds.join(',')})`, select: 'stage_id,rider_id' })
        : Promise.resolve(null);
      const [ridersData, srData] = await Promise.all([
        supaRest('riders', { filters: `competition_id=eq.${appState.activeCompId}&order=bib_number` }),
        srFetch,
      ]);
      appState.riders = ridersData;
      appState.stageRiders = {};
      for (const sr of srData || []) {
        if (!appState.stageRiders[sr.stage_id]) appState.stageRiders[sr.stage_id] = new Set();
        appState.stageRiders[sr.stage_id].add(sr.rider_id);
      }
    } else {
      appState.riders = await supaRest('riders', { filters: 'order=bib_number' });
      appState.stageRiders = {};
    }
    await loadDnfRiderIds();
    appState._riderMap = {};
    for (const r of appState.riders) appState._riderMap[r.id] = r;
    appState._riderDropdownStageId = null;
    // Vanilla resette hier $('rider-team-filter') — Pick.svelte leidt de
    // teamfilter-opties reactief af uit appState.riders, dus dat vervalt.
  }

  function setupRealtime() {
    // Verwijder eventuele bestaande channel (bij re-login)
    if (appState._realtimeChannel) { supabase.removeChannel(appState._realtimeChannel); }
    let myPicksDebounce: any = null;

    appState._realtimeChannel = supabase
      .channel('game-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stage_results' }, async () => {
        // Gericht: caches nullen — views met een $effect op de cache herladen
        // zichzelf zonder remount (zoekveld/scroll blijven staan).
        appState._cache.standings = null;
        appState._cache.participants = null;
        (appState._cache as any).h2hPicks = null;
        // Herlaad DNF-renners zodat grid direct klopt (reactief in Pick)
        await loadDnfRiderIds();
        if (ui.activeTab === 'dashboard') toast('Resultaten bijgewerkt', 'info', 2500);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'picks' }, (payload: any) => {
        appState._cache.participants = null;
        appState._cache.standings = null;
        (appState._cache as any).h2hPicks = null;
        // Eigen picks alleen herladen als het event over onszelf gaat — anders
        // veroorzaakt de deadline-piek (27 spelers kiezen tegelijk) per client
        // een fetch-golf. RLS verbergt andermans picks vóór de deadline, dus
        // events zonder new-row zijn per definitie van onszelf niet.
        const rowUserId = payload?.new?.user_id || payload?.old?.user_id;
        if (rowUserId && rowUserId !== appState.session?.user?.id) return;
        clearTimeout(myPicksDebounce);
        myPicksDebounce = setTimeout(async () => {
          appState.myPicks = await supaRest('picks', { filters: `user_id=eq.${appState.session.user.id}&order=stage_id` });
        }, 800);
      })
      .subscribe();
  }

  // --- BOOT ---
  (async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (s) {
      appState.session = s;
      // initApp wordt aangeroepen door het sessie-$effect in de component
      return;
    }
    // Geen geldige sessie: toon login scherm
    ui.loading = false;
    ui.authScreen = true;
  })();
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Auth from './views/Auth.svelte';
  import Dashboard from './views/Dashboard.svelte';
  import Pick from './views/Pick.svelte';
  import History from './views/History.svelte';
  import Peloton from './views/Peloton.svelte';
  import Account from './views/Account.svelte';
  import PlayerModal from './views/PlayerModal.svelte';
  import RiderModal from './views/RiderModal.svelte';
  import FeedbackBar from './views/FeedbackBar.svelte';

  // initApp draaien zodra er een sessie is (boot én login/signup via Auth.svelte)
  let appStarted = false;
  $effect(() => {
    if (appState.session && !appStarted) {
      appStarted = true;
      // initApp-fouten mogen niet geluidloos verdwijnen: de sessie is dan al
      // opgeslagen (refresh "werkt") maar het scherm blijft op login hangen.
      untrack(() => {
        initApp().catch((e) => {
          console.error('initApp faalde:', e);
          appStarted = false;
          ui.loading = false;
          ui.authScreen = true;
          toast(`Inloggen lukte, maar de app kon niet laden: ${e?.message || e}. Probeer opnieuw.`, 'error', 8000);
        });
      });
    } else if (!appState.session) {
      appStarted = false;
    }
  });

  // --- COMPETITIE (vervangt updateCompSelectOptions/updateSyncInfo/applyCompColor) ---
  const activeComps = $derived(appState.competitions.filter((c: any) => c.is_active));
  const activeComp = $derived(appState.competitions.find((c: any) => c.id === appState.activeCompId));
  const compColor = $derived(activeComp?.color || '#facc15');
  const compCount = $derived(activeComps.length > 1 ? `${activeComps.length} rondes` : '');
  const syncInfo = $derived(activeComp?.last_synced_at
    ? `Gesynct: ${new Date(activeComp.last_synced_at).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    : '');
  const userName = $derived(appState.profile?.display_name || appState.session?.user?.email || '');

  // Document-level ronde-kleur (rest van applyCompColor zit in de markup)
  $effect(() => {
    document.documentElement.style.setProperty('--comp-color', compColor);
    document.documentElement.style.setProperty('--comp-accent', compColor);
    // Browser theme-color (adresbalk op mobiel)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', compColor);
  });

  // Fallback uit updateCompSelectOptions: actieve ronde is niet meer actief → eerste actieve
  $effect(() => {
    if (!activeComps.length) return;
    if (!activeComps.find((c: any) => c.id === appState.activeCompId)) {
      appState.activeCompId = activeComps[0].id;
      appState._cache.standings = null;
      appState._cache.participants = null;
    }
  });

  // Eén-tik-wissel via de pills (2-3 actieve rondes); de select gebruikt onCompChange direct
  function switchComp(id: number) {
    if (id === appState.activeCompId) return;
    appState.activeCompId = id;
    onCompChange();
  }

  async function onCompChange() {
    localStorage.setItem('bagagedrager_comp', String(appState.activeCompId));
    appState._cache.standings = null;
    appState._cache.participants = null;
    await loadRidersForComp();
    ui.refreshTick++; // herlaad actieve view (vervangt activeTab.click())
  }

  // --- THEMA (geport uit het theme-script in index.html; knop hoort bij de shell) ---
  const SUN_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  const MOON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  let theme = $state(document.documentElement.getAttribute('data-theme') || 'light');
  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('bagagedrager_theme', theme);
  }

  async function logout() {
    if (appState._realtimeChannel) { supabase.removeChannel(appState._realtimeChannel); appState._realtimeChannel = null; }
    await supabase.auth.signOut();
    appState.session = null; appState.profile = null;
    ui.loading = false;
    ui.authScreen = true;
  }

  function tabClick(e: Event, tab: string) {
    e.preventDefault();
    navigateToTab(tab);
  }

  // Handle browser back/forward
  onMount(() => {
    const onHashChange = () => {
      const tab = window.location.hash.replace('#', '');
      if (tab && TABS.includes(tab)) ui.activeTab = tab;
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  });

  // --- FOTO HOVER PREVIEW (geport uit app.ts, nu reactief) ---
  let previewVisible = $state(false);
  let previewSrc = $state('');
  let previewLeft = $state(0);
  let previewTop = $state(0);

  function getPreviewableImg(target: any) {
    const riderPhoto = target?.closest?.('.rider-photo');
    if (riderPhoto && riderPhoto.src) return riderPhoto;
    const avatar = target?.closest?.('.avatar');
    if (avatar) {
      const img = avatar.querySelector('img');
      if (img && img.src) return img;
    }
    return null;
  }

  function onDocMouseover(e: MouseEvent) {
    const img = getPreviewableImg(e.target);
    if (!img) return;
    previewSrc = img.src;
    previewVisible = true;
  }

  function onDocMousemove(e: MouseEvent) {
    if (!previewVisible) return;
    const offset = 16, w = 140, h = 140;
    previewLeft = e.clientX + offset + w > window.innerWidth ? e.clientX - w - offset : e.clientX + offset;
    previewTop = e.clientY + offset + h > window.innerHeight ? e.clientY - h - offset : e.clientY + offset;
  }

  function onDocMouseout(e: MouseEvent) {
    if (getPreviewableImg(e.target)) previewVisible = false;
  }

  // --- RENNER-KLIK DELEGATIE ---
  // riderDisplay(...) rendert overal via {@html}; echte event handlers kunnen daar
  // niet in. Eén document-brede click/Enter-delegatie op .rider-click opent de modal.
  function riderClickTarget(e: Event): number | null {
    const el = (e.target as HTMLElement)?.closest?.('.rider-click');
    if (!el) return null;
    const id = Number(el.getAttribute('data-rider-id'));
    return id || null;
  }
  function onDocClick(e: MouseEvent) {
    const id = riderClickTarget(e);
    if (id) ui.riderModalId = id;
  }
  function onDocKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    const id = riderClickTarget(e);
    if (id) { e.preventDefault(); ui.riderModalId = id; }
  }
</script>

<svelte:document onmouseover={onDocMouseover} onmousemove={onDocMousemove} onmouseout={onDocMouseout} onclick={onDocClick} onkeydown={onDocKeydown} />

<!-- Toast container -->
<div id="toast-container" class="toast-container"></div>

<!-- (De admin-picks- en H2H-modals leven in Admin.svelte resp. Dashboard.svelte
     als reactieve {#if}-modals; de oude display-toggle-overlays zijn verwijderd.) -->

{#if ui.loading}
  <div id="app-loading"><div class="app-loader"></div></div>
{:else if !appState.session || ui.authScreen}
  <Auth />
{:else}
  <!-- style.css zet #app op display:none (vanilla toggelde via JS) — hier overschrijven -->
  <div id="app" style="display:block;">
    <nav class="navbar mb-4">
      <div class="container">
        <span class="navbar-brand">
          <svg class="brand-logo" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="2.5"/>
            <path d="M8 20l4-10h8l4 10M10 15h12M12 10l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Bagagedrager
        </span>
        <div class="d-flex align-items-center gap-2">
          <a href="#account" id="user-name" class="text-muted" style="font-size:0.85rem;text-decoration:none;cursor:pointer;" title="Account instellingen" onclick={(e) => tabClick(e, 'account')}>{userName}</a>
          <button id="btn-refresh" class="theme-toggle pwa-only" title="Ververs" aria-label="Ververs" onclick={() => location.reload()}>↻</button>
          <button id="btn-theme" class="theme-toggle" title="Wissel thema" aria-label="Wissel thema" onclick={toggleTheme}>{@html theme === 'dark' ? SUN_SVG : MOON_SVG}</button>
          <button id="btn-logout" class="btn btn-ghost btn-sm" onclick={logout}>Uitloggen</button>
        </div>
        <div class="comp-selector">
          {#if activeComp?.logo_url}
            {#key activeComp.logo_url}
              <img id="comp-logo" class="comp-logo" alt="" src={activeComp.logo_url} onerror={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}>
            {/key}
          {/if}
          {#if activeComps.length >= 2 && activeComps.length <= 3}
            <!-- 2-3 rondes: segmented pills — wisselen in één tik i.p.v. via de dropdown -->
            <div class="comp-switch" role="group" aria-label="Wissel van ronde">
              {#each activeComps as c (c.id)}
                <button type="button" class="comp-switch-btn"
                  class:active={c.id === appState.activeCompId}
                  style:--pill-color={c.color || '#facc15'}
                  aria-pressed={c.id === appState.activeCompId}
                  onclick={() => switchComp(c.id)}>
                  {c.country_flag || ''} {c.name}
                </button>
              {/each}
            </div>
          {:else}
            <select id="comp-select" class="form-select form-select-sm" title="Wissel van ronde"
              bind:value={appState.activeCompId} onchange={onCompChange}
              style:border-color={compColor + '60'} style:background={compColor + '10'}>
              {#each activeComps as c (c.id)}
                <option value={c.id}>{c.country_flag || ''} {c.name}</option>
              {/each}
            </select>
            <span id="comp-count" class="comp-count">{compCount}</span>
          {/if}
          {#if syncInfo}
            <span id="comp-sync-info" class="comp-sync-info">{syncInfo}</span>
          {/if}
        </div>
      </div>
    </nav>

    <div class="container">
      <ul class="nav nav-pills mb-3" id="main-tabs">
        <li class="nav-item">
          <a class="nav-link" class:active={ui.activeTab === 'dashboard'} style:border-bottom-color={ui.activeTab === 'dashboard' ? compColor : null} href="#dashboard" onclick={(e) => tabClick(e, 'dashboard')} title="Klassement"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg><span class="nav-label"> Klassement</span></a>
        </li>
        <li class="nav-item">
          <a class="nav-link" class:active={ui.activeTab === 'pick'} style:border-bottom-color={ui.activeTab === 'pick' ? compColor : null} href="#pick" onclick={(e) => tabClick(e, 'pick')} title="Keuze"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true"><circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17 8.5 10l3-2.5L14 11h4"/></svg><span class="nav-label"> Keuze</span></a>
        </li>
        <li class="nav-item">
          <a class="nav-link" class:active={ui.activeTab === 'history'} style:border-bottom-color={ui.activeTab === 'history' ? compColor : null} href="#history" onclick={(e) => tabClick(e, 'history')} title="Jouw keuzes"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true"><path d="M12 8v4l3 3"/><path d="M3.05 11a9 9 0 1 0 .5-3"/><path d="M3 3v5h5"/></svg><span class="nav-label"> Mijn keuzes</span></a>
        </li>
        <li class="nav-item">
          <a class="nav-link" class:active={ui.activeTab === 'participants'} style:border-bottom-color={ui.activeTab === 'participants' ? compColor : null} href="#participants" onclick={(e) => tabClick(e, 'participants')} title="Uitslagen"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><span class="nav-label"> Uitslagen</span></a>
        </li>
        <li class="nav-item">
          <a class="nav-link" class:active={ui.activeTab === 'account'} style:border-bottom-color={ui.activeTab === 'account' ? compColor : null} href="#account" onclick={(e) => tabClick(e, 'account')} title="Account"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg><span class="nav-label"> Account</span></a>
        </li>
        {#if appState.profile?.is_admin}
          <li class="nav-item" id="admin-tab">
            <a class="nav-link" class:active={ui.activeTab === 'admin'} style:border-bottom-color={ui.activeTab === 'admin' ? compColor : null} href="#admin" onclick={(e) => tabClick(e, 'admin')} title="Admin"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg><span class="nav-label"> Admin</span></a>
          </li>
        {/if}
      </ul>

      <!-- Views renderen hun eigen tab-section-wrapper (ids nodig voor style.css);
           alleen Account heeft die zelf niet. -->
      {#key ui.refreshTick}
        {#if ui.activeTab === 'dashboard'}
          <Dashboard />
        {:else if ui.activeTab === 'pick'}
          <Pick />
        {:else if ui.activeTab === 'history'}
          <History />
        {:else if ui.activeTab === 'participants'}
          <Peloton />
        {:else if ui.activeTab === 'account'}
          <div class="tab-section active" id="section-account"><Account /></div>
        {:else if ui.activeTab === 'admin'}
          <!-- Admin blijft code-gesplitst: module laadt pas bij het openen van dit tabblad -->
          {#await loadAdmin() then { default: Admin }}
            <Admin />
          {/await}
        {/if}
      {/key}

      <FeedbackBar />
    </div>
  </div>
{/if}

<!-- Speler- & renner-detailmodals (app-breed; renderen alleen als ui.*ModalId gezet is) -->
<PlayerModal />
<RiderModal />

<!-- Foto hover preview -->
<div id="photo-preview" style="position:fixed;z-index:9999;pointer-events:none;border-radius:10px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.5);"
  style:display={previewVisible ? 'block' : 'none'} style:left="{previewLeft}px" style:top="{previewTop}px">
  {#if previewSrc}
    <img id="photo-preview-img" src={previewSrc} alt="" style="display:block;width:140px;height:140px;object-fit:cover;object-position:top;">
  {/if}
</div>
