// Gedeelde app-state als Svelte 5 runes-store.
// Zelfde vorm als public/state.ts, maar $state maakt alle velden reactief:
// componenten die state.x lezen her-renderen automatisch bij mutatie.
// Mutatie-stijl blijft gelijk aan de vanilla-app: `state.riders = [...]`.
export const state: any = $state({
  session: null,
  profile: null,
  competitions: [] as any[],
  riders: [] as any[],
  stages: [] as any[],
  myPicks: [] as any[],
  dnfRiderIds: new Set<number>(),
  selectedRiderId: null as number | null,
  activeCompId: null as number | null,
  // Caches — geen $state nodig maar meegenomen voor 1-op-1 compatibiliteit
  _cache: {
    standings: null,
    standingsCompId: null,
    latestStagePicks: null,
    participants: null,
    participantsCompId: null,
    allProfiles: null,
  } as any,
  _riderMap: {} as Record<number, any>,
  stageRiders: {} as Record<number, Set<number>>,
  _riderDropdownStageId: null as number | null,
  _realtimeChannel: null as any,
  _avatarMap: {} as Record<string, string>,
  teamShirts: JSON.parse(localStorage.getItem('bagagedrager_shirts') || '{}'),
  allRiders: [] as any[],
});

// UI-state die in de vanilla-app impliciet in de DOM leefde
export const ui: any = $state({
  activeTab: 'dashboard',      // dashboard | pick | history | peloton | admin
  authScreen: true,            // login/signup zichtbaar
  loading: true,               // eerste boot
  toast: null as { msg: string; type: string } | null,
  playerModalId: null as string | null,   // user_id → speler-detailmodal open
  riderModalId: null as number | null,    // rider id → renner-detailmodal open
  h2hRequest: null as { name: string; mode: string } | null, // Dashboard opent H2H zodra gemount
});
