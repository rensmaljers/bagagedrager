import { state } from './state.svelte';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TEAMS, VAPID_PUBLIC_KEY } from './config';
import { $, escapeHtml, formatTime, formatGap, formatDeadline, riderDisplay, avatarHtml, compBadge, skeletonRows, toast, confettiBurst } from './utils';
import { supabase } from './supabase-client';
import { icon } from './icons';


// Zoek foto bij rider_id
export function riderPhoto(riderId) {
  return state._riderMap[riderId]?.photo_url || null;
}

// Avatar cache for standings (populated when profiles load)

// Team shirt URLs from PCS (populated via sync or manually)

export function teamBadge(teamName) {
  const t = TEAMS[teamName];
  const safe = escapeHtml(teamName || '');
  const shirtUrl = state.teamShirts[teamName];
  const shirtImg = shirtUrl ? `<img src="${shirtUrl}" class="team-shirt" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'">` : '';

  if (!t) {
    if (shirtImg) return `<span class="team-badge">${shirtImg}<span class="team-abbr">${safe}</span></span>`;
    return `<span class="team-badge"><span class="team-dot" style="background:var(--text-muted)"></span><span class="team-abbr">${safe}</span></span>`;
  }
  if (shirtImg) return `<span class="team-badge">${shirtImg}<span class="team-abbr">${escapeHtml(t.abbr)}</span></span>`;
  return `<span class="team-badge"><span class="team-dot" style="background:${t.color};box-shadow:inset -3px -3px 0 ${t.color2}"></span><span class="team-abbr">${escapeHtml(t.abbr)}</span></span>`;
}

export function showError(msg) {
  const el = $('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
}

export function activeStages() {
  return state.stages.filter(s => s.competition_id === state.activeCompId);
}

export function activeScoringMode() {
  const comp = state.competitions.find(c => c.id === state.activeCompId);
  return comp?.scoring_mode || 'grand_tour';
}

// Build PCS stage URL: stage-level URL heeft voorrang, anders competitie-level
export function buildPcsStageUrl(comp, stageNumber, stage) {
  // Stage heeft eigen PCS URL (klassiekers-bundel)
  if (stage?.pcs_url) {
    const base = stage.pcs_url.replace(/\/$/, '').replace(/\/(stages|startlist|gc|stage-\d+|results?|resuts)$/, '');
    return `${base}/result`;
  }
  if (!comp?.pcs_url) return null;
  const base = comp.pcs_url.replace(/\/$/, '').replace(/\/(stages|startlist|gc|stage-\d+|results?|resuts)$/, '');
  if (comp.is_one_day) return `${base}/result`;
  if (stageNumber === 0) return `${base}/prologue`;
  return `${base}/stage-${stageNumber}`;
}

export function updateCompBanner() {
  applyCompColor();
  updateSyncInfo();
}

export function updateCompSelectOptions() {
  const sel = $('comp-select');
  const prev = sel.value;
  const activeComps = state.competitions.filter(c => c.is_active);
  sel.innerHTML = activeComps.map(c =>
    `<option value="${c.id}">${c.country_flag || ''} ${c.name}</option>`
  ).join('');
  $('comp-count').textContent = activeComps.length > 1 ? `${activeComps.length} rondes` : '';
  if (prev && activeComps.find(c => String(c.id) === prev)) {
    sel.value = prev;
  } else if (activeComps.length) {
    // Huidig activeCompId is niet meer actief — val terug op eerste actieve ronde
    sel.value = String(activeComps[0].id);
    state.activeCompId = activeComps[0].id;
    state._cache.standings = null;
    state._cache.participants = null;
  }
}

export function updateSyncInfo() {
  const comp = state.competitions.find(c => c.id === state.activeCompId);
  const el = $('comp-sync-info');
  if (!el) return;
  if (comp?.last_synced_at) {
    const d = new Date(comp.last_synced_at);
    el.textContent = `Gesynct: ${d.toLocaleString('nl-NL', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}`;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

export function applyCompColor() {
  const comp = state.competitions.find(c => c.id === state.activeCompId);
  const color = comp?.color || '#facc15';
  // Optioneel ronde-logo in de navbar (sfeer per ronde)
  const logo = $('comp-logo') as HTMLImageElement | null;
  if (logo) {
    if (comp?.logo_url) {
      logo.src = comp.logo_url;
      logo.style.display = '';
    } else {
      logo.style.display = 'none';
      logo.removeAttribute('src');
    }
  }
  document.documentElement.style.setProperty('--comp-color', color);
  // Apply to comp-select
  const sel = $('comp-select');
  if (sel) {
    sel.style.borderColor = color + '60';
    sel.style.background = color + '10';
  }
  // Apply to active nav tab underline
  document.querySelectorAll('#main-tabs .nav-link.active').forEach(n => {
    (n as HTMLElement).style.borderBottomColor = color;
  });
  // Apply to stage timeline dots (open state)
  document.documentElement.style.setProperty('--comp-accent', color);
  // Apply to browser theme-color (adresbalk op mobiel)
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);
}

