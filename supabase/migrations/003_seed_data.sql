-- ============================================
-- SEED DATA (tijdelijk - later vervangen)
-- ============================================

-- Maak 'rens' admin (werkt ongeacht hoe je je hebt aangemeld)
UPDATE profiles SET is_admin = true
WHERE lower(display_name) = 'rens'
   OR lower(display_name) LIKE 'rens%';

-- ============================================
-- COMPETITIES
-- ============================================
INSERT INTO competitions (name, slug, competition_type, year, is_active) VALUES
  ('Tour de France 2025', 'tour-2025', 'tour', 2025, false),
  ('Giro d''Italia 2025', 'giro-2025', 'giro', 2025, false),
  ('Vuelta a España 2025', 'vuelta-2025', 'vuelta', 2025, false),
  ('Parijs-Roubaix 2025', 'roubaix-2025', 'classic', 2025, false),
  ('Ronde van Vlaanderen 2025', 'vlaanderen-2025', 'classic', 2025, false),
  ('Tour de Fazant 2026', 'fazant-2026', 'tour', 2026, true)
ON CONFLICT (slug) DO NOTHING;

-- ============================================
-- RENNERS (placeholder - bib nummers zijn fictief)
-- ============================================
INSERT INTO riders (bib_number, name, team) VALUES
  -- UAE Team Emirates
  (1,  'Tadej Pogačar',          'UAE Team Emirates'),
  (2,  'Adam Yates',             'UAE Team Emirates'),
  (3,  'Juan Ayuso',             'UAE Team Emirates'),
  (4,  'Marc Soler',             'UAE Team Emirates'),
  (5,  'Tim Wellens',            'UAE Team Emirates'),
  -- Visma-Lease a Bike
  (11, 'Jonas Vingegaard',       'Visma-Lease a Bike'),
  (12, 'Wout van Aert',          'Visma-Lease a Bike'),
  (13, 'Matteo Jorgenson',       'Visma-Lease a Bike'),
  (14, 'Dylan van Baarle',       'Visma-Lease a Bike'),
  (15, 'Sepp Kuss',              'Visma-Lease a Bike'),
  -- Soudal Quick-Step
  (21, 'Remco Evenepoel',        'Soudal Quick-Step'),
  (22, 'Mikel Landa',            'Soudal Quick-Step'),
  (23, 'Tim Merlier',            'Soudal Quick-Step'),
  (24, 'Kasper Asgreen',         'Soudal Quick-Step'),
  (25, 'Yves Lampaert',          'Soudal Quick-Step'),
  -- Alpecin-Deceuninck
  (31, 'Mathieu van der Poel',   'Alpecin-Deceuninck'),
  (32, 'Jasper Philipsen',       'Alpecin-Deceuninck'),
  (33, 'Kaden Groves',           'Alpecin-Deceuninck'),
  -- INEOS Grenadiers
  (41, 'Carlos Rodríguez',       'INEOS Grenadiers'),
  (42, 'Tom Pidcock',            'INEOS Grenadiers'),
  (43, 'Egan Bernal',            'INEOS Grenadiers'),
  (44, 'Ben Turner',             'INEOS Grenadiers'),
  -- Red Bull-BORA-hansgrohe
  (51, 'Primož Roglič',          'Red Bull-BORA-hansgrohe'),
  (52, 'Aleksandr Vlasov',       'Red Bull-BORA-hansgrohe'),
  (53, 'Jai Hindley',            'Red Bull-BORA-hansgrohe'),
  -- Lidl-Trek
  (61, 'Mads Pedersen',          'Lidl-Trek'),
  (62, 'Giulio Ciccone',         'Lidl-Trek'),
  (63, 'Jonathan Milan',         'Lidl-Trek'),
  -- Intermarché-Wanty
  (71, 'Biniam Girmay',          'Intermarché-Wanty'),
  (72, 'Tom Dumoulin',           'Intermarché-Wanty'),
  -- Bahrain Victorious
  (81, 'Jack Haig',              'Bahrain Victorious'),
  (82, 'Phil Bauhaus',           'Bahrain Victorious'),
  -- Decathlon AG2R
  (91, 'Ben O''Connor',          'Decathlon AG2R'),
  (92, 'Felix Gall',             'Decathlon AG2R'),
  -- EF Education-EasyPost
  (101, 'Richard Carapaz',       'EF Education-EasyPost'),
  (102, 'Ben Healy',             'EF Education-EasyPost'),
  -- Groupama-FDJ
  (111, 'David Gaudu',           'Groupama-FDJ'),
  (112, 'Arnaud Démare',         'Groupama-FDJ'),
  -- Jayco-AlUla
  (121, 'Simon Yates',           'Jayco-AlUla'),
  (122, 'Michael Matthews',      'Jayco-AlUla'),
  -- Movistar
  (131, 'Enric Mas',             'Movistar'),
  -- Cofidis
  (141, 'Guillaume Martin',      'Cofidis'),
  -- Lotto-Dstny
  (151, 'Maxim Van Gils',        'Lotto-Dstny'),
  (152, 'Arnaud De Lie',         'Lotto-Dstny'),
  -- DSM-firmenich PostNL
  (161, 'Romain Bardet',         'dsm-firmenich PostNL'),
  (162, 'Frank van den Broek',   'dsm-firmenich PostNL'),
  -- Astana
  (171, 'Mark Cavendish',        'Astana Qazaqstan'),
  (172, 'Alexey Lutsenko',       'Astana Qazaqstan'),
  -- TotalEnergies
  (181, 'Peter Sagan',           'TotalEnergies'),
  -- Uno-X Mobility
  (191, 'Tobias Halland Johannessen', 'Uno-X Mobility')
