-- 065: officiële etappe-visuals (letour.fr / ASO)
-- PCS-profielen zijn functioneel maar kaal; de officiële ASO-afbeeldingen
-- (profiel + routekaart) zijn een stuk mooier. Aparte kolommen zodat
-- auto-sync (die profile_image_url ververst vanaf PCS) ze niet overschrijft.

alter table stages
  add column if not exists official_profile_image_url text,
  add column if not exists route_map_url text;
