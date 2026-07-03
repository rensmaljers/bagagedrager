// ============================================================
// Bagagedrager — SVG icon library (Lucide-style, stroke-based)
// Usage: icon('clock') → SVG HTML string
// ============================================================

const PATHS: Record<string, string> = {
  // --- Cycling classifications ---
  jersey:    `<path d="M8.5 3L3 7.5l2.5 2.5V19h13V10l2.5-2.5L13.5 3Q12 5 10.5 5 9 5 8.5 3z" stroke-linejoin="round"/>`,
  clock:     `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
  zap:       `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
  mountain:  `<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>`,
  trophy:    `<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>`,
  target:    `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>`,
  medal:     `<circle cx="12" cy="16" r="5"/><path d="M8.56 2.9A7 7 0 0 1 19 9v1h-2"/><path d="M7 10.72V9a7 7 0 0 1 .89-3.45"/>`,

  // --- Stage types ---
  'type-flat':     `<path d="M5 12h14M12 5l7 7-7 7"/>`,
  'type-mountain': `<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>`,
  'type-tt':       `<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/>`,
  'type-sprint':   `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
  'type-hills':    `<path d="M3 20h18M4 20 8 11l4 6 3-4 5 7"/>`,

  // --- Rider specialties ---
  'spec-climber':  `<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>`,
  'spec-sprint':   `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
  'spec-gc':       `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
  'spec-tt':       `<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/>`,
  'spec-oneday':   `<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>`,
  'spec-hills':    `<path d="M3 20h18M4 20 8 11l4 6 3-4 5 7"/>`,

  // --- Peloton roles ---
  crown:     `<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/>`,
  star:      `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`,
  shield:    `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`,
  muscle:    `<path d="M14.5 17.5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V14l-1-1V9a1 1 0 0 1 2 0v3h1V4a1 1 0 0 1 2 0v8h1V3a1 1 0 0 1 2 0v9h1V5a1 1 0 0 1 2 0v12.5z"/>`,
  bike:      `<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>`,
  car:       `<path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h11l4 4v4a2 2 0 0 1-2 2h-1"/><circle cx="7" cy="17" r="2"/><circle cx="16" cy="17" r="2"/><path d="M14 7V5a2 2 0 0 0-2-2H3"/>`,

  // --- UI icons ---
  lock:      `<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
  bell:      `<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>`,
  settings:  `<circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>`,
  book:      `<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>`,
  users:     `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
  sun:       `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`,
  moon:      `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`,
  refresh:   `<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>`,
  chart:     `<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>`,
  camera:    `<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>`,
  flag:      `<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>`,
  calendar:  `<rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>`,
  clipboard: `<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>`,
  cyclist:   `<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17 8.5 10l3-2.5L14 11h4"/>`,
  wheel:     `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="12" y1="15" x2="12" y2="22"/><line x1="2" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="22" y2="12"/>`,
};

/**
 * Render an SVG icon as an HTML string.
 * @param name  Icon name from PATHS
 * @param cls   Extra CSS classes (optional)
 * @param size  Width/height in px (default 16)
 */
export function icon(name: string, cls = '', size = 16): string {
  const path = PATHS[name] ?? '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon${cls ? ' ' + cls : ''}" aria-hidden="true">${path}</svg>`;
}

/** Inline SVG for use inside HTML attributes or static HTML (no class/size args). */
export function iconHtml(name: string, extraAttrs = ''): string {
  const path = PATHS[name] ?? '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extraAttrs}>${path}</svg>`;
}
