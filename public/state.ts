// Gedeelde app-state — één mutable object zodat alle modules dezelfde
// referenties zien. Gevuld door init/loaders in app.ts en de views.
export const state: any = {
  session: null,
  profile: null,
  competitions: [] as any[],
  riders: [] as any[],
  stages: [] as any[],
  myPicks: [] as any[],
  dnfRiderIds: new Set<number>(), // renners die globaal DNF zijn in actieve competitie
  selectedRiderId: null as number | null,
  activeCompId: null as number | null,
  _cache: {
    standings: null,
    standingsCompId: null,
    latestStagePicks: null,
    participants: null,
    participantsCompId: null,
    allProfiles: null,
  } as any,
  // Rider lookup map (id → rider) — gebouwd bij loadRidersForComp
  _riderMap: {} as Record<number, any>,
  // Per-etappe startlijst: Map<stageId, Set<riderId>> — gevuld voor klassiekers
  stageRiders: {} as Record<number, Set<number>>,
  // Bijhouden voor welke etappe de rider-dropdowns zijn gevuld
  _riderDropdownStageId: null as number | null,
  // Actieve realtime channel
  _realtimeChannel: null as any,
  _avatarMap: {} as Record<string, string>,
  teamShirts: JSON.parse(localStorage.getItem('bagagedrager_shirts') || '{}'),
  allRiders: [] as any[],
};