ON CONFLICT (bib_number) DO NOTHING;

-- ============================================
-- TOUR DE FRANCE 2025 ETAPPES (placeholder data)
-- Datums en routes zijn indicatief!
-- ============================================
DO $$
DECLARE
  tour_id int;
BEGIN
  SELECT id INTO tour_id FROM competitions WHERE slug = 'tour-2025';

  INSERT INTO stages (stage_number, name, date, stage_type, deadline, locked, competition_id) VALUES
    (1,  'Lille → Dunkerque',              '2025-07-05', 'flat',     '2025-07-04 21:00:00+00', false, tour_id),
    (2,  'Dunkerque → Boulogne-sur-Mer',   '2025-07-06', 'sprint',  '2025-07-05 21:00:00+00', false, tour_id),
    (3,  'Valenciennes → Laon',            '2025-07-07', 'flat',     '2025-07-06 21:00:00+00', false, tour_id),
    (4,  'Laon → Reims',                   '2025-07-08', 'flat',     '2025-07-07 21:00:00+00', false, tour_id),
    (5,  'Troyes → Mulhouse',              '2025-07-09', 'mountain', '2025-07-08 21:00:00+00', false, tour_id),
    (6,  'Mulhouse → Planche des Belles Filles', '2025-07-10', 'mountain', '2025-07-09 21:00:00+00', false, tour_id),
    (7,  'Belfort → Le Markstein',         '2025-07-11', 'mountain', '2025-07-10 21:00:00+00', false, tour_id),
    (8,  'Rustdag',                        '2025-07-12', 'flat',     '2025-07-11 21:00:00+00', false, tour_id),
    (9,  'Mâcon → Saint-Étienne',          '2025-07-13', 'flat',     '2025-07-12 21:00:00+00', false, tour_id),
    (10, 'Saint-Étienne → Le Mont Ventoux', '2025-07-14', 'mountain', '2025-07-13 21:00:00+00', false, tour_id),
    (11, 'Montélimar → Serre Chevalier',   '2025-07-15', 'mountain', '2025-07-14 21:00:00+00', false, tour_id),
    (12, 'Briançon → Alpe d''Huez',        '2025-07-16', 'mountain', '2025-07-15 21:00:00+00', false, tour_id),
    (13, 'Grenoble → Grenoble (TT)',       '2025-07-17', 'tt',       '2025-07-16 21:00:00+00', false, tour_id),
    (14, 'Rustdag',                        '2025-07-18', 'flat',     '2025-07-17 21:00:00+00', false, tour_id),
    (15, 'Carcassonne → Toulouse',         '2025-07-19', 'flat',     '2025-07-18 21:00:00+00', false, tour_id),
    (16, 'Toulouse → Peyragudes',          '2025-07-20', 'mountain', '2025-07-19 21:00:00+00', false, tour_id),
    (17, 'Saint-Gaudens → Plateau de Beille', '2025-07-21', 'mountain', '2025-07-20 21:00:00+00', false, tour_id),
    (18, 'Pau → Luz Ardiden',              '2025-07-22', 'mountain', '2025-07-21 21:00:00+00', false, tour_id),
    (19, 'Bordeaux → Libourne',            '2025-07-23', 'sprint',  '2025-07-22 21:00:00+00', false, tour_id),
    (20, 'Libourne → Périgueux (TT)',      '2025-07-24', 'tt',       '2025-07-23 21:00:00+00', false, tour_id),
    (21, 'Paris → Champs-Élysées',         '2025-07-25', 'sprint',  '2025-07-24 21:00:00+00', false, tour_id)
  ON CONFLICT (competition_id, stage_number) DO NOTHING;
END $$;

-- ============================================
-- TOUR DE FAZANT 2026 ETAPPES (fake data)
-- Start 2 mei 2026, 10 etappes
-- ============================================
DO $$
DECLARE
  fazant_id int;
BEGIN
  SELECT id INTO fazant_id FROM competitions WHERE slug = 'fazant-2026';

  INSERT INTO stages (stage_number, name, date, stage_type, deadline, locked, competition_id) VALUES
    (1,  'Het Nest → De Korenvelden',       '2026-05-02', 'flat',     '2026-05-01 21:00:00+00', false, fazant_id),
    (2,  'De Korenvelden → Bosrand',         '2026-05-03', 'sprint',  '2026-05-02 21:00:00+00', false, fazant_id),
    (3,  'Bosrand → Heuvelrug',              '2026-05-04', 'mountain','2026-05-03 21:00:00+00', false, fazant_id),
    (4,  'Heuvelrug → De Polder',            '2026-05-05', 'flat',    '2026-05-04 21:00:00+00', false, fazant_id),
    (5,  'De Polder → Duintoppen',           '2026-05-06', 'mountain','2026-05-05 21:00:00+00', false, fazant_id),
    (6,  'Rustdag',                          '2026-05-07', 'flat',    '2026-05-06 21:00:00+00', false, fazant_id),
    (7,  'Duintoppen → Moerasvlakte (TT)',   '2026-05-08', 'tt',      '2026-05-07 21:00:00+00', false, fazant_id),
    (8,  'Moerasvlakte → Het Woud',          '2026-05-09', 'mountain','2026-05-08 21:00:00+00', false, fazant_id),
    (9,  'Het Woud → Fazantenhof',           '2026-05-10', 'sprint',  '2026-05-09 21:00:00+00', false, fazant_id),
    (10, 'Fazantenhof → De Gouden Veer',     '2026-05-11', 'flat',    '2026-05-10 21:00:00+00', false, fazant_id)
  ON CONFLICT (competition_id, stage_number) DO NOTHING;
END $$;
