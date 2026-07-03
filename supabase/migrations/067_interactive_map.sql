-- 067: interactieve routekaart (ArcGIS instant app van letour.fr/ASO)
-- Derde etappe-visual naast profiel en statische kaart; lazy geladen als iframe.
alter table stages add column if not exists interactive_map_url text;
