// --- CONFIG ---
export const SUPABASE_URL = 'https://hdkvirtytljnuawcmoui.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhka3ZpcnR5dGxqbnVhd2Ntb3VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMzk4MTMsImV4cCI6MjA4OTkxNTgxM30.CsuQeET1dwzgb1HbL-YVoUW-Jq4OuynR3VgH792SlNk';

export const VAPID_PUBLIC_KEY = 'BHodiDUcQDWpi3kcE5Y6zWPslv5Gzw50tups7rev8hd98zAlMiUHnTSdmvfoa4G1zUycnhf5hVjdg_SiXGRpoPQ';

export const TEAMS: Record<string, { abbr: string; color: string; color2: string }> = {
  // UCI WorldTeams 2026
  'UAE Team Emirates - XRG':        { abbr: 'UAE', color: '#e2001a', color2: '#000000' },
  'Team Visma | Lease a Bike':      { abbr: 'VIS', color: '#ffcc00', color2: '#000000' },
  'Soudal Quick-Step':              { abbr: 'SQS', color: '#0057b8', color2: '#ffffff' },
  'Alpecin - Premier Tech':         { abbr: 'APT', color: '#1d1d5e', color2: '#e31937' },
  'Alpecin-Premier Tech':           { abbr: 'APT', color: '#1d1d5e', color2: '#e31937' },
  'Netcompany INEOS':               { abbr: 'NIN', color: '#8b1a32', color2: '#1d428a' },
  'Netcompany INEOS Cycling Team':  { abbr: 'NIN', color: '#8b1a32', color2: '#1d428a' },
  'INEOS Grenadiers':               { abbr: 'IGD', color: '#8b1a32', color2: '#1d428a' },
  'Red Bull - BORA - hansgrohe':    { abbr: 'RBH', color: '#1a2b5f', color2: '#db0a40' },
  'Lidl - Trek':                    { abbr: 'LTR', color: '#e31937', color2: '#ffffff' },
  'Lotto Intermarché':              { abbr: 'LIM', color: '#e30613', color2: '#ff6f1b' },
  'Bahrain - Victorious':           { abbr: 'TBV', color: '#cc0000', color2: '#ffffff' },
  'Decathlon CMA CGM Team':         { abbr: 'DCM', color: '#0055a4', color2: '#ff6600' },
  'EF Education - EasyPost':        { abbr: 'EFE', color: '#ff69b4', color2: '#341f97' },
  'Groupama - FDJ United':          { abbr: 'GFD', color: '#0055a4', color2: '#ffffff' },
  'Team Jayco AlUla':               { abbr: 'JAY', color: '#00b140', color2: '#000000' },
  'Movistar Team':                  { abbr: 'MOV', color: '#002855', color2: '#00b5e2' },
  'Team Picnic PostNL':             { abbr: 'PPN', color: '#ff6600', color2: '#000000' },
  'Uno-X Mobility':                 { abbr: 'UXT', color: '#ff6600', color2: '#ffffff' },
  'XDS Astana Team':                { abbr: 'AST', color: '#00b5d6', color2: '#ffffff' },
  'NSN Cycling Team':               { abbr: 'NSN', color: '#1a1a2e', color2: '#ffffff' },
  // UCI ProTeams
  'Cofidis':                        { abbr: 'COF', color: '#cc0000', color2: '#ffffff' },
  'TotalEnergies':                  { abbr: 'TEN', color: '#ffd100', color2: '#0055a4' },
  'Unibet Rose Rockets':            { abbr: 'URR', color: '#e91e8c', color2: '#ffffff' },
  'Tudor Pro Cycling Team':         { abbr: 'TUD', color: '#8b0000', color2: '#1a2b5f' },
  'Bardiani CSF 7 Saber':           { abbr: 'BAR', color: '#006400', color2: '#cc0000' },
  'Burgos Burpellet BH':            { abbr: 'BUR', color: '#8b0000', color2: '#ffffff' },
  'Caja Rural - Seguros RGA':       { abbr: 'CJR', color: '#2d6a2d', color2: '#ffffff' },
  'Equipo Kern Pharma':             { abbr: 'EKP', color: '#004080', color2: '#ffffff' },
  'Euskaltel - Euskadi':            { abbr: 'EUS', color: '#ff6200', color2: '#000000' },
  'Modern Adventure Pro Cycling':   { abbr: 'MAP', color: '#1a1a2e', color2: '#ffffff' },
  'Pinarello Q36.5 Pro Cycling Team': { abbr: 'PQT', color: '#003366', color2: '#c8a000' },
  'Team Flanders - Baloise':        { abbr: 'TFB', color: '#1a1a1a', color2: '#ffd700' },
  'Team Novo Nordisk':              { abbr: 'TNN', color: '#003e7e', color2: '#ffffff' },
  'Team Polti VisitMalta':          { abbr: 'TPV', color: '#ff6600', color2: '#ffffff' },
  // Overige teams in DB
  'BEAT CC p/b Saxo':               { abbr: 'BEA', color: '#003399', color2: '#ffffff' },
  'Tarteletto - Isorex':            { abbr: 'TAR', color: '#0055a0', color2: '#e30613' },
};
