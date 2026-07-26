<!--
  Admin-panel — port van public/admin.ts + #section-admin uit public/index.html.
  Eén lange component (bewust, zie MIGRATIE-SVELTE.md): gebruikersbeheer, rondes,
  renners, etappes, PCS-sync, resultaten-editor, import-tools en potbeheer.
  Gedrag 1-op-1 met de vanilla-versie; window.x-handlers zijn component-functies.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { state as appState } from '../lib/state.svelte';
  import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/config';
  import { escapeHtml, formatTime, formatGap, toast } from '../lib/utils';
  import { focusTrap } from '../lib/focus-trap';
  import { supaDelete, supaPatch, supaRest, supaRpc, supaUpsert } from '../lib/api';
  import { signup } from '../lib/auth';
  import {
    activeStages, activeScoringMode, applyCompColor, buildPcsStageUrl,
    teamBadge, updateCompBanner, updateCompSelectOptions,
  } from '../lib/helpers';

  // =====================
  // SUB-TAB NAVIGATIE (was: [data-admin]-clickhandlers in app.ts)
  // =====================
  const subTabs = [
    { id: 'admin-users', label: 'Gebruikers' },
    { id: 'admin-competitions', label: 'Rondes' },
    { id: 'admin-riders', label: 'Renners' },
    { id: 'admin-stages', label: 'Etappes' },
    { id: 'admin-results', label: 'Resultaten' },
    { id: 'admin-import', label: 'Import' },
    { id: 'admin-pot', label: 'Pot' },
    { id: 'admin-audit', label: 'Audit-log' },
    { id: 'admin-feedback', label: 'Feedback' },
  ];
  let adminSub = $state('admin-users');

  const typeLabels: Record<string, string> = { flat: 'Vlak', mountain: 'Berg', hills: 'Heuvels', tt: 'Tijdrit', ttt: 'Ploegentijdrit', sprint: 'Sprint' };

  // =====================
  // CROSS-VIEW KOPPELSTUKKEN
  // Dashboard/Peloton-views bestaan (nog) niet als importeerbare modules.
  // Vanilla riep loadStandings()/loadPeloton() aan; hier legen we de caches
  // zodat die views bij (her)opening opnieuw laden.
  // =====================
  function invalidateStandings() {
    appState._cache.standings = null;
    appState._cache.participants = null;
  }
  function invalidatePeloton() {
    appState._cache.allProfiles = null;
  }

  // Lokale kopieën van loadDnfRiderIds/loadRidersForComp uit public/app.ts
  // (horen straks in App.svelte/lib; hier zolang die er nog niet zijn).
  async function loadDnfRiderIds() {
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

  async function loadRidersForComp() {
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
    // (het resetten van #rider-team-filter uit vanilla app.ts is Pick-view-DOM;
    //  Pick.svelte beheert zijn eigen filter-state)
  }

  // =====================
  // ADMIN: GEBRUIKERS
  // =====================
  let adminUsers = $state<any[]>([]);
  let newUserName = $state('');
  let newUserEmail = $state('');
  let newUserPassword = $state('');
  let createUserStatus = $state({ text: '', cls: 'mt-1 d-block' });

  // Uitnodigingslinks
  let inviteCompId = $state<number | null>(null);
  let inviteUrl = $state('');
  let inviteStatus = $state('');
  async function generateInvite() {
    const compId = inviteCompId ?? appState.activeCompId;
    try {
      inviteStatus = 'Bezig…';
      const code = await supaRpc('create_invite', { p_competition_id: compId, p_label: null });
      inviteUrl = `${location.origin}/?invite=${code}`;
      inviteStatus = '';
    } catch (e: any) { inviteStatus = e.message; }
  }
  async function copyInvite() {
    try { await navigator.clipboard.writeText(inviteUrl); inviteStatus = 'Gekopieerd!'; setTimeout(() => inviteStatus = '', 2000); }
    catch { inviteStatus = 'Kopiëren mislukt — selecteer handmatig'; }
  }

  async function loadAdminUsers() {
    adminUsers = await supaRpc('admin_users_with_status');
  }

  function lastSeenText(p: any) {
    return p.last_seen_at
      ? new Date(p.last_seen_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : (p.last_sign_in_at ? new Date(p.last_sign_in_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) + ' (auth)' : '—');
  }

  async function createUser() {
    const name = newUserName.trim();
    const email = newUserEmail.trim();
    const password = newUserPassword;
    if (!name || !email || !password) { createUserStatus = { text: 'Vul alle velden in', cls: 'text-danger' }; return; }
    if (password.length < 6) { createUserStatus = { text: 'Wachtwoord moet minimaal 6 tekens zijn', cls: 'text-danger' }; return; }
    try {
      createUserStatus = { text: 'Aanmaken...', cls: 'text-muted' };
      await signup(email, password, name);
      createUserStatus = { text: `✅ ${name} aangemaakt!`, cls: 'text-success' };
      newUserName = '';
      newUserEmail = '';
      newUserPassword = '';
      loadAdminUsers();
    } catch (e: any) {
      createUserStatus = { text: e.message, cls: 'text-danger' };
    }
  }

  async function confirmUserEmail(userId: string) {
    await supaRpc('admin_confirm_email', { target_user_id: userId });
    loadAdminUsers();
  }

  // toggleAdmin stond in de vanilla-app in views/peloton.ts
  async function toggleAdmin(userId: string, makeAdmin: boolean) {
    try {
      await supaPatch('profiles', `id=eq.${userId}`, { is_admin: makeAdmin });
      invalidatePeloton();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function togglePlayerActive(userId: string, activate: boolean) {
    try {
      await supaPatch('profiles', `id=eq.${userId}`, { is_active: activate });
      loadAdminUsers();
      invalidatePeloton();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function deletePlayer(userId: string, displayName: string) {
    if (!confirm(`Weet je zeker dat je "${displayName}" wilt verwijderen? Dit verwijdert ook alle keuzes van deze speler.`)) return;
    try {
      await supaRpc('admin_delete_player', { p_user_id: userId });
      loadAdminUsers();
      invalidatePeloton();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function resetPassword(email: string) {
    if (!email) { toast('Geen e-mailadres bekend voor deze speler', 'warning'); return; }
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('Verzenden mislukt');
      toast(`Herstelmail verzonden naar ${email}`, 'success');
    } catch (e: any) { toast(e.message, 'error'); }
  }

  // =====================
  // ADMIN: KEUZES VAN ANDERE SPELERS BEWERKEN (modal)
  // =====================
  let picksModal = $state<any>({
    open: false, userId: null as string | null, name: '',
    loading: false, error: '', noStages: false,
    rows: [] as any[], ridersSorted: [] as any[], usedRiderIds: new Set<number>(),
  });

  // Escape sluit de picks-modal zolang die open is
  $effect(() => {
    if (!picksModal.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') picksModal.open = false; };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function openAdminPicks(userId: string, displayName: string) {
    picksModal.open = true;
    picksModal.userId = userId;
    picksModal.name = displayName;
    picksModal.loading = true;
    picksModal.error = '';
    picksModal.noStages = false;
    picksModal.rows = [];
    try {
      const compStages = activeStages();
      if (!compStages.length) {
        picksModal.noStages = true;
        picksModal.loading = false;
        return;
      }
      const stageIds = compStages.map((s: any) => s.id);
      const userPicks = await supaRest('picks', {
        filters: `user_id=eq.${userId}&stage_id=in.(${stageIds.join(',')})`,
      });
      const pickMap = new Map(userPicks.map((p: any) => [p.stage_id, p]));
      picksModal.usedRiderIds = new Set(userPicks.map((p: any) => p.rider_id));

      picksModal.ridersSorted = [...appState.riders].sort((a, b) =>
        (a.team || '').localeCompare(b.team || '') || a.name.localeCompare(b.name)
      );

      picksModal.rows = compStages.map((s: any) => {
        const pick: any = pickMap.get(s.id);
        const currentRider = pick ? appState.riders.find((r: any) => r.id === pick.rider_id) : null;
        return {
          stage: s,
          pick,
          currentRider,
          selRiderId: pick ? pick.rider_id : '',
          late: pick ? !!pick.is_late : false,
        };
      });
      picksModal.loading = false;
    } catch (e: any) {
      picksModal.error = e.message;
      picksModal.loading = false;
    }
  }

  async function saveAdminPick(row: any) {
    const riderId = parseInt(String(row.selRiderId), 10);
    if (!riderId) { toast('Kies een renner', 'warning'); return; }
    try {
      await supaRpc('admin_upsert_pick', {
        p_user_id: picksModal.userId,
        p_stage_id: row.stage.id,
        p_rider_id: riderId,
        p_is_late: !!row.late,
      });
      toast('Keuze opgeslagen — scores herverdeeld', 'success');
      openAdminPicks(picksModal.userId, picksModal.name);
      invalidateStandings();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function deleteAdminPick(row: any) {
    if (!confirm('Keuze verwijderen?')) return;
    try {
      await supaRpc('admin_delete_pick', { p_user_id: picksModal.userId, p_stage_id: row.stage.id });
      toast('Keuze verwijderd', 'success');
      openAdminPicks(picksModal.userId, picksModal.name);
      invalidateStandings();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  // =====================
  // ADMIN: COMPETITIES
  // =====================
  let newCompName = $state('');
  let newCompSlug = $state('');
  let newCompYear = $state('2025');
  let newCompScoringMode = $state('grand_tour');
  let newCompOneDay = $state(false);
  let newCompPcsUrl = $state('');
  let newCompColor = $state('#facc15');
  let newCompFlag = $state('');

  async function loadAdminCompetitions() {
    appState.competitions = await supaRest('competitions', { filters: 'order=year.desc,name' });
    // Navbar-selects (comp-select) worden door de app-shell gerenderd; zolang
    // die (nog) niet gemount is mogen deze DOM-helpers stil falen.
    try { updateCompSelectOptions(); } catch { /* shell nog niet geport */ }
  }

  async function updateCompField(compId: number, field: string, value: any) {
    try {
      await supaPatch('competitions', `id=eq.${compId}`, { [field]: value || null });
      const comp = appState.competitions.find((c: any) => c.id === compId);
      if (comp) comp[field] = value;
      if (field === 'color' || field === 'country_flag' || field === 'logo_url') {
        try { updateCompBanner(); applyCompColor(); } catch { /* shell nog niet geport */ }
      }
      if (field === 'scoring_mode') {
        invalidateStandings();
      }
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function updateCompPcsUrl(compId: number, pcsUrl: string) {
    try {
      await supaPatch('competitions', `id=eq.${compId}`, { pcs_url: pcsUrl.trim() || null });
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function addComp() {
    const name = newCompName.trim();
    const slug = newCompSlug.trim();
    const year = parseInt(newCompYear);
    if (!name || !slug || !year) return toast('Vul alle velden in', 'warning');
    try {
      const scoringMode = newCompScoringMode || 'grand_tour';
      const isOneDay = newCompOneDay;
      const pcsUrl = newCompPcsUrl.trim() || null;
      const color = newCompColor || '#facc15';
      const flag = newCompFlag.trim() || '';
      await supaRest('competitions', { method: 'POST', body: { name, slug, competition_type: scoringMode === 'classic' ? 'classic' : 'tour', year, is_active: false, scoring_mode: scoringMode, is_one_day: isOneDay, pcs_url: pcsUrl, color, country_flag: flag } });
      newCompName = '';
      newCompSlug = '';
      newCompPcsUrl = '';
      newCompColor = '#facc15';
      newCompFlag = '';
      loadAdminCompetitions();
      loadAdminStages();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function renameComp(compId: number, newName: string) {
    newName = newName.trim();
    if (!newName) return toast('Naam mag niet leeg zijn', 'warning');
    try {
      await supaPatch('competitions', `id=eq.${compId}`, { name: newName });
      loadAdminCompetitions();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function toggleCompActive(compId: number, active: boolean) {
    try {
      await supaPatch('competitions', `id=eq.${compId}`, { is_active: active });
      loadAdminCompetitions();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function deleteComp(compId: number) {
    if (!confirm('Weet je het zeker? Dit verwijdert de ronde.')) return;
    try {
      await supaDelete('competitions', `id=eq.${compId}`);
      loadAdminCompetitions();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  // =====================
  // ADMIN: POT
  // =====================
  let potCompId = $state<number | null>(null);
  let potLoaded = $state(false);
  let paidMap = $state<Record<string, boolean>>({});
  let potProfiles = $state<any[]>([]);

  const potComp = $derived(appState.competitions.find((c: any) => c.id === potCompId));
  const potEntryFee = $derived(potComp?.entry_fee);
  const potPaidCount = $derived(Object.values(paidMap).filter(Boolean).length);
  const potTotal = $derived(potEntryFee ? potPaidCount * potEntryFee : 0);

  async function loadAdminPot() {
    if (potCompId == null) {
      // Selecteer actieve ronde standaard (vanilla: sel.value = activeCompId)
      if (appState.activeCompId && appState.competitions.some((c: any) => c.id === appState.activeCompId)) {
        potCompId = appState.activeCompId;
      } else {
        potCompId = appState.competitions[0]?.id ?? null;
      }
    }
    if (!potCompId) return;

    const participants = await supaRest('competition_participants', {
      select: 'user_id,has_paid',
      filters: `competition_id=eq.${potCompId}`,
    });
    const map: Record<string, boolean> = {};
    (participants || []).forEach((p: any) => { map[p.user_id] = p.has_paid; });
    paidMap = map;

    potProfiles = appState._cache.allProfiles || await supaRest('profiles', { filters: 'is_active=eq.true&order=display_name' });
    potLoaded = true;
  }

  async function togglePotPayment(compId: number, userId: string, paid: boolean) {
    try {
      await supaUpsert('competition_participants', {
        competition_id: compId,
        user_id: userId,
        has_paid: paid,
        paid_at: paid ? new Date().toISOString() : null,
      });
      paidMap[userId] = paid;
      const comp = appState.competitions.find((c: any) => c.id === compId);
      if (comp?.entry_fee) {
        // Badge bijwerken zonder volledige herlaad
        loadAdminPot();
      }
    } catch (e: any) { toast(e.message, 'error'); }
  }

  // =====================
  // ADMIN: AUDIT-LOG (wie wijzigde welke pick, wanneer, via welke route)
  // =====================
  let auditRows = $state<any[]>([]);
  let auditLoaded = $state(false);
  let auditProfileMap = $state<Record<string, string>>({});
  let auditStageMap = $state<Record<number, string>>({});
  let auditRiderMap = $state<Record<number, string>>({});

  const auditActionLabels: Record<string, string> = { insert: 'nieuw', update: 'gewijzigd', delete: 'verwijderd' };

  async function loadAdminAudit() {
    const rows = await supaRest('pick_audit_log', { filters: 'order=changed_at.desc&limit=200' });
    auditRows = rows || [];

    const userIds = new Set<string>();
    const stageIds = new Set<number>();
    const riderIds = new Set<number>();
    auditRows.forEach((r: any) => {
      userIds.add(r.user_id);
      if (r.changed_by) userIds.add(r.changed_by);
      stageIds.add(r.stage_id);
      if (r.rider_id) riderIds.add(r.rider_id);
      if (r.old_rider_id) riderIds.add(r.old_rider_id);
    });

    const [profiles, stages, riders] = await Promise.all([
      userIds.size ? supaRest('profiles', { select: 'id,display_name,email', filters: `id=in.(${[...userIds].join(',')})` }) : [],
      stageIds.size ? supaRest('stages', { select: 'id,stage_number,name', filters: `id=in.(${[...stageIds].join(',')})` }) : [],
      riderIds.size ? supaRest('riders', { select: 'id,name', filters: `id=in.(${[...riderIds].join(',')})` }) : [],
    ]);

    auditProfileMap = {};
    (profiles || []).forEach((p: any) => { auditProfileMap[p.id] = p.display_name || p.email || p.id; });
    auditStageMap = {};
    (stages || []).forEach((s: any) => { auditStageMap[s.id] = s.name ? `E${s.stage_number} — ${s.name}` : `E${s.stage_number}`; });
    auditRiderMap = {};
    (riders || []).forEach((r: any) => { auditRiderMap[r.id] = r.name; });

    auditLoaded = true;
  }

  // --- Feedback ---
  let feedbackRows = $state<any[]>([]);
  let feedbackLoaded = $state(false);

  async function loadFeedback() {
    const rows = await supaRest('feedback', {
      select: 'id,message,context,created_at,resolved,profiles(display_name)',
      filters: 'order=created_at.desc&limit=200',
    });
    feedbackRows = rows || [];
    feedbackLoaded = true;
  }

  async function toggleFeedbackResolved(row: any) {
    try {
      await supaPatch('feedback', `id=eq.${row.id}`, { resolved: !row.resolved });
      row.resolved = !row.resolved;
    } catch (e: any) { toast('Bijwerken mislukte: ' + (e?.message || ''), 'error'); }
  }

  async function deleteFeedback(row: any) {
    if (!confirm('Dit bericht verwijderen?')) return;
    try {
      await supaDelete('feedback', `id=eq.${row.id}`);
      feedbackRows = feedbackRows.filter((r) => r.id !== row.id);
    } catch (e: any) { toast('Verwijderen mislukte: ' + (e?.message || ''), 'error'); }
  }

  // =====================
  // ADMIN: RENNERS
  // =====================
  let riderCompFilter = $state<any>('');
  let riderSearch = $state('');
  let riderFilter = $state('');
  let _adminSearchDebounce: any;
  let newRiderBib = $state('');
  let newRiderName = $state('');
  let newRiderTeam = $state('');

  const filteredRiders = $derived(riderFilter
    ? appState.allRiders.filter((r: any) => r.name.toLowerCase().includes(riderFilter) || r.team.toLowerCase().includes(riderFilter))
    : appState.allRiders);

  async function loadAdminRiders() {
    const compId = riderCompFilter;
    appState.allRiders = await supaRest('riders', {
      filters: compId ? `competition_id=eq.${compId}&order=bib_number` : 'order=bib_number',
    });
  }

  function onRiderSearchInput() {
    clearTimeout(_adminSearchDebounce);
    _adminSearchDebounce = setTimeout(() => { riderFilter = riderSearch.toLowerCase(); }, 200);
  }

  async function addRider() {
    const bib = parseInt(newRiderBib);
    const name = newRiderName.trim();
    const team = newRiderTeam.trim();
    const compId = parseInt(String(riderCompFilter)) || appState.activeCompId;
    if (!bib || !name || !team) return toast('Vul alle velden in', 'warning');
    if (!compId) return toast('Selecteer eerst een ronde', 'warning');
    try {
      await supaRest('riders', { method: 'POST', body: { bib_number: bib, name, team, competition_id: compId } });
      newRiderBib = '';
      newRiderName = '';
      newRiderTeam = '';
      loadAdminRiders();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function deleteRider(riderId: number) {
    if (!confirm('Renner verwijderen?')) return;
    try {
      await supaDelete('riders', `id=eq.${riderId}`);
      loadAdminRiders();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function resetRiderPhoto(riderId: number) {
    try {
      await supaPatch('riders', `id=eq.${riderId}`, { photo_url: null });
      toast('Foto gereset — sync opnieuw om nieuwe foto op te halen', 'success');
      loadAdminRiders();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function toggleRiderDnf(riderId: number, currentDnf: boolean) {
    try {
      await supaPatch('riders', `id=eq.${riderId}`, { dnf: !currentDnf });
      await loadDnfRiderIds();
      loadAdminRiders();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  // =====================
  // ADMIN: ETAPPES
  // =====================
  let newStageNum = $state('');
  let newStageName = $state('');
  let newStageDate = $state('');
  let newStageStartTime = $state('12:00');
  let newStageType = $state('flat');
  let newStageCompId = $state<any>(null);

  async function loadAdminStages() {
    appState.stages = await supaRest('stages', { filters: 'order=stage_number' });
  }

  function winnerTimeVal(s: any) {
    return s.winner_time_seconds
      ? `${Math.floor(s.winner_time_seconds / 60)}:${String(s.winner_time_seconds % 60).padStart(2, '0')}`
      : '';
  }

  async function addStage() {
    const num = parseInt(newStageNum);
    const name = newStageName.trim();
    const date = newStageDate;
    const startTime = newStageStartTime || '12:00';
    const type = newStageType;
    const compId = parseInt(String(newStageCompId));
    if (isNaN(num) || !name || !date || !compId) return toast('Vul alle velden in', 'warning');

    const startDateTime = new Date(`${date}T${startTime}:00`);

    try {
      await supaRest('stages', {
        method: 'POST',
        body: { stage_number: num, name, date, stage_type: type, start_time: startDateTime.toISOString(), deadline: startDateTime.toISOString(), locked: false, competition_id: compId },
      });
      newStageNum = '';
      newStageName = '';
      newStageDate = '';
      loadAdminStages();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function toggleStageLock(stageId: number, lock: boolean) {
    try {
      await supaPatch('stages', `id=eq.${stageId}`, { locked: lock });
      loadAdminStages();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function deleteStage(stageId: number) {
    if (!confirm('Etappe verwijderen?')) return;
    try {
      await supaDelete('stages', `id=eq.${stageId}`);
      loadAdminStages();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function updateStagePcsUrl(stageId: number, pcsUrl: string) {
    try {
      await supaPatch('stages', `id=eq.${stageId}`, { pcs_url: pcsUrl.trim() || null });
      const stage = appState.stages.find((s: any) => s.id === stageId);
      if (stage) stage.pcs_url = pcsUrl.trim() || null;
      loadAdminStages();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function updateStageWinnerTime(stageId: number, timeStr: string) {
    const clean = timeStr.trim();
    let secs: number | null = null;
    if (clean) {
      const parts = clean.split(':').map(Number);
      secs = parts.length === 2 ? parts[0] * 60 + parts[1] : parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : Number(parts[0]);
      if (isNaN(secs) || secs <= 0) { toast('Ongeldige tijd (gebruik M:SS of H:MM:SS)', 'error'); return; }
    }
    try {
      await supaPatch('stages', `id=eq.${stageId}`, { winner_time_seconds: secs });
      const stage = appState.stages.find((s: any) => s.id === stageId);
      if (stage) stage.winner_time_seconds = secs;
      toast('Winnaarstijd opgeslagen', 'success');
    } catch (e: any) { toast(e.message, 'error'); }
  }

  // Starttijd (= deadline) van een bestaande etappe — toont lokale uu:mm.
  function stageTimeVal(s: any): string {
    if (!s.start_time) return '';
    const d = new Date(s.start_time);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  async function updateStageStartTime(s: any, timeStr: string) {
    const clean = (timeStr || '').trim();
    if (!clean) return;
    // Ingevoerde tijd is lokale (browser)tijd; combineer met de etappedatum en sla
    // als UTC op. start_time = deadline (spelconventie: deadline is de starttijd).
    const datePart = String(s.date).slice(0, 10);
    const dt = new Date(`${datePart}T${clean}:00`);
    if (isNaN(dt.getTime())) { toast('Ongeldige tijd (uu:mm)', 'error'); return; }
    const iso = dt.toISOString();
    try {
      await supaPatch('stages', `id=eq.${s.id}`, { start_time: iso, deadline: iso });
      const stage = appState.stages.find((x: any) => x.id === s.id);
      if (stage) { stage.start_time = iso; stage.deadline = iso; }
      toast('Starttijd bijgewerkt', 'success');
    } catch (e: any) { toast(e.message, 'error'); }
  }

  // =====================
  // PCS DIRECTE SYNC (edge functions)
  // =====================
  async function callEdgeFunction(fnName: string, body: any) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appState.session?.access_token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Fout ${res.status}`);
    return data;
  }

  // Status/log van de "Ronde klaarzetten"-kaart (Import-tab)
  let pcsSyncStatus = $state({ text: '', cls: '' });
  let pcsSyncLog = $state('');
  let raceSyncCompId = $state<any>(null);
  let startlistBusy = $state(false);

  async function syncStageFromPcs(stageId: number, compId: number) {
    pcsSyncStatus = { text: '⏳ Etappe syncen met PCS...', cls: 'text-muted' };
    pcsSyncLog = '';
    try {
      const result = await callEdgeFunction('sync-pcs-race', {
        competition_id: compId,
        stage_id: stageId,
      });

      if (result.shirts && Object.keys(result.shirts).length) {
        const existingShirts = JSON.parse(localStorage.getItem('bagagedrager_shirts') || '{}');
        localStorage.setItem('bagagedrager_shirts', JSON.stringify({ ...existingShirts, ...result.shirts }));
      }

      pcsSyncStatus = { text: '✅ Etappe sync voltooid!', cls: 'text-success' };
      pcsSyncLog = (result.log || []).join('<br>');

      loadAdminStages();
      loadAdminRiders();
      await loadRidersForComp();
    } catch (e: any) {
      pcsSyncStatus = { text: e.message, cls: 'text-danger' };
    }
  }

  async function syncRace() {
    const compId = parseInt(String(raceSyncCompId));
    const comp = appState.competitions.find((c: any) => c.id === compId);

    if (!comp) { pcsSyncStatus = { text: 'Kies een ronde', cls: 'text-danger' }; return; }
    if (!comp.pcs_url) { pcsSyncStatus = { text: 'Stel eerst een PCS URL in bij de ronde', cls: 'text-danger' }; return; }

    pcsSyncStatus = { text: '⏳ Bezig met ophalen van PCS...', cls: 'text-muted' };
    pcsSyncLog = '';

    try {
      const result = await callEdgeFunction('sync-pcs-race', {
        pcs_url: comp.pcs_url,
        competition_id: compId,
      });

      if (result.shirts && Object.keys(result.shirts).length) {
        const existingShirts = JSON.parse(localStorage.getItem('bagagedrager_shirts') || '{}');
        localStorage.setItem('bagagedrager_shirts', JSON.stringify({ ...existingShirts, ...result.shirts }));
      }

      pcsSyncStatus = { text: '✅ Sync voltooid!', cls: 'text-success' };
      pcsSyncLog = (result.log || []).join('<br>');

      loadAdminStages();
      loadAdminRiders();
      await loadRidersForComp();
    } catch (e: any) {
      pcsSyncStatus = { text: e.message, cls: 'text-danger' };
    }
  }

  async function syncStartlist() {
    const compId = parseInt(String(raceSyncCompId));
    const comp = appState.competitions.find((c: any) => c.id === compId);

    if (!comp) { pcsSyncStatus = { text: 'Kies een ronde', cls: 'text-danger' }; return; }
    if (!comp.pcs_url) { pcsSyncStatus = { text: 'Stel eerst een PCS URL in bij de ronde', cls: 'text-danger' }; return; }

    startlistBusy = true;
    pcsSyncStatus = { text: '', cls: '' };
    pcsSyncLog = '';

    try {
      const result = await callEdgeFunction('sync-pcs-race', {
        pcs_url: comp.pcs_url,
        competition_id: compId,
        startlist_only: true,
      });
      pcsSyncStatus = { text: '✅ Startlijst bijgewerkt!', cls: 'text-success' };
      pcsSyncLog = (result.log || []).join('<br>');
      loadAdminRiders();
      await loadRidersForComp();
    } catch (e: any) {
      pcsSyncStatus = { text: e.message, cls: 'text-danger' };
    } finally {
      startlistBusy = false;
    }
  }

  // Foto's ophalen in batches van 25
  async function syncPhotos() {
    const compId = parseInt(String(raceSyncCompId));
    if (!compId) { pcsSyncStatus = { text: 'Kies een ronde', cls: 'text-danger' }; return; }

    pcsSyncStatus = { text: '📸 Foto\'s ophalen...', cls: 'text-muted' };

    try {
      const result = await callEdgeFunction('sync-pcs-photos', { competition_id: compId });
      pcsSyncStatus = { text: result.message, cls: 'text-success' };
      if (result.log?.length) {
        pcsSyncLog = result.log.join('<br>');
      }
      if (result.remaining > 0) {
        pcsSyncStatus = { text: result.message + ' — klik nogmaals voor de rest', cls: 'text-warning' };
      }
      await loadRidersForComp();
    } catch (e: any) {
      pcsSyncStatus = { text: e.message, cls: 'text-danger' };
    }
  }

  // =====================
  // PCS RESULTATEN SYNC
  // =====================
  let syncStageId = $state<any>(null);
  let pcsResultsStatus = $state({ text: '', cls: '' });
  let pcsResultsLog = $state('');
  let pcsResultsLogEl: HTMLElement | undefined = $state();

  async function appendResultsLog(html: string) {
    pcsResultsLog += html;
    await tick();
    if (pcsResultsLogEl) pcsResultsLogEl.scrollTop = pcsResultsLogEl.scrollHeight;
  }

  // Koppel PCS-resultaat aan rider_id. Bij duplicates (zelfde pcs_slug, meerdere
  // rider entries) gaat pcs_slug-match voor bib-match, en gepickte riders voor
  // niet-gepickte — zodat de juiste rider_id wordt gebruikt.
  async function buildPcsPayload(results: any[], stageId: number) {
    const stagePicks = await supaRest('picks', { select: 'rider_id', filters: `stage_id=eq.${stageId}` });
    const pickedIds = new Set<number>(stagePicks.map((p: any) => p.rider_id as number));

    function matchRider(r: any) {
      if (r.pcs_slug) {
        const hit = appState.riders.find((rd: any) => rd.pcs_slug === r.pcs_slug && pickedIds.has(rd.id));
        if (hit) return hit;
        const fallback = appState.riders.find((rd: any) => rd.pcs_slug === r.pcs_slug);
        if (fallback) return fallback;
      }
      if (r.bib_number) {
        const hit = appState.riders.find((rd: any) => rd.bib_number === r.bib_number && pickedIds.has(rd.id));
        if (hit) return hit;
        return appState.riders.find((rd: any) => rd.bib_number === r.bib_number);
      }
      return undefined;
    }

    let matched = 0, unmatched = 0;
    const payload: any[] = [];
    for (const r of results) {
      const rider = matchRider(r);
      if (rider) {
        matched++;
        payload.push({ rider_id: rider.id, time_seconds: r.time_seconds, finish_position: r.finish_position || null, points: r.points, mountain_points: r.mountain_points, bonification_seconds: r.bonification_seconds || 0, dnf: r.dnf });
      } else { unmatched++; }
    }
    return { payload, matched, unmatched };
  }

  function top10LogHtml(results: any[], header: string) {
    const pcsWinnerTime = results[0]?.time_seconds || 0;
    const top10PCS = results.slice(0, 10);
    return `<strong>${header}</strong><br>` + top10PCS.map((r: any, i: number) => {
      // pcs_slug altijd eerst over álle kandidaten checken, bib_number pas als fallback —
      // anders wint een toevallige bib-coincidentie (PCS-bib vs ons eigen sequentiële bib) van de juiste slug-match.
      const rider = (r.pcs_slug && appState.riders.find((rd: any) => rd.pcs_slug === r.pcs_slug))
        || (r.bib_number && appState.riders.find((rd: any) => rd.bib_number === r.bib_number));
      const timeDisplay = i === 0 ? formatTime(r.time_seconds) : formatGap(r.time_seconds - pcsWinnerTime);
      const matchMark = rider ? '' : ' ⚠️ niet in startlijst';
      return `${i + 1}. ${rider?.name || r.pcs_slug || '?'} — ${timeDisplay}${r.dnf ? ' (DNF)' : ''}${matchMark}`;
    }).join('<br>');
  }

  async function syncResults() {
    const stageId = parseInt(String(syncStageId));
    const stage = appState.stages.find((s: any) => s.id === stageId);

    if (!stage) { pcsResultsStatus = { text: 'Kies een etappe', cls: 'text-danger' }; return; }

    const comp = appState.competitions.find((c: any) => c.id === stage.competition_id);
    if (!comp?.pcs_url && !stage.pcs_url) { pcsResultsStatus = { text: 'Geen PCS URL ingesteld voor deze ronde of etappe', cls: 'text-danger' }; return; }

    const pcsUrl = buildPcsStageUrl(comp, stage.stage_number, stage);

    pcsResultsStatus = { text: '⏳ Resultaten ophalen van PCS...', cls: 'text-muted' };
    pcsResultsLog = '';

    try {
      const data = await callEdgeFunction('sync-pcs-results', { pcs_url: pcsUrl });

      if (!data.results?.length) {
        pcsResultsStatus = { text: 'Geen resultaten gevonden op PCS', cls: 'text-warning' };
        return;
      }

      // Match riders: pcs_slug vóór bib, gepickte riders vóór andere
      const { payload, matched, unmatched } = await buildPcsPayload(data.results, stageId);

      if (!matched) {
        pcsResultsStatus = { text: `Geen renners gekoppeld (${unmatched} onbekend)`, cls: 'text-danger' };
        return;
      }

      pcsResultsStatus = { text: `⏳ ${matched} resultaten opslaan...`, cls: pcsResultsStatus.cls };
      await supaRpc('admin_save_results', { p_stage_id: stageId, p_results: payload });

      // Sla de echte PCS-winnaarstijd op bij de etappe (ook als die renner niet in riders staat)
      // Gebruik ALLEEN pcs_slug voor de koppeling — bibnummers zijn race-specifiek en
      // matchen niet betrouwbaar op onze interne sequentiële bibs.
      const pcsWinner = data.results[0];
      if (pcsWinner && pcsWinner.time_seconds > 0) {
        const winnerRider = pcsWinner.pcs_slug
          ? appState.riders.find((rd: any) => rd.pcs_slug === pcsWinner.pcs_slug)
          : null;
        await supaPatch('stages', `id=eq.${stageId}`, {
          winner_time_seconds: pcsWinner.time_seconds,
          winner_name: winnerRider?.name || pcsWinner.pcs_name || null,
        });
        // Herlaad stages zodat winner_name direct zichtbaar is
        appState.stages = await supaRest('stages', { filters: 'order=stage_number' });
      }

      await supaPatch('competitions', `id=eq.${appState.activeCompId}`, { last_synced_at: new Date().toISOString() });

      pcsResultsStatus = { text: `✅ ${matched} resultaten opgeslagen!` + (unmatched ? ` (${unmatched} onbekend)` : ''), cls: 'text-success' };

      // Toon Top 10 gebaseerd op PCS-uitslag (niet op payload-volgorde)
      pcsResultsLog = top10LogHtml(data.results, 'Top 10 (PCS):');

      loadAdminResults();
    } catch (e: any) {
      pcsResultsStatus = { text: e.message, cls: 'text-danger' };
    }
  }

  // Force sync: overschrijft ook manually_edited=true rows (p_manual=true)
  // Gebruik dit als de normale sync verkeerde data heeft opgeslagen (bijv. verkeerde tab gepakt).
  async function forceSyncResults() {
    const stageId = parseInt(String(syncStageId));
    const stage = appState.stages.find((s: any) => s.id === stageId);

    if (!stage) { pcsResultsStatus = { text: 'Kies een etappe', cls: 'text-danger' }; return; }

    const comp = appState.competitions.find((c: any) => c.id === stage.competition_id);
    if (!comp?.pcs_url && !stage.pcs_url) { pcsResultsStatus = { text: 'Geen PCS URL ingesteld', cls: 'text-danger' }; return; }

    if (!confirm(`⚠️ FORCE SYNC: etappe ${stage.stage_number || 'P'} (${stage.name})\n\nDit overschrijft ALLE opgeslagen uitslagen voor deze etappe, ook handmatig bewerkte. Gebruik dit alleen als de normale sync verkeerde data heeft opgeslagen.\n\nDoorgaan?`)) return;

    const pcsUrl = buildPcsStageUrl(comp, stage.stage_number, stage);
    pcsResultsStatus = { text: '⏳ Resultaten ophalen van PCS...', cls: 'text-muted' };
    pcsResultsLog = '';

    try {
      const data = await callEdgeFunction('sync-pcs-results', { pcs_url: pcsUrl });

      if (!data.results?.length) {
        pcsResultsStatus = { text: 'Geen resultaten gevonden op PCS', cls: 'text-warning' };
        return;
      }

      const { payload, matched, unmatched } = await buildPcsPayload(data.results, stageId);

      if (!matched) {
        pcsResultsStatus = { text: `Geen renners gekoppeld (${unmatched} onbekend)`, cls: 'text-danger' };
        return;
      }

      pcsResultsStatus = { text: `⏳ ${matched} resultaten opslaan (force)...`, cls: pcsResultsStatus.cls };
      // p_manual: true → overschrijft ook manually_edited=true rows
      await supaRpc('admin_save_results', { p_stage_id: stageId, p_results: payload, p_manual: true });

      const pcsWinner = data.results[0];
      if (pcsWinner && pcsWinner.time_seconds > 0) {
        const winnerRider = pcsWinner.pcs_slug
          ? appState.riders.find((rd: any) => rd.pcs_slug === pcsWinner.pcs_slug)
          : null;
        await supaPatch('stages', `id=eq.${stageId}`, {
          winner_time_seconds: pcsWinner.time_seconds,
          winner_name: winnerRider?.name || pcsWinner.pcs_name || null,
        });
        appState.stages = await supaRest('stages', { filters: 'order=stage_number' });
      }

      await supaPatch('competitions', `id=eq.${appState.activeCompId}`, { last_synced_at: new Date().toISOString() });

      pcsResultsStatus = { text: `✅ Force sync: ${matched} resultaten overschreven!` + (unmatched ? ` (${unmatched} onbekend)` : ''), cls: 'text-success' };

      pcsResultsLog = top10LogHtml(data.results, 'Top 10 (PCS, na force sync):');

      loadAdminResults();
    } catch (e: any) {
      pcsResultsStatus = { text: e.message, cls: 'text-danger' };
    }
  }

  // Resync all locked stages with results from PCS
  async function resyncAll() {
    const comp = appState.competitions.find((c: any) => c.id === appState.activeCompId);
    const hasAnyPcsUrl = comp?.pcs_url || activeStages().some((s: any) => s.pcs_url);
    if (!hasAnyPcsUrl) { toast('Geen PCS URL ingesteld voor deze ronde of etappes', 'warning'); return; }
    if (!confirm('Alle vergrendelde etappes opnieuw syncen met PCS? Dit kan even duren.')) return;

    const lockedStages = activeStages().filter((s: any) => s.locked);

    pcsResultsLog = '';
    let success = 0, failed = 0;

    for (const stage of lockedStages) {
      const pcsUrl = buildPcsStageUrl(comp, stage.stage_number, stage);
      if (!pcsUrl) { await appendResultsLog(`<div class="text-warning">⚠ Etappe ${stage.stage_number}: geen PCS URL</div>`); failed++; continue; }
      pcsResultsStatus = { text: `⏳ Etappe ${stage.stage_number} syncen...`, cls: 'text-muted' };
      await appendResultsLog(`<div>⏳ Etappe ${stage.stage_number}...</div>`);

      try {
        const data = await callEdgeFunction('sync-pcs-results', { pcs_url: pcsUrl });
        if (!data.results?.length) {
          await appendResultsLog(`<div class="text-warning">⚠ Etappe ${stage.stage_number}: geen resultaten</div>`);
          failed++;
          continue;
        }

        const { payload, matched } = await buildPcsPayload(data.results, stage.id);

        if (matched) {
          await supaRpc('admin_save_results', { p_stage_id: stage.id, p_results: payload });
          await appendResultsLog(`<div class="text-success">✅ Etappe ${stage.stage_number}: ${matched} resultaten</div>`);
          success++;
        } else {
          await appendResultsLog(`<div class="text-warning">⚠ Etappe ${stage.stage_number}: geen renners gekoppeld</div>`);
          failed++;
        }
      } catch (e: any) {
        await appendResultsLog(`<div class="text-danger">❌ Etappe ${stage.stage_number}: ${e.message}</div>`);
        failed++;
      }

      // Small delay to not overwhelm PCS
      await new Promise(r => setTimeout(r, 1500));
    }

    pcsResultsStatus = { text: `✅ Klaar! ${success} gelukt, ${failed} mislukt van ${lockedStages.length} etappes`, cls: success > 0 ? 'text-success' : 'text-danger' };
    appState._cache.standings = null;
    appState._cache.participants = null;
  }

  // Auto-sync: sync etappes waarvan de geschatte eindtijd voorbij is
  async function autoSync() {
    const comp = appState.competitions.find((c: any) => c.id === appState.activeCompId);
    const hasAnyPcsUrl2 = comp?.pcs_url || activeStages().some((s: any) => s.pcs_url);
    if (!hasAnyPcsUrl2) { toast('Geen PCS URL ingesteld voor deze ronde of etappes', 'warning'); return; }

    const now = new Date();
    const readyStages = activeStages().filter((s: any) =>
      !s.locked && s.estimated_end_time && new Date(s.estimated_end_time) < now
    );

    if (!readyStages.length) {
      toast('Geen etappes klaar om te syncen (ETA nog niet bereikt)', 'info');
      return;
    }

    pcsResultsLog = '';
    let success = 0, failed = 0;

    for (const stage of readyStages) {
      const pcsUrl = buildPcsStageUrl(comp, stage.stage_number, stage);
      if (!pcsUrl) { await appendResultsLog(`<div class="text-warning">⚠ Etappe ${stage.stage_number}: geen PCS URL</div>`); failed++; continue; }
      pcsResultsStatus = { text: `⏳ Auto-sync etappe ${stage.stage_number}...`, cls: 'text-muted' };
      await appendResultsLog(`<div>⏳ Etappe ${stage.stage_number} (ETA: ${new Date(stage.estimated_end_time).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })})...</div>`);

      try {
        const data = await callEdgeFunction('sync-pcs-results', { pcs_url: pcsUrl });
        if (!data.results?.length) {
          await appendResultsLog(`<div class="text-warning">⚠ Etappe ${stage.stage_number}: nog geen resultaten op PCS</div>`);
          failed++;
          continue;
        }

        const { payload, matched } = await buildPcsPayload(data.results, stage.id);

        if (matched) {
          await supaRpc('admin_save_results', { p_stage_id: stage.id, p_results: payload });
          await appendResultsLog(`<div class="text-success">✅ Etappe ${stage.stage_number}: ${matched} resultaten opgeslagen</div>`);
          success++;
        } else {
          await appendResultsLog(`<div class="text-warning">⚠ Etappe ${stage.stage_number}: geen renners gekoppeld</div>`);
          failed++;
        }
      } catch (e: any) {
        await appendResultsLog(`<div class="text-danger">❌ Etappe ${stage.stage_number}: ${e.message}</div>`);
        failed++;
      }

      await new Promise(r => setTimeout(r, 1500));
    }

    pcsResultsStatus = { text: `✅ Auto-sync klaar! ${success} gelukt, ${failed} mislukt`, cls: success > 0 ? 'text-success' : 'text-danger' };
    if (success > 0) {
      appState._cache.standings = null;
      appState._cache.participants = null;
      toast(`${success} etappe(s) automatisch gesynct`, 'success');
      loadAdminResults();
    }
  }

  // =====================
  // ADMIN: RESULTATEN PLAKKEN (console script fallback)
  // =====================
  const PCS_RESULTS_SCRIPT = `// Plak dit in de console op een PCS etappe-resultaten pagina
(() => {
  const table = document.querySelector('table.results');
  if (!table) { console.log('Geen resultaten-tabel gevonden!'); return; }
  const rows = table.querySelectorAll('tbody tr');
  const results = [];
  let lastTime = '';
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length < 8) return;
    let bib = 0, time = '', pts = 0, dnf = false;
    cells.forEach(c => {
      const cls = c.className || '';
      const txt = c.textContent?.trim() || '';
      if (cls.includes('bibs')) bib = parseInt(txt) || 0;
      if (cls.includes('time') && cls.includes('ar')) {
        const font = c.querySelector('font');
        const t = font?.textContent?.trim() || txt;
        if (t.match(/DNF|DNS|OTL/i)) { dnf = true; }
        else if (t.match(/\\d+:\\d+/)) { time = t; lastTime = t; }
        else { time = lastTime; }
      }
      if (cls.includes('pnt') && !cls.includes('uci')) pts = parseInt(txt) || 0;
    });
    if (bib > 0) results.push(bib + ',' + time + ',' + pts + ',' + (dnf ? 'DNF' : ''));
  });
  copy('---RESULTATEN---\\n' + results.join('\\n'));
  console.log(results.length + ' resultaten gekopieerd naar clipboard!');
})();`;

  let copyResultsLabel = $state('📋 Kopieer resultaten-script');
  let resultsSyncData = $state('');
  let resultsSyncStatus = $state({ text: '', cls: '' });
  let resultsSyncPreview = $state('');

  function copyResultsScript() {
    navigator.clipboard.writeText(PCS_RESULTS_SCRIPT);
    copyResultsLabel = '✅ Gekopieerd!';
    setTimeout(() => { copyResultsLabel = '📋 Kopieer resultaten-script'; }, 2000);
  }

  function parseTimeToSeconds(timeStr: string) {
    const clean = timeStr.replace(/[^0-9:]/g, '').trim();
    if (!clean) return 0;
    const parts = clean.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  }

  async function importPastedResults() {
    const raw = resultsSyncData.trim();
    const stageId = parseInt(String(syncStageId));

    if (!raw) { resultsSyncStatus = { text: 'Plak eerst data', cls: 'text-danger' }; return; }
    if (!stageId) { resultsSyncStatus = { text: 'Selecteer een etappe', cls: 'text-danger' }; return; }

    const text = raw.replace('---RESULTATEN---', '').trim();
    const lines = text.split('\n').filter(l => l.trim());

    // Parse results: bib,time,pts,DNF
    const parsed = lines.map(line => {
      const parts = line.split(',');
      if (parts.length < 2) return null;
      const bib = parseInt(parts[0].trim());
      const time = parseTimeToSeconds(parts[1].trim());
      const pts = parseInt(parts[2]?.trim()) || 0;
      const dnf = (parts[3]?.trim() || '').toUpperCase() === 'DNF';
      if (!bib) return null;
      return { bib_number: bib, time_seconds: time, points: pts, mountain_points: 0, dnf };
    }).filter(Boolean) as any[];

    if (!parsed.length) { resultsSyncStatus = { text: 'Geen geldige resultaten gevonden', cls: 'text-danger' }; return; }

    // Match to riders
    let matched = 0, unmatched = 0;
    const payload: any[] = [];
    for (const r of parsed) {
      const rider = appState.riders.find((rd: any) => rd.bib_number === r.bib_number);
      if (rider) {
        matched++;
        payload.push({ rider_id: rider.id, time_seconds: r.time_seconds, points: r.points, mountain_points: r.mountain_points, dnf: r.dnf });
      } else { unmatched++; }
    }

    if (!matched) { resultsSyncStatus = { text: `Geen renners gekoppeld (${unmatched} onbekende bibnummers)`, cls: 'text-danger' }; return; }

    resultsSyncStatus = { text: `⏳ ${matched} resultaten opslaan...`, cls: 'text-muted' };

    try {
      await supaRpc('admin_save_results', { p_stage_id: stageId, p_results: payload, p_manual: true });
      resultsSyncStatus = { text: `✅ ${matched} resultaten opgeslagen!` + (unmatched ? ` (${unmatched} onbekend)` : ''), cls: 'text-success' };

      // Preview top 10
      const top10 = payload.slice(0, 10);
      resultsSyncPreview = `<table class="table table-sm mb-0">
      <thead><tr><th>Renner</th><th>Tijd</th><th>Pts</th><th>DNF</th></tr></thead>
      <tbody>${top10.map(r => {
        const rider = appState._riderMap[r.rider_id];
        return `<tr>
          <td>${rider ? escapeHtml(rider.name) : '?'}</td>
          <td class="time">${formatTime(r.time_seconds)}</td>
          <td>${r.points}</td>
          <td>${r.dnf ? '⚠️' : ''}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
    } catch (e: any) {
      resultsSyncStatus = { text: `❌ ${e.message}`, cls: 'text-danger' };
    }
  }

  // =====================
  // ADMIN: RESULTATEN (handmatig, via Postgres RPC)
  // =====================
  let adminStageId = $state<any>(null);
  let resultRows = $state<any[]>([]);
  let adminStatus = $state({ text: '', cls: 'ms-3' });

  function loadAdminResults() {
    const compStages = activeStages();
    // Vanilla vulde beide selects met dezelfde etappes; eerste optie is default
    if (syncStageId == null || !compStages.some((s: any) => s.id === syncStageId)) {
      syncStageId = compStages[0]?.id ?? null;
    }
    if (adminStageId == null || !compStages.some((s: any) => s.id === adminStageId)) {
      adminStageId = compStages[0]?.id ?? null;
    }
    renderAdminResultsForm();
  }

  async function renderAdminResultsForm() {
    const stageId = parseInt(String(adminStageId));
    if (!stageId) {
      resultRows = [];
      return;
    }
    resultRows = appState.riders.map((r: any) => ({ rider: r, time: 0, pts: 0, mt: 0, bonus: 0, dnf: false }));
    await loadExistingResults(stageId);
  }

  async function loadExistingResults(stageId: number) {
    try {
      const results = await supaRest('stage_results', { filters: `stage_id=eq.${stageId}` });
      for (const r of results) {
        const row = resultRows.find((x: any) => x.rider.id === r.rider_id);
        if (!row) continue;
        row.time = r.time_seconds;
        row.pts = r.points;
        row.mt = r.mountain_points;
        row.bonus = r.bonification_seconds || 0;
        row.dnf = r.dnf;
      }
    } catch (e) { /* no results yet */ }
  }

  async function saveManualResults() {
    const stageId = parseInt(String(adminStageId));
    const results: any[] = [];
    for (const row of resultRows) {
      const time = parseInt(String(row.time)) || 0;
      const pts = parseInt(String(row.pts)) || 0;
      const mt = parseInt(String(row.mt)) || 0;
      const bonus = parseInt(String(row.bonus)) || 0;
      const dnf = !!row.dnf;
      if (time > 0 || pts > 0 || mt > 0 || bonus > 0 || dnf) {
        results.push({ rider_id: row.rider.id, time_seconds: time, points: pts, mountain_points: mt, bonification_seconds: bonus, dnf });
      }
    }

    try {
      adminStatus = { text: 'Opslaan...', cls: 'ms-3 text-muted' };
      const res = await supaRpc('admin_save_results', { p_stage_id: stageId, p_results: results, p_manual: true });
      adminStatus = { text: `${res.count} resultaten opgeslagen!`, cls: 'ms-3 text-success' };
    } catch (e: any) {
      adminStatus = { text: e.message, cls: 'ms-3 text-danger' };
    }
  }

  // =====================
  // ADMIN: IMPORT (console scripts + handmatig)
  // =====================
  const PCS_STAGES_SCRIPT = `// Plak dit in de console op een PCS /stages pagina
(() => {
  const rows = document.querySelectorAll('table.basic tbody tr');
  const stages = [];
  const year = location.pathname.match(/(\\d{4})/)?.[1] || new Date().getFullYear();
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length < 4) return;
    const dateText = cells[0]?.textContent?.trim() || '';
    const link = cells[3]?.querySelector('a');
    const name = link?.textContent?.trim() || '';
    if (!name || name.toLowerCase().includes('rest') || !link?.getAttribute('href')) return;
    const m = name.match(/Stage\\s+(\\d+)/i);
    if (!m) return;
    const icon = cells[2]?.querySelector('span')?.className || '';
    let type = 'flat';
    if (name.includes('ITT') || name.includes('(TT)')) type = 'tt';
    else if (icon.includes('p5') || icon.includes('p4') || icon.includes('p3')) type = 'mountain';
    else if (icon.includes('p2')) type = 'sprint';
    const dp = dateText.split('/');
    const date = dp.length === 2 ? year + '-' + dp[1].padStart(2,'0') + '-' + dp[0].padStart(2,'0') : '';
    const route = name.includes('|') ? name.split('|')[1].trim() : name;
    stages.push(m[1] + ', ' + route + ', ' + date + ', ' + type);
  });
  copy('---ETAPPES---\\n' + stages.join('\\n'));
  console.log(stages.length + ' etappes gekopieerd naar clipboard!');
})();`;

  // PCS browser console script (voor copy-paste)
  const PCS_SCRIPT = `// Plak dit in de console op een PCS startlijst-pagina
(() => {
  const teams = document.querySelectorAll('ul.startlist_v4 > li');
  const result = [];
  const shirts = {};
  teams.forEach(li => {
    const teamName = li.querySelector('a.team')?.textContent?.trim().replace(/\\s*\\(.*\\)/, '') || '';
    const shirtImg = li.querySelector('.shirtCont img');
    if (shirtImg && teamName) shirts[teamName] = shirtImg.src;
    li.querySelectorAll('.ridersCont ul li').forEach(rider => {
      const bib = rider.querySelector('.bib')?.textContent?.trim() || '';
      let name = rider.querySelector('a')?.textContent?.trim() || '';
      name = name.replace(/\\s*\\(.*\\)$/, '');
      if (bib && name) result.push(bib + ', ' + name + ', ' + teamName);
    });
  });
  const output = '---RENNERS---\\n' + result.join('\\n') + '\\n---SHIRTS---\\n' + JSON.stringify(shirts);
  copy(output);
  console.log(result.length + ' renners + ' + Object.keys(shirts).length + ' team shirts gekopieerd!');
})();`;

  let copyStagesLabel = $state('📅 Kopieer etappes-script');
  let copyRidersLabel = $state('🚴 Kopieer renners-script');

  function copyStagesScript() {
    navigator.clipboard.writeText(PCS_STAGES_SCRIPT);
    copyStagesLabel = '✅ Gekopieerd!';
    setTimeout(() => { copyStagesLabel = '📅 Kopieer etappes-script'; }, 2000);
  }

  function copyRidersScript() {
    navigator.clipboard.writeText(PCS_SCRIPT);
    copyRidersLabel = '✅ Gekopieerd!';
    setTimeout(() => { copyRidersLabel = '🚴 Kopieer renners-script'; }, 2000);
  }

  function parseRiderLines(text: string) {
    return text.trim().split('\n').map(line => {
      line = line.trim();
      if (!line) return null;
      // Support both comma and tab separated
      const parts = line.includes('\t') ? line.split('\t') : line.split(',');
      if (parts.length < 3) return null;
      const bib = parseInt(parts[0].trim());
      const name = parts[1].trim();
      const team = parts[2].trim();
      if (!bib || !name || !team) return null;
      return { bib_number: bib, name, team };
    }).filter(Boolean) as any[];
  }

  function parseStageLines(text: string) {
    return text.trim().split('\n').map(line => {
      line = line.trim();
      if (!line) return null;
      const parts = line.includes('\t') ? line.split('\t') : line.split(',');
      if (parts.length < 3) return null;
      const num = parseInt(parts[0].trim());
      const name = parts[1].trim();
      const date = parts[2].trim();
      const type = (parts[3] || 'flat').trim().toLowerCase();
      if (!num || !name || !date.match(/^\d{4}-\d{2}-\d{2}$/)) return null;
      return { stage_number: num, name, date, stage_type: type };
    }).filter(Boolean) as any[];
  }

  // Universal import: detect data type and import
  let raceSyncData = $state('');
  let raceSyncStatus = $state({ text: '', cls: '' });
  let raceSyncLog = $state('');

  async function raceImport() {
    const raw = raceSyncData.trim();
    const compId = parseInt(String(raceSyncCompId));

    if (!raw) { raceSyncStatus = { text: 'Plak eerst data', cls: 'text-danger' }; return; }
    if (!compId) { raceSyncStatus = { text: 'Selecteer een ronde', cls: 'text-danger' }; return; }

    raceSyncStatus = { text: '⏳ Importeren...', cls: 'text-muted' };
    raceSyncLog = '';
    const lines: string[] = [];

    // Detect and import stages
    if (raw.includes('---ETAPPES---')) {
      const stageText = raw.split('---ETAPPES---')[1].split('---')[0].trim();
      const parsed = parseStageLines(stageText);
      if (parsed.length) {
        let ok = 0, skip = 0;
        for (const s of parsed) {
          const startDateTime = new Date(`${s.date}T${s.start_time || '12:00'}:00`);
          try {
            await supaRest('stages', {
              method: 'POST',
              body: { ...s, start_time: startDateTime.toISOString(), deadline: startDateTime.toISOString(), locked: false, competition_id: compId },
            });
            ok++;
          } catch (e) { skip++; }
        }
        lines.push(`📅 Etappes: ${ok} geïmporteerd, ${skip} overgeslagen`);
        loadAdminStages();
      }
    }

    // Detect and import riders + shirts
    if (raw.includes('---RENNERS---')) {
      let riderText = raw.split('---RENNERS---')[1];
      if (riderText.includes('---SHIRTS---')) {
        const parts = riderText.split('---SHIRTS---');
        riderText = parts[0];
        try {
          const shirts = JSON.parse(parts[1].trim());
          appState.teamShirts = { ...appState.teamShirts, ...shirts };
          localStorage.setItem('bagagedrager_shirts', JSON.stringify(appState.teamShirts));
          lines.push(`👕 ${Object.keys(shirts).length} team shirts opgeslagen`);
        } catch (e) { /* ignore */ }
      }
      if (riderText.includes('---ETAPPES---')) riderText = riderText.split('---ETAPPES---')[0];
      const parsed = parseRiderLines(riderText);
      if (parsed.length) {
        let ok = 0, skip = 0;
        for (const r of parsed) {
          try {
            await supaRest('riders', { method: 'POST', body: { ...r, competition_id: compId } });
            ok++;
          } catch (e) { skip++; }
        }
        lines.push(`🚴 Renners: ${ok} geïmporteerd, ${skip} overgeslagen`);
        loadAdminRiders();
        await loadRidersForComp();
      }
    }

    // Fallback: try plain CSV (stages or riders)
    if (!raw.includes('---')) {
      // Guess based on content
      const firstLine = raw.split('\n')[0];
      if (firstLine.match(/^\d+\s*,.*,\s*\d{4}-\d{2}-\d{2}/)) {
        // Looks like stages
        const parsed = parseStageLines(raw);
        if (parsed.length) {
          let ok = 0, skip = 0;
          for (const s of parsed) {
            const startDateTime = new Date(`${s.date}T${s.start_time || '12:00'}:00`);
            try {
              await supaRest('stages', {
                method: 'POST',
                body: { ...s, start_time: startDateTime.toISOString(), deadline: startDateTime.toISOString(), locked: false, competition_id: compId },
              });
              ok++;
            } catch (e) { skip++; }
          }
          lines.push(`📅 Etappes: ${ok} geïmporteerd, ${skip} overgeslagen`);
          loadAdminStages();
        }
      } else {
        // Assume riders
        const parsed = parseRiderLines(raw);
        if (parsed.length) {
          let ok = 0, skip = 0;
          for (const r of parsed) {
            try {
              await supaRest('riders', { method: 'POST', body: { ...r, competition_id: compId } });
              ok++;
            } catch (e) { skip++; }
          }
          lines.push(`🚴 Renners: ${ok} geïmporteerd, ${skip} overgeslagen`);
          loadAdminRiders();
          await loadRidersForComp();
        }
      }
    }

    if (lines.length) {
      raceSyncStatus = { text: '✅ Klaar!', cls: 'text-success' };
      raceSyncLog = lines.join('<br>');
    } else {
      raceSyncStatus = { text: 'Geen geldige data gevonden', cls: 'text-danger' };
    }
  }

  // Handmatige imports per onderdeel
  let importRidersText = $state('');
  let importRiderCompId = $state<any>(null);
  let importRidersStatus = $state({ text: '', cls: '' });
  let importRidersPreview = $state('');
  let importStagesText = $state('');
  let importStageCompId = $state<any>(null);
  let importStagesStatus = $state({ text: '', cls: '' });
  let importStagesPreview = $state('');

  function previewRiders() {
    const parsed = parseRiderLines(importRidersText);
    if (!parsed.length) { importRidersPreview = '<span class="text-danger">Geen geldige regels gevonden</span>'; return; }
    importRidersPreview = `<strong>${parsed.length} renners gevonden:</strong><br>` +
      parsed.slice(0, 10).map(r => `#${r.bib_number} ${r.name} — ${r.team}`).join('<br>') +
      (parsed.length > 10 ? `<br><span class="text-muted">...en ${parsed.length - 10} meer</span>` : '');
  }

  async function importRiders() {
    let rawText = importRidersText;

    // Extract shirts if present (from PCS script output)
    if (rawText.includes('---SHIRTS---')) {
      const parts = rawText.split('---SHIRTS---');
      rawText = parts[0].replace('---RENNERS---', '');
      try {
        const shirts = JSON.parse(parts[1].trim());
        appState.teamShirts = { ...appState.teamShirts, ...shirts };
        localStorage.setItem('bagagedrager_shirts', JSON.stringify(appState.teamShirts));
        console.log(`${Object.keys(shirts).length} team shirts opgeslagen`);
      } catch (e) { console.warn('Kon shirts niet parsen:', e); }
    } else {
      rawText = rawText.replace('---RENNERS---', '');
    }

    const parsed = parseRiderLines(rawText);
    const compId = parseInt(String(importRiderCompId));
    if (!parsed.length) { importRidersStatus = { text: 'Geen geldige data', cls: 'text-danger' }; return; }
    if (!compId) { importRidersStatus = { text: 'Kies een ronde', cls: 'text-danger' }; return; }

    importRidersStatus = { text: `Importeren van ${parsed.length} renners...`, cls: 'text-muted' };
    let ok = 0, skip = 0, errors: string[] = [];
    for (const r of parsed) {
      try {
        await supaRest('riders', { method: 'POST', body: { ...r, competition_id: compId } });
        ok++;
      } catch (e: any) {
        skip++;
        if (!e.message.includes('duplicate') && !e.message.includes('unique')) {
          errors.push(`#${r.bib_number} ${r.name}: ${e.message}`);
        }
      }
    }
    const msg = `${ok} geïmporteerd, ${skip} overgeslagen`;
    importRidersStatus = {
      text: errors.length ? `${msg} (${errors.length} fouten — check console)` : msg,
      cls: errors.length ? 'text-warning' : 'text-success',
    };
    if (errors.length) console.warn('Import fouten:', errors);
    loadAdminRiders();
  }

  function previewStages() {
    const parsed = parseStageLines(importStagesText);
    if (!parsed.length) { importStagesPreview = '<span class="text-danger">Geen geldige regels gevonden</span>'; return; }
    importStagesPreview = `<strong>${parsed.length} etappes gevonden:</strong><br>` +
      parsed.map(s => `Etappe ${s.stage_number}: ${s.name} (${s.date}, ${typeLabels[s.stage_type] || s.stage_type})`).join('<br>');
  }

  async function importStages() {
    const parsed = parseStageLines(importStagesText);
    const compId = parseInt(String(importStageCompId));
    if (!parsed.length) { importStagesStatus = { text: 'Geen geldige data', cls: 'text-danger' }; return; }
    if (!compId) { importStagesStatus = { text: 'Kies een ronde', cls: 'text-danger' }; return; }

    importStagesStatus = { text: `Importeren van ${parsed.length} etappes...`, cls: 'text-muted' };
    let ok = 0, skip = 0;
    for (const s of parsed) {
      const startDateTime = new Date(`${s.date}T${s.start_time || '12:00'}:00`);
      try {
        await supaRest('stages', {
          method: 'POST',
          body: { ...s, start_time: startDateTime.toISOString(), deadline: startDateTime.toISOString(), locked: false, competition_id: compId },
        });
        ok++;
      } catch (e) {
        skip++;
      }
    }
    importStagesStatus = { text: `${ok} geimporteerd, ${skip} overgeslagen (duplicaat)`, cls: 'text-success' };
    loadAdminStages();
  }

  // =====================
  // BOOT (was: loadAdminView, aangeroepen bij openen admin-tab)
  // =====================
  function initDefaultCompSelects() {
    const first = appState.competitions[0]?.id ?? null;
    if (raceSyncCompId == null) raceSyncCompId = first;
    if (importRiderCompId == null) importRiderCompId = first;
    if (importStageCompId == null) importStageCompId = first;
    if (newStageCompId == null) newStageCompId = first;
  }

  async function loadAdminView() {
    await Promise.all([
      loadAdminUsers(),
      loadAdminCompetitions(),
      loadAdminRiders(),
      loadAdminStages(),
    ]);
    initDefaultCompSelects();
    loadAdminResults();
    loadAdminPot();
    loadAdminAudit();
    loadFeedback();
  }

  onMount(() => {
    loadAdminView();
  });
</script>

<div class="tab-section active" id="section-admin">
  <ul class="nav nav-tabs mb-3" id="admin-tabs">
    {#each subTabs as t (t.id)}
      <li class="nav-item">
        <a class="nav-link" class:active={adminSub === t.id} href={'#' + t.id} data-admin={t.id}
           onclick={(e) => { e.preventDefault(); adminSub = t.id; }}>{t.label}</a>
      </li>
    {/each}
  </ul>

  <!-- Admin: Gebruikers -->
  <div class="admin-sub" class:active={adminSub === 'admin-users'} id="admin-users">
    <div class="card mb-3">
      <div class="card-header"><h5 class="mb-0">Speler Aanmaken</h5></div>
      <div class="card-body">
        <div class="row g-2">
          <div class="col-md-3">
            <input type="text" id="new-user-name" class="form-control form-control-sm" placeholder="Naam" bind:value={newUserName} />
          </div>
          <div class="col-md-3">
            <input type="email" id="new-user-email" class="form-control form-control-sm" placeholder="Email" bind:value={newUserEmail} />
          </div>
          <div class="col-md-3">
            <input type="text" id="new-user-password" class="form-control form-control-sm" placeholder="Wachtwoord" bind:value={newUserPassword} />
          </div>
          <div class="col-md-3">
            <button id="btn-admin-create-user" class="btn btn-primary btn-sm w-100" onclick={createUser}>Aanmaken</button>
          </div>
        </div>
        <span id="admin-create-user-status" class={createUserStatus.cls} style="font-size:0.8rem;">{createUserStatus.text}</span>
      </div>
    </div>
    <div class="card mb-3">
      <div class="card-header"><h5 class="mb-0">Uitnodigingslink</h5></div>
      <div class="card-body">
        <p class="text-muted" style="font-size:0.8rem; margin-bottom:0.6rem;">Genereer een deelbare link. Wie hem opent ziet een welkom voor de ronde en maakt direct een account aan.</p>
        <div class="row g-2 align-items-center">
          <div class="col-md-5">
            <select class="form-select form-select-sm" bind:value={inviteCompId}>
              <option value={null}>Actieve ronde</option>
              {#each appState.competitions as c}<option value={c.id}>{c.name}</option>{/each}
            </select>
          </div>
          <div class="col-md-3">
            <button class="btn btn-primary btn-sm w-100" onclick={generateInvite}>Genereer link</button>
          </div>
        </div>
        {#if inviteUrl}
          <div class="d-flex gap-2 align-items-center mt-2">
            <input class="form-control form-control-sm" readonly value={inviteUrl} onclick={(e) => (e.currentTarget as HTMLInputElement).select()} />
            <button class="btn btn-ghost btn-sm" style="white-space:nowrap;" onclick={copyInvite}>Kopieer</button>
          </div>
        {/if}
        {#if inviteStatus}<span class="text-muted" style="font-size:0.8rem;">{inviteStatus}</span>{/if}
      </div>
    </div>
    <div class="card">
      <div class="card-header d-flex justify-content-between align-items-center">
        <h5 class="mb-0">Gebruikers</h5>
        <span id="user-count" class="badge bg-secondary">{adminUsers.length} spelers</span>
      </div>
      <div class="card-body p-0">
        <table class="table table-sm table-striped mb-0">
          <thead><tr><th>Naam</th><th>Status</th><th>Aangemeld</th><th>Laatst gezien</th><th>Acties</th></tr></thead>
          <tbody id="admin-users-table">
            {#each adminUsers as p (p.id)}
              {@const isSelf = p.id === appState.profile?.id}
              {@const emailConfirmed = !!p.email_confirmed_at}
              <tr style={p.is_active === false ? 'opacity:0.5;' : ''}>
                <td>{p.display_name}</td>
                <td>
                  {#if p.is_admin}<span class="badge bg-danger">Admin</span>{/if}
                  {#if p.is_active === false}<span class="badge bg-secondary">Inactief</span>{:else}<span class="badge bg-success">Actief</span>{/if}
                  {#if !emailConfirmed}<span class="badge bg-warning text-dark">E-mail onbevestigd</span>{/if}
                </td>
                <td>{new Date(p.created_at).toLocaleDateString('nl-NL')}</td>
                <td style="font-size:0.8rem;">{lastSeenText(p)}</td>
                <td>
                  <div class="d-flex gap-1 flex-wrap">
                    <button class="btn btn-sm btn-outline-{p.is_admin ? 'secondary' : 'danger'}"
                            onclick={() => toggleAdmin(p.id, !p.is_admin)} disabled={isSelf}>
                      {p.is_admin ? 'Degradeer' : 'Maak admin'}
                    </button>
                    <button class="btn btn-sm btn-outline-{p.is_active === false ? 'success' : 'warning'}"
                            onclick={() => togglePlayerActive(p.id, p.is_active === false)} disabled={isSelf}>
                      {p.is_active === false ? 'Activeer' : 'Deactiveer'}
                    </button>
                    {#if !emailConfirmed}
                      <button class="btn btn-sm btn-outline-warning" onclick={() => confirmUserEmail(p.id)}>
                        Bevestig e-mail
                      </button>
                    {/if}
                    <button class="btn btn-sm btn-outline-info" onclick={() => resetPassword(p.email || '')}>
                      Reset ww
                    </button>
                    <button class="btn btn-sm btn-outline-primary" onclick={() => openAdminPicks(p.id, p.display_name)}>
                      Keuzes
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick={() => deletePlayer(p.id, p.display_name)} disabled={isSelf}>
                      Verwijder
                    </button>
                  </div>
                </td>
              </tr>
            {:else}
              <tr><td colspan="4" class="text-muted">Geen gebruikers</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Admin: Rondes -->
  <div class="admin-sub" class:active={adminSub === 'admin-competitions'} id="admin-competitions">
    <div class="card mb-3">
      <div class="card-header"><h5 class="mb-0">Ronde Toevoegen</h5></div>
      <div class="card-body">
        <div class="row g-2">
          <div class="col-md-4">
            <input type="text" id="new-comp-name" class="form-control form-control-sm" placeholder="Naam (bijv. Tour de France 2025)" bind:value={newCompName} />
          </div>
          <div class="col-md-2">
            <input type="text" id="new-comp-slug" class="form-control form-control-sm" placeholder="slug (bijv. tour-2025)" bind:value={newCompSlug} />
          </div>
          <div class="col-md-1">
            <input type="number" id="new-comp-year" class="form-control form-control-sm" placeholder="Jaar" bind:value={newCompYear} />
          </div>
          <div class="col-md-2">
            <select id="new-comp-scoring-mode" class="form-select form-select-sm" bind:value={newCompScoringMode}>
              <option value="grand_tour">Grote ronde</option>
              <option value="classic">Klassieker</option>
            </select>
            <label class="form-check mt-1" style="font-size:0.75rem;">
              <input type="checkbox" id="new-comp-one-day" class="form-check-input form-check-input-sm" bind:checked={newCompOneDay}> Eendagskoers
            </label>
          </div>
          <div class="col-md-2">
            <input type="url" id="new-comp-pcs-url" class="form-control form-control-sm" placeholder="PCS URL" bind:value={newCompPcsUrl} />
          </div>
          <div class="col-6 col-md-1">
            <div class="d-flex align-items-center gap-1">
              <input type="color" id="new-comp-color" class="form-control form-control-color form-control-sm" bind:value={newCompColor} title="Ronde kleur" style="width:32px; height:30px; padding:2px;" />
              <input type="text" id="new-comp-flag" class="form-control form-control-sm" placeholder="🇫🇷" style="width:40px; text-align:center;" maxlength="4" bind:value={newCompFlag} />
            </div>
          </div>
          <div class="col-6 col-md-1">
            <button id="btn-add-comp" class="btn btn-primary btn-sm w-100" onclick={addComp}>Toevoegen</button>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-body p-0">
        <table class="table table-sm table-striped mb-0">
          <thead><tr><th>Naam</th><th>Jaar</th><th>Modus</th><th>Kleur</th><th>Vlag</th><th>Logo</th><th>PCS URL</th><th>Inleg</th><th>Betaallink</th><th>Sync</th><th>Actief</th><th>Acties</th></tr></thead>
          <tbody id="admin-comp-table">
            {#each appState.competitions as c (c.id)}
              <tr>
                <td>
                  <input type="text" class="form-control form-control-sm comp-name-input" value={c.name}
                         data-comp-id={c.id} style="min-width:140px;" onchange={(e) => renameComp(c.id, e.currentTarget.value)}>
                </td>
                <td>{c.year}</td>
                <td>
                  <select class="form-select form-select-sm" style="min-width:110px;"
                          onchange={(e) => updateCompField(c.id, 'scoring_mode', e.currentTarget.value)}>
                    <option value="grand_tour" selected={c.scoring_mode !== 'classic'}>Grote ronde</option>
                    <option value="classic" selected={c.scoring_mode === 'classic'}>Klassieker</option>
                  </select>
                  <label class="form-check mt-1" style="font-size:0.7rem;">
                    <input type="checkbox" class="form-check-input" checked={c.is_one_day}
                           onchange={(e) => updateCompField(c.id, 'is_one_day', e.currentTarget.checked)}> 1-dag
                  </label>
                </td>
                <td>
                  <input type="color" class="form-control form-control-color" value={c.color || '#facc15'}
                         style="width:32px; height:28px; padding:2px;" onchange={(e) => updateCompField(c.id, 'color', e.currentTarget.value)}>
                </td>
                <td>
                  <input type="text" class="form-control form-control-sm" value={c.country_flag || ''}
                         placeholder="🇫🇷" style="width:45px; text-align:center;" maxlength="4"
                         onchange={(e) => updateCompField(c.id, 'country_flag', e.currentTarget.value)}>
                </td>
                <td>
                  <input type="url" class="form-control form-control-sm" value={c.logo_url || ''}
                         placeholder="Logo URL" style="min-width:110px; font-size:0.75rem;"
                         onchange={(e) => updateCompField(c.id, 'logo_url', e.currentTarget.value)}>
                </td>
                <td>
                  <input type="url" class="form-control form-control-sm" value={c.pcs_url || ''}
                         placeholder="PCS URL" style="min-width:140px; font-size:0.75rem;"
                         onchange={(e) => updateCompPcsUrl(c.id, e.currentTarget.value)}>
                </td>
                <td>
                  <div class="input-group input-group-sm" style="width:90px;">
                    <span class="input-group-text" style="font-size:0.75rem;">€</span>
                    <input type="number" class="form-control form-control-sm" value={c.entry_fee ?? ''} min="1" max="999" placeholder="—"
                           style="width:55px;" onchange={(e) => updateCompField(c.id, 'entry_fee', e.currentTarget.value ? parseInt(e.currentTarget.value) : null)}>
                  </div>
                </td>
                <td>
                  <input type="url" class="form-control form-control-sm" value={c.payment_url || ''}
                         placeholder="Betaalverzoek-URL" style="min-width:140px; font-size:0.75rem;"
                         onchange={(e) => updateCompField(c.id, 'payment_url', e.currentTarget.value || null)}>
                </td>
                <td style="font-size:0.7rem;color:var(--text-muted);white-space:nowrap;">
                  {c.last_synced_at ? new Date(c.last_synced_at).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                </td>
                <td>
                  <div class="form-check form-switch d-inline-block">
                    <input class="form-check-input" type="checkbox" checked={c.is_active}
                           onchange={(e) => toggleCompActive(c.id, e.currentTarget.checked)}>
                  </div>
                </td>
                <td>
                  <button class="btn btn-sm btn-outline-danger" onclick={() => deleteComp(c.id)}>Verwijder</button>
                </td>
              </tr>
            {:else}
              <tr><td colspan="11" class="text-muted">Geen rondes</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Admin: Renners -->
  <div class="admin-sub" class:active={adminSub === 'admin-riders'} id="admin-riders">
    <div class="card mb-3">
      <div class="card-header"><h5 class="mb-0">Renner Toevoegen</h5></div>
      <div class="card-body">
        <div class="row g-2">
          <div class="col-md-2">
            <input type="number" id="new-rider-bib" class="form-control form-control-sm" placeholder="Rugnr" bind:value={newRiderBib} />
          </div>
          <div class="col-md-4">
            <input type="text" id="new-rider-name" class="form-control form-control-sm" placeholder="Naam" bind:value={newRiderName} />
          </div>
          <div class="col-md-4">
            <input type="text" id="new-rider-team" class="form-control form-control-sm" placeholder="Team" bind:value={newRiderTeam} />
          </div>
          <div class="col-md-2">
            <button id="btn-add-rider" class="btn btn-primary btn-sm w-100" onclick={addRider}>Toevoegen</button>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-header d-flex justify-content-between align-items-center gap-2">
        <h5 class="mb-0">Renners</h5>
        <div class="d-flex gap-2">
          <select id="admin-rider-comp-filter" class="form-select form-select-sm" style="width:auto;" bind:value={riderCompFilter} onchange={loadAdminRiders}>
            <option value="">Alle rondes</option>
            {#each appState.competitions as c (c.id)}
              <option value={c.id}>{c.name}</option>
            {/each}
          </select>
          <input type="text" id="admin-rider-search" class="form-control form-control-sm" style="width:200px;" placeholder="Zoek..." bind:value={riderSearch} oninput={onRiderSearchInput} />
        </div>
      </div>
      <div class="card-body p-0" style="max-height:500px; overflow-y:auto;">
        <table class="table table-sm table-striped mb-0">
          <thead><tr><th>#</th><th>Naam</th><th>Team</th><th>Acties</th></tr></thead>
          <tbody id="admin-riders-table">
            {#each filteredRiders as r (r.id)}
              <tr>
                <td>{r.bib_number}</td>
                <td>{r.name}{#if r.photo_url && r.photo_url !== 'none'} <img src={r.photo_url} alt="" style="height:20px;border-radius:2px;vertical-align:middle;" onerror={(e) => (e.currentTarget as HTMLElement).remove()}>{/if}</td>
                <td>{@html teamBadge(r.team)}</td>
                <td class="d-flex gap-1 flex-wrap">
                  <button class="btn btn-sm {r.dnf ? 'btn-danger' : 'btn-outline-secondary'}" onclick={() => toggleRiderDnf(r.id, !!r.dnf)} title="DNF aan/uit">{r.dnf ? '⬛ Uit koers' : '✅ In koers'}</button>
                  <button class="btn btn-sm btn-outline-secondary" onclick={() => resetRiderPhoto(r.id)} title="Foto resetten zodat scraper opnieuw haalt">📷</button>
                  <button class="btn btn-sm btn-outline-danger" onclick={() => deleteRider(r.id)}>🗑</button>
                </td>
              </tr>
            {:else}
              <tr><td colspan="4" class="text-muted">Geen renners gevonden</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Admin: Etappes -->
  <div class="admin-sub" class:active={adminSub === 'admin-stages'} id="admin-stages">
    <div class="card mb-3">
      <div class="card-header"><h5 class="mb-0">Etappe Toevoegen</h5></div>
      <div class="card-body">
        <div class="row g-2">
          <div class="col-6 col-md-1">
            <input type="number" id="new-stage-num" class="form-control form-control-sm" placeholder="#" bind:value={newStageNum} />
          </div>
          <div class="col-6 col-md-2">
            <input type="text" id="new-stage-name" class="form-control form-control-sm" placeholder="Naam" bind:value={newStageName} />
          </div>
          <div class="col-6 col-md-2">
            <input type="date" id="new-stage-date" class="form-control form-control-sm" bind:value={newStageDate} />
          </div>
          <div class="col-6 col-md-1">
            <input type="time" id="new-stage-starttime" class="form-control form-control-sm" title="Starttijd (= deadline)" bind:value={newStageStartTime} />
          </div>
          <div class="col-6 col-md-2">
            <select id="new-stage-type" class="form-select form-select-sm" bind:value={newStageType}>
              <option value="flat">Vlak</option>
              <option value="mountain">Berg</option>
              <option value="tt">Tijdrit</option>
              <option value="ttt">Ploegentijdrit</option>
              <option value="sprint">Sprint</option>
            </select>
          </div>
          <div class="col-6 col-md-2">
            <select id="new-stage-comp" class="form-select form-select-sm" bind:value={newStageCompId}>
              {#each appState.competitions as c (c.id)}
                <option value={c.id}>{c.name}</option>
              {/each}
            </select>
          </div>
          <div class="col-12 col-md-2">
            <button id="btn-add-stage" class="btn btn-primary btn-sm w-100" onclick={addStage}>Toevoegen</button>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-body p-0">
        <table class="table table-sm table-striped mb-0">
          <thead><tr><th>#</th><th>Naam</th><th>Ronde</th><th>Datum</th><th>Start</th><th>Type</th><th>PCS URL</th><th>Status</th><th>Acties</th></tr></thead>
          <tbody id="admin-stages-table">
            {#each appState.stages as s (s.id)}
              {@const comp = appState.competitions.find((c: any) => c.id === s.competition_id)}
              <tr>
                <td>{s.stage_number}</td>
                <td>{s.name}</td>
                <td>{#if comp}{comp.name}{:else}<span class="text-muted">-</span>{/if}</td>
                <td>{new Date(s.date).toLocaleDateString('nl-NL')}</td>
                <td>
                  <input type="time" class="form-control form-control-sm" value={stageTimeVal(s)}
                         style="width:96px;font-size:0.72rem;" title="Starttijd = deadline (lokale tijd)"
                         onchange={(e) => updateStageStartTime(s, e.currentTarget.value)}>
                </td>
                <td>{typeLabels[s.stage_type] || s.stage_type}</td>
                <td>
                  <div class="input-group input-group-sm" style="min-width:180px;">
                    <input type="url" class="form-control form-control-sm" value={s.pcs_url || ''}
                           placeholder="PCS URL etappe" style="font-size:0.7rem;"
                           onchange={(e) => updateStagePcsUrl(s.id, e.currentTarget.value)}>
                    {#if s.pcs_url}
                      <button class="btn btn-outline-primary btn-sm" onclick={() => syncStageFromPcs(s.id, s.competition_id)} title="Sync deze etappe">⟳</button>
                    {/if}
                  </div>
                </td>
                <td>
                  {#if s.locked}<span class="badge bg-secondary">Vergrendeld</span>{:else}<span class="badge bg-success">Open</span>{/if}
                </td>
                <td>
                  <input type="text" class="form-control form-control-sm" value={winnerTimeVal(s)}
                         placeholder="M:SS" style="width:70px;font-size:0.7rem;" title="Winnaarstijd (M:SS)"
                         onchange={(e) => updateStageWinnerTime(s.id, e.currentTarget.value)}>
                  <button class="btn btn-sm btn-outline-{s.locked ? 'success' : 'warning'}"
                          onclick={() => toggleStageLock(s.id, !s.locked)}>
                    {s.locked ? 'Ontgrendel' : 'Vergrendel'}
                  </button>
                  <button class="btn btn-sm btn-outline-danger" onclick={() => deleteStage(s.id)}>Verwijder</button>
                </td>
              </tr>
            {:else}
              <tr><td colspan="9" class="text-muted">Geen etappes</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Admin: Resultaten -->
  <div class="admin-sub" class:active={adminSub === 'admin-results'} id="admin-results">
    <!-- PCS Resultaten Sync -->
    <div class="card mb-3">
      <div class="card-header">
        <h5 class="mb-0">📊 Uitslagen importeren</h5>
        <p class="mb-0 text-muted" style="font-size:0.72rem;">Haal finish-tijden, punten en bergpunten op van PCS na afloop van een etappe.</p>
      </div>
      <div class="card-body">
        <div class="mb-2">
          <label class="form-label" style="font-size:0.8rem;" for="sync-stage-select"><strong>Kies etappe</strong></label>
          <select id="sync-stage-select" class="form-select form-select-sm" bind:value={syncStageId}>
            {#each activeStages() as s (s.id)}
              <option value={s.id}>Etappe {s.stage_number}: {s.name}</option>
            {/each}
          </select>
        </div>
        <div class="d-flex gap-2 align-items-center flex-wrap mb-2">
          <button id="btn-pcs-sync-results" class="btn btn-accent btn-sm" onclick={syncResults}>📊 Uitslagen ophalen</button>
          <button id="btn-pcs-force-sync-results" class="btn btn-warning btn-sm" title="Overschrijft ook handmatig bewerkte uitslagen — gebruik alleen als de normale sync verkeerde data heeft opgeslagen" onclick={forceSyncResults}>⚠️ Force sync (overschrijft handmatige data)</button>
          <button id="btn-auto-sync" class="btn btn-success btn-sm" onclick={autoSync}>⚡ Alles ophalen (afgelopen etappes)</button>
          <button id="btn-pcs-resync-all" class="btn btn-ghost btn-sm" onclick={resyncAll}>🔄 Alles opnieuw</button>
          <span id="pcs-results-sync-status" class={pcsResultsStatus.cls} style="font-size:0.8rem;">{pcsResultsStatus.text}</span>
        </div>
        <div id="pcs-results-sync-log" class="mt-2" style="font-size:0.8rem; max-height:300px; overflow-y:auto;" bind:this={pcsResultsLogEl}>{@html pcsResultsLog}</div>

        <!-- Fallback: handmatig plakken -->
        <details class="mt-3">
          <summary class="text-muted" style="font-size:0.8rem; cursor:pointer;">Handmatig: resultaten plakken via console script</summary>
          <div class="mt-2">
            <button id="btn-copy-results-script" class="btn btn-ghost btn-sm mb-2" onclick={copyResultsScript}>{copyResultsLabel}</button>
            <textarea id="results-sync-data" class="form-control form-control-sm mb-2" rows="5" placeholder="Plak hier de gekopieerde resultaten..." bind:value={resultsSyncData}></textarea>
            <div class="d-flex gap-2 align-items-center">
              <button id="btn-import-results" class="btn btn-primary btn-sm" onclick={importPastedResults}>Importeer resultaten</button>
              <span id="results-sync-status" class={resultsSyncStatus.cls} style="font-size:0.8rem;">{resultsSyncStatus.text}</span>
            </div>
            <div id="results-sync-preview" class="mt-2" style="font-size:0.8rem; max-height:200px; overflow-y:auto;">{@html resultsSyncPreview}</div>
          </div>
        </details>
      </div>
    </div>

    <!-- Handmatig -->
    <div class="card">
      <div class="card-header"><h5 class="mb-0">Handmatig Invoeren</h5></div>
      <div class="card-body">
        <div class="mb-3">
          <label class="form-label" style="font-size:0.8rem; color:var(--text-muted);" for="admin-stage-select">Etappe</label>
          <select id="admin-stage-select" class="form-select form-select-sm" bind:value={adminStageId} onchange={renderAdminResultsForm}>
            {#each activeStages() as s (s.id)}
              <option value={s.id}>Etappe {s.stage_number}: {s.name}</option>
            {/each}
          </select>
        </div>
        <div id="admin-results-form">
          {#if !adminStageId}
            <p class="text-muted">Geen etappes beschikbaar</p>
          {:else}
            <div class="table-responsive" style="max-height:400px; overflow-y:auto;">
              <table class="table table-sm">
                <thead><tr><th>Renner</th><th>Tijd (sec)</th><th>Pts</th><th>Berg Pts</th><th>Boni (s)</th><th>DNF</th></tr></thead>
                <tbody>
                  {#each resultRows as row (row.rider.id)}
                    <tr data-rider-id={row.rider.id}>
                      <td>{row.rider.name} {@html teamBadge(row.rider.team)}</td>
                      <td><input type="number" class="form-control form-control-sm res-time" min="0" bind:value={row.time} /></td>
                      <td><input type="number" class="form-control form-control-sm res-pts" min="0" bind:value={row.pts} /></td>
                      <td><input type="number" class="form-control form-control-sm res-mt" min="0" bind:value={row.mt} /></td>
                      <td><input type="number" class="form-control form-control-sm res-bonus" min="0" bind:value={row.bonus} /></td>
                      <td><input type="checkbox" class="form-check-input res-dnf" bind:checked={row.dnf} /></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
        <button id="btn-save-results" class="btn btn-success mt-3" onclick={saveManualResults}>Resultaten Opslaan</button>
        <span id="admin-status" class={adminStatus.cls} style="font-size:0.85rem;">{adminStatus.text}</span>
      </div>
    </div>
  </div>

  <!-- Admin: Import -->
  <div class="admin-sub" class:active={adminSub === 'admin-import'} id="admin-import">
    <!-- Directe PCS Sync -->
    <div class="card mb-3" style="border-color: var(--accent);">
      <div class="card-header" style="background: var(--accent-bg);">
        <h5 class="mb-0">🏁 Ronde klaarzetten</h5>
        <p class="mb-0 text-muted" style="font-size:0.72rem;">Importeer etappes, renners en race-info vanuit PCS. Doe dit <strong>voor</strong> de ronde begint.</p>
      </div>
      <div class="card-body">
        <div class="mb-3">
          <label class="form-label" style="font-size:0.8rem;" for="race-sync-comp"><strong>Kies ronde</strong></label>
          <select id="race-sync-comp" class="form-select form-select-sm" bind:value={raceSyncCompId}>
            {#each appState.competitions as c (c.id)}
              <option value={c.id}>{c.name}</option>
            {/each}
          </select>
        </div>
        <div class="d-flex gap-2 align-items-center flex-wrap">
          <button id="btn-pcs-sync-race" class="btn btn-accent btn-sm" onclick={syncRace}>🏁 Ronde importeren</button>
          <button id="btn-pcs-sync-startlist" class="btn btn-outline-secondary btn-sm" title="Herlaad startlijst van PCS: voegt nieuwe renners toe en verwijdert afvallers zonder picks" disabled={startlistBusy} onclick={syncStartlist}>
            {#if startlistBusy}<span class="spinner-border spinner-border-sm me-1" role="status"></span>Bezig…{:else}🔄 Startlijst bijwerken{/if}
          </button>
          <button id="btn-pcs-sync-photos" class="btn btn-ghost btn-sm" onclick={syncPhotos}>📸 Foto's ophalen</button>
          <span id="pcs-sync-status" class={pcsSyncStatus.cls} style="font-size:0.8rem;">{pcsSyncStatus.text}</span>
        </div>
        <div id="pcs-sync-log" class="mt-2" style="font-size:0.8rem; line-height:1.8;">{@html pcsSyncLog}</div>
      </div>
    </div>

    <!-- Console script fallback (inklapbaar) -->
    <details class="mb-3">
      <summary class="text-muted" style="font-size:0.8rem; cursor:pointer;">Geavanceerd: handmatig importeren via console scripts</summary>
      <div class="card mt-2">
        <div class="card-body">
          <p class="text-muted" style="font-size:0.8rem;">
            Alternatieve methode als de directe sync niet werkt. Kopieer het script, plak in de browser console op PCS, en plak het resultaat hieronder.
          </p>
          <div class="mb-3">
            <div class="d-flex gap-2 flex-wrap mb-2">
              <button id="btn-copy-stages-script" class="btn btn-ghost btn-sm" onclick={copyStagesScript}>{copyStagesLabel}</button>
              <button id="btn-copy-riders-script" class="btn btn-ghost btn-sm" onclick={copyRidersScript}>{copyRidersLabel}</button>
            </div>
          </div>
          <textarea id="race-sync-data" class="form-control form-control-sm mb-2" rows="6" placeholder="Plak hier de gekopieerde data..." bind:value={raceSyncData}></textarea>
          <div class="d-flex gap-2 align-items-center">
            <button id="btn-race-import" class="btn btn-primary btn-sm" onclick={raceImport}>Importeer</button>
            <span id="race-sync-status" class={raceSyncStatus.cls} style="font-size:0.8rem;">{raceSyncStatus.text}</span>
          </div>
          <div id="race-sync-log" class="mt-2" style="font-size:0.8rem; line-height:1.8;">{@html raceSyncLog}</div>
        </div>
      </div>
    </details>

    <p class="text-muted mb-3" style="font-size:0.75rem;">Of importeer handmatig per onderdeel:</p>
    <div class="card mb-3">
      <div class="card-header"><h5 class="mb-0">Renners Importeren</h5></div>
      <div class="card-body">
        <p class="text-muted" style="font-size:0.8rem;">
          Plak rennerdata uit ProCyclingStats of FirstCycling. Formaat per regel:<br>
          <code>rugnummer, naam, team</code> &mdash; bijv: <code>1, Tadej Pogačar, UAE Team Emirates</code><br>
          Of plak direct een startlijst-tabel (tab-separated) uit PCS.
        </p>
        <div class="mb-2">
          <label class="form-label" style="font-size:0.8rem; color:var(--text-muted);" for="import-rider-comp">Ronde</label>
          <select id="import-rider-comp" class="form-select form-select-sm" bind:value={importRiderCompId}>
            {#each appState.competitions as c (c.id)}
              <option value={c.id}>{c.name}</option>
            {/each}
          </select>
        </div>
        <textarea id="import-riders-text" class="form-control form-control-sm mb-2" rows="8"
          placeholder="1, Tadej Pogačar, UAE Team Emirates&#10;2, Adam Yates, UAE Team Emirates&#10;11, Jonas Vingegaard, Visma-Lease a Bike&#10;..." bind:value={importRidersText}></textarea>
        <div class="d-flex gap-2 align-items-center">
          <button id="btn-import-riders" class="btn btn-primary btn-sm" onclick={importRiders}>Importeer Renners</button>
          <button id="btn-preview-riders" class="btn btn-ghost btn-sm" onclick={previewRiders}>Preview</button>
          <span id="import-riders-status" class={importRidersStatus.cls} style="font-size:0.8rem;">{importRidersStatus.text}</span>
        </div>
        <div id="import-riders-preview" class="mt-2" style="font-size:0.8rem;">{@html importRidersPreview}</div>
      </div>
    </div>

    <div class="card mb-3">
      <div class="card-header"><h5 class="mb-0">Etappes Importeren (handmatig)</h5></div>
      <div class="card-body">
        <p class="text-muted" style="font-size:0.8rem;">
          Formaat per regel: <code>nummer, naam, datum (YYYY-MM-DD), type (flat/mountain/tt/sprint)</code><br>
          Bijv: <code>1, Lille → Dunkerque, 2025-07-05, flat</code>
        </p>
        <div class="mb-2">
          <label class="form-label" style="font-size:0.8rem; color:var(--text-muted);" for="import-stage-comp">Ronde</label>
          <select id="import-stage-comp" class="form-select form-select-sm" bind:value={importStageCompId}>
            {#each appState.competitions as c (c.id)}
              <option value={c.id}>{c.name}</option>
            {/each}
          </select>
        </div>
        <textarea id="import-stages-text" class="form-control form-control-sm mb-2" rows="8"
          placeholder="1, Lille → Dunkerque, 2025-07-05, flat&#10;2, Dunkerque → Boulogne-sur-Mer, 2025-07-06, sprint&#10;..." bind:value={importStagesText}></textarea>
        <div class="d-flex gap-2 align-items-center">
          <button id="btn-import-stages" class="btn btn-primary btn-sm" onclick={importStages}>Importeer Etappes</button>
          <button id="btn-preview-stages" class="btn btn-ghost btn-sm" onclick={previewStages}>Preview</button>
          <span id="import-stages-status" class={importStagesStatus.cls} style="font-size:0.8rem;">{importStagesStatus.text}</span>
        </div>
        <div id="import-stages-preview" class="mt-2" style="font-size:0.8rem;">{@html importStagesPreview}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h5 class="mb-0">PCS Startlijst Ophalen</h5></div>
      <div class="card-body">
        <p class="text-muted" style="font-size:0.8rem;">
          Snel renners ophalen via een ProCyclingStats race-URL.<br>
          Open de browser console (F12) op <a href="https://www.procyclingstats.com" target="_blank" style="color:var(--accent)">procyclingstats.com</a> en plak dit script:
        </p>
        <pre class="p-2" style="background:var(--bg); border:1px solid var(--border); border-radius:8px; font-size:0.72rem; overflow-x:auto; white-space:pre-wrap;"><code id="pcs-script">{PCS_SCRIPT}</code></pre>
        <button class="btn btn-ghost btn-sm mt-1" onclick={() => navigator.clipboard.writeText(PCS_SCRIPT)}>Kopieer script</button>
      </div>
    </div>
  </div>

  <!-- Admin: Pot -->
  <div class="admin-sub" class:active={adminSub === 'admin-pot'} id="admin-pot">
    <div class="card mb-3">
      <div class="card-header"><h5 class="mb-0">💰 Inlegpot beheren</h5></div>
      <div class="card-body">
        <div class="row g-2 align-items-end mb-3">
          <div class="col-auto">
            <label class="form-label mb-1" style="font-size:0.8rem;" for="pot-comp-select">Ronde</label>
            <select id="pot-comp-select" class="form-select form-select-sm" style="min-width:180px;" bind:value={potCompId} onchange={() => loadAdminPot()}>
              {#each appState.competitions as c (c.id)}
                <option value={c.id}>{c.name} ({c.year})</option>
              {/each}
            </select>
          </div>
          <div class="col-auto">
            <div id="pot-total-badge" style="font-size:0.9rem; font-weight:700;">
              {#if potLoaded}
                {#if potEntryFee}
                  💰 <strong>€{potTotal}</strong> in de pot &nbsp;<span class="text-muted" style="font-size:0.8rem;">({potPaidCount} × €{potEntryFee})</span>
                {:else}
                  <span class="text-muted" style="font-size:0.8rem;">Stel inleg in via Rondes-tab</span>
                {/if}
              {/if}
            </div>
          </div>
        </div>
        <div id="pot-players-table">
          {#if potLoaded}
            <table class="table table-sm table-striped">
              <thead><tr><th>Speler</th><th>Betaald</th></tr></thead>
              <tbody>
                {#each potProfiles as p (p.id)}
                  <tr>
                    <td>{p.display_name || p.email || '?'}</td>
                    <td>
                      <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" checked={!!paidMap[p.id]}
                               onchange={(e) => togglePotPayment(potCompId!, p.id, e.currentTarget.checked)}>
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <!-- Admin: audit-log picks -->
  <div class="admin-sub" class:active={adminSub === 'admin-audit'} id="admin-audit">
    <div class="card mb-3">
      <div class="card-header d-flex justify-content-between align-items-center">
        <h5 class="mb-0">🕵️ Audit-log picks</h5>
        <button class="btn btn-sm btn-outline-secondary" onclick={() => loadAdminAudit()}>↻ Vernieuwen</button>
      </div>
      <div class="card-body">
        <p class="text-muted" style="font-size:0.8rem;">Laatste 200 wijzigingen op picks — insert/update/delete, met bron (welke actie het deed) en wie de wijziging deed.</p>
        {#if !auditLoaded}
          <p class="text-muted">Laden…</p>
        {:else if auditRows.length === 0}
          <p class="text-muted">Nog geen wijzigingen gelogd.</p>
        {:else}
          <div class="table-responsive-wrapper">
            <table class="table table-sm table-striped mb-0">
              <thead>
                <tr><th>Tijd</th><th>Speler</th><th>Actie</th><th>Bron</th><th>Etappe</th><th>Renner</th><th>Door</th></tr>
              </thead>
              <tbody>
                {#each auditRows as row (row.id)}
                  <tr>
                    <td style="white-space:nowrap;">{new Date(row.changed_at).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                    <td>{auditProfileMap[row.user_id] || row.user_id}</td>
                    <td>
                      <span class="badge" class:bg-success={row.action === 'insert'} class:bg-warning={row.action === 'update'} class:bg-danger={row.action === 'delete'}>
                        {auditActionLabels[row.action] || row.action}
                      </span>
                    </td>
                    <td><code style="font-size:0.75rem;">{row.source}</code></td>
                    <td>{auditStageMap[row.stage_id] || row.stage_id}</td>
                    <td>
                      {#if row.action === 'update' && row.old_rider_id && row.old_rider_id !== row.rider_id}
                        <span class="text-muted">{auditRiderMap[row.old_rider_id] || row.old_rider_id}</span> → {auditRiderMap[row.rider_id] || row.rider_id}
                      {:else}
                        {auditRiderMap[row.rider_id] || row.rider_id || '—'}
                      {/if}
                    </td>
                    <td>
                      {#if row.changed_by && row.changed_by !== row.user_id}
                        <span class="badge bg-info text-dark">admin: {auditProfileMap[row.changed_by] || row.changed_by}</span>
                      {:else if !row.changed_by}
                        <span class="text-muted" style="font-size:0.75rem;">systeem</span>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Admin: Feedback -->
  <div class="admin-sub" class:active={adminSub === 'admin-feedback'} id="admin-feedback">
    <div class="card">
      <div class="card-header d-flex justify-content-between align-items-center">
        <h5 class="mb-0">Feedback &amp; vragen</h5>
        <button class="btn btn-sm btn-outline-secondary" onclick={() => loadFeedback()}>↻ Vernieuwen</button>
      </div>
      <div class="card-body">
        {#if !feedbackLoaded}
          <p class="text-muted">Laden…</p>
        {:else if feedbackRows.length === 0}
          <p class="text-muted">Nog geen feedback ontvangen.</p>
        {:else}
          <div class="feedback-admin-list">
            {#each feedbackRows as row (row.id)}
              <div class="feedback-admin-item" class:resolved={row.resolved}>
                <div class="feedback-admin-meta">
                  <strong>{row.profiles?.display_name || 'Onbekend'}</strong>
                  <span class="text-muted">· {new Date(row.created_at).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  {#if row.context}<span class="feedback-admin-context">{row.context}</span>{/if}
                  {#if row.resolved}<span class="badge bg-success">afgehandeld</span>{/if}
                </div>
                <div class="feedback-admin-msg">{row.message}</div>
                <div class="feedback-admin-actions">
                  <button class="btn btn-ghost btn-sm" onclick={() => toggleFeedbackResolved(row)}>{row.resolved ? 'Heropenen' : 'Markeer afgehandeld'}</button>
                  <button class="btn btn-ghost btn-sm text-danger" onclick={() => deleteFeedback(row)}>Verwijderen</button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<!-- Admin: keuzes van andere spelers bewerken (modal, was #admin-picks-overlay in index.html) -->
{#if picksModal.open}
  <div id="admin-picks-overlay" class="h2h-overlay" style="display:flex;" role="presentation"
       onclick={(e) => { if (e.target === e.currentTarget) picksModal.open = false; }}>
    <div class="h2h-modal" role="dialog" aria-modal="true" aria-label="Keuzes bewerken" use:focusTrap>
      <div class="h2h-header">
        <h3 id="admin-picks-title">Keuzes — {picksModal.name}</h3>
        <button class="h2h-close" onclick={() => picksModal.open = false}>&times;</button>
      </div>
      <div id="admin-picks-content" class="p-2">
        {#if picksModal.loading}
          <p class="text-muted">Laden…</p>
        {:else if picksModal.error}
          <p class="text-danger">{picksModal.error}</p>
        {:else if picksModal.noStages}
          <p class="text-muted">Geen etappes in deze ronde</p>
        {:else}
          <div class="table-responsive-wrapper">
            <table class="table table-sm table-striped mb-0">
              <thead><tr><th>Etappe</th><th>Huidige keuze</th><th>Wijzigen naar</th><th></th></tr></thead>
              <tbody>
                {#each picksModal.rows as row (row.stage.id)}
                  <tr>
                    <td style="white-space:nowrap;">E{row.stage.stage_number}{row.stage.locked ? ' 🔒' : ''}</td>
                    <td>
                      {#if row.currentRider}
                        {row.currentRider.name}{#if row.pick.is_late}&nbsp;<span class="badge bg-warning">laat</span>{/if}
                      {:else}
                        <span class="text-muted">—</span>
                      {/if}
                    </td>
                    <td>
                      <select class="form-select form-select-sm admin-pick-rider" data-stage-id={row.stage.id} bind:value={row.selRiderId}>
                        <option value="">-- kies --</option>
                        {#each picksModal.ridersSorted as r (r.id)}
                          <option value={r.id} disabled={picksModal.usedRiderIds.has(r.id) && (!row.pick || row.pick.rider_id !== r.id)}>{r.name} ({r.team || ''})</option>
                        {/each}
                      </select>
                      <label style="font-size:0.7rem;" class="mt-1 d-block">
                        <input type="checkbox" class="admin-pick-late" data-stage-id={row.stage.id} bind:checked={row.late}> laat (geen punten)
                      </label>
                    </td>
                    <td style="white-space:nowrap;">
                      <button class="btn btn-sm btn-primary" onclick={() => saveAdminPick(row)}>Opslaan</button>
                      {#if row.pick}<button class="btn btn-sm btn-outline-danger" onclick={() => deleteAdminPick(row)}>×</button>{/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <p class="text-muted mt-2" style="font-size:0.75rem;">Wijzigingen zijn direct van kracht. Punten worden automatisch herberekend.</p>
        {/if}
      </div>
    </div>
  </div>
{/if}
