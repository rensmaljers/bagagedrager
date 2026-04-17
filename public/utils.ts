// --- DOM HELPER ---
export function $(id: string): any { return document.getElementById(id); }

// --- HTML ESCAPING ---
export function escapeHtml(str: any): string {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// --- FORMAT HELPERS ---
export function formatTime(totalSeconds: number): string {
  if (!totalSeconds) return '-';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

export function formatGap(seconds: number, showZeroAsTime?: boolean): string {
  if (seconds == null) return '-';
  const neg = seconds < 0;
  const abs = Math.abs(seconds);
  if (abs === 0) return showZeroAsTime ? '0:00' : 'z.t.';
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const prefix = neg ? '-' : '+';
  if (h > 0) return `${prefix}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${prefix}${m}:${String(s).padStart(2, '0')}`;
}

export function formatDeadline(dt: string): string {
  return new Date(dt).toLocaleString('nl-NL', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// --- RIDER / AVATAR DISPLAY ---
export function riderDisplay(name: string, photoUrl: string, extra = ''): string {
  const hasPhoto = photoUrl && photoUrl !== 'none';
  const photo = hasPhoto ? `<img src="${escapeHtml(photoUrl)}" class="rider-photo" alt="" onerror="this.style.display='none'">` : '';
  return `<span class="d-inline-flex align-items-center gap-1">${photo}${escapeHtml(name || '?')}${extra}</span>`;
}

export function avatarHtml(name: string, avatarUrl: string, size: string): string {
  const cls = size === 'sm' ? 'avatar avatar-sm' : size === 'lg' ? 'avatar avatar-lg' : 'avatar';
  const initials = (name || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  if (avatarUrl) {
    return `<span class="${cls}"><img src="${escapeHtml(avatarUrl)}" alt="" onerror="this.parentElement.innerHTML='${initials}'"></span>`;
  }
  return `<span class="${cls}">${initials}</span>`;
}

// --- BADGE HELPERS ---
export function compBadge(type: string): string {
  const cls: Record<string, string> = { tour: 'comp-tour', giro: 'comp-giro', vuelta: 'comp-vuelta', classic: 'comp-classic' };
  const labels: Record<string, string> = { tour: 'Tour', giro: 'Giro', vuelta: 'Vuelta', classic: 'Klassieker' };
  return `<span class="comp-badge ${cls[type] || 'comp-classic'}">${labels[type] || type}</span>`;
}

// --- SKELETON LOADING ---
export function skeletonRows(count = 5): string {
  return Array.from({ length: count }, () =>
    `<tr><td colspan="3"><div class="skeleton skeleton-row"></div></td></tr>`
  ).join('');
}

// --- TOAST NOTIFICATIONS ---
export function toast(message: string, type = 'info', duration = 3500): void {
  const icons: Record<string, string> = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${escapeHtml(message)}</span>`;
  $('toast-container').appendChild(el);
  setTimeout(() => { el.classList.add('removing'); setTimeout(() => el.remove(), 300); }, duration);
}

// --- CONFETTI ---
export function confettiBurst(): void {
  const container = document.createElement('div');
  container.className = 'confetti-burst';
  const colors = ['var(--accent)', 'var(--green)', 'var(--red)', 'var(--purple)', 'var(--blue)'];
  for (let i = 0; i < 24; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    const angle = (Math.PI * 2 * i) / 24 + (Math.random() - 0.5) * 0.5;
    const dist = 60 + Math.random() * 80;
    p.style.cssText = `background:${colors[i % colors.length]};--cx:${Math.cos(angle) * dist}px;--cy:${Math.sin(angle) * dist - 40}px;--cr:${Math.random() * 720}deg;`;
    container.appendChild(p);
  }
  document.body.appendChild(container);
  setTimeout(() => container.remove(), 1100);
}
