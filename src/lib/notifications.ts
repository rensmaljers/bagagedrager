import { state } from './state.svelte';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TEAMS, VAPID_PUBLIC_KEY } from './config';
import { $, escapeHtml, formatTime, formatGap, formatDeadline, riderDisplay, avatarHtml, compBadge, skeletonRows, toast, confettiBurst } from './utils';
import { supabase } from './supabase-client';
import { icon } from './icons';
import { supaDelete, supaRest } from './api';
import { activeStages } from './helpers';

// --- DEADLINE NOTIFICATIONS ---
let _deadlineInterval: ReturnType<typeof setInterval> | null = null;

export function setupDeadlineNotifications() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
  // Check every minute for upcoming deadlines.
  // initApp draait opnieuw bij herlogin — oude interval eerst opruimen,
  // anders stapelen ze per login/logout-cyclus.
  if (_deadlineInterval) clearInterval(_deadlineInterval);
  _deadlineInterval = setInterval(checkDeadlineNotifications, 60000);
  checkDeadlineNotifications();
}

function checkDeadlineNotifications() {
  if (!state.session) return;
  if (Notification.permission !== 'granted') return;
  const now = new Date();
  const compStages = activeStages();
  for (const s of compStages) {
    if (s.locked) continue;
    const deadline = new Date(s.start_time || s.deadline);
    const diff = deadline - now;
    // Notify 30 min before (between 29-31 min window to avoid duplicates)
    if (diff > 0 && diff <= 31 * 60000 && diff > 29 * 60000) {
      const hasPick = state.myPicks.some(p => p.stage_id === s.id);
      if (!hasPick) {
        new Notification('🚴 Bagagedrager', {
          body: `Nog 30 minuten om een renner te kiezen voor Etappe ${s.stage_number}!`,
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🚴</text></svg>',
          tag: `deadline-${s.id}`,
        });
      }
    }
    // Also notify at 5 min
    if (diff > 0 && diff <= 6 * 60000 && diff > 4 * 60000) {
      const hasPick = state.myPicks.some(p => p.stage_id === s.id);
      if (!hasPick) {
        new Notification('⚠️ Bagagedrager', {
          body: `Nog 5 minuten! Kies snel een renner voor Etappe ${s.stage_number}!`,
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🚴</text></svg>',
          tag: `deadline-urgent-${s.id}`,
        });
      }
    }
  }
}


// =====================
// PUSH NOTIFICATIES
// =====================

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function getSwRegistration() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  return navigator.serviceWorker.ready;
}

async function getCurrentPushSubscription() {
  const reg = await getSwRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export async function updateNotificationButton() {
  const btn = $('btn-notifications');
  if (!btn) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    btn.textContent = 'Niet beschikbaar';
    btn.disabled = true;
    // iOS Safari ondersteunt web push alleen in een geïnstalleerde PWA
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
    if (isIos && !isStandalone && !document.getElementById('ios-push-hint')) {
      btn.insertAdjacentHTML('afterend',
        `<div id="ios-push-hint" style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">` +
        `Op iPhone/iPad werken meldingen alleen als de app op je beginscherm staat: ` +
        `open het deelmenu <span aria-hidden="true">⎋</span> en kies <strong>Zet op beginscherm</strong>.</div>`);
    }
    return;
  }
  const sub = await getCurrentPushSubscription();
  const perm = Notification.permission;
  if (sub && perm === 'granted') {
    btn.textContent = '🔔 Aan';
    btn.className = 'btn btn-sm btn-success';
  } else {
    btn.textContent = '🔕 Uit';
    btn.className = 'btn btn-sm btn-outline-secondary';
  }
}

async function subscribeNotifications() {
  const btn = $('btn-notifications');
  const sub = await getCurrentPushSubscription();
  if (sub) {
    // Uitschakelen
    await sub.unsubscribe();
    await supaDelete('push_subscriptions', `endpoint=eq.${encodeURIComponent(sub.endpoint)}`);
    await updateNotificationButton();
    return;
  }
  // Inschakelen
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notificaties zijn geblokkeerd in je browser.', 'warning'); return; }

  try {
    const reg = await getSwRegistration();
    const newSub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const json = newSub.toJSON();
    // Vervang alleen de subscription van dít apparaat — andere apparaten
    // (telefoon/laptop) houden hun eigen subscription
    await supaDelete('push_subscriptions', `endpoint=eq.${encodeURIComponent(json.endpoint)}`);
    await supaRest('push_subscriptions', {
      method: 'POST',
      body: { user_id: state.session.user.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth_key: json.keys.auth },
    });
    await updateNotificationButton();
    toast('Notificaties ingeschakeld!', 'success');
  } catch (e) {
    toast('Kon notificaties niet inschakelen: ' + e.message, 'error');
  }
}

// Knop koppelen (wordt aangeroepen als account tab laadt)
document.addEventListener('click', e => {
  if (e.target.id === 'btn-notifications') subscribeNotifications();
});
