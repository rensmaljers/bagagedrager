import { state } from './state.svelte';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TEAMS, VAPID_PUBLIC_KEY } from './config';
import { $, escapeHtml, formatTime, formatGap, formatDeadline, riderDisplay, avatarHtml, compBadge, skeletonRows, toast, confettiBurst } from './utils';
import { supabase } from './supabase-client';
import { icon } from './icons';

// --- AUTH ---
export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(dutchAuthError(error.message));
  return data.session;
}

function dutchAuthError(msg) {
  if (!msg) return 'Er ging iets mis, probeer het later opnieuw.';
  const lower = msg.toLowerCase();
  if (lower.includes('database error saving new user') || lower.includes('maximum number of players')) return 'Fout bij aanmaken: ' + msg;
  if (lower.includes('user already registered')) return 'Dit e-mailadres is al geregistreerd. Probeer in te loggen.';
  if (lower.includes('invalid login credentials')) return 'Onjuist e-mailadres of wachtwoord.';
  if (lower.includes('email not confirmed')) return 'Je e-mail is nog niet bevestigd. Check je inbox.';
  if (lower.includes('password should be at least')) return 'Wachtwoord moet minimaal 6 tekens zijn.';
  if (lower.includes('unable to validate email')) return 'Ongeldig e-mailadres.';
  if (lower.includes('rate limit')) return 'Te veel pogingen. Wacht even en probeer opnieuw.';
  if (lower.includes('signup is disabled')) return 'Aanmelden is momenteel uitgeschakeld.';
  if (lower.includes('anonymous sign-ins are disabled')) return 'Vul je e-mailadres en wachtwoord in.';
  return msg;
}

export async function signup(email, password, displayName) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { display_name: displayName } },
  });
  if (error) throw new Error(dutchAuthError(error.message));
  return data;
}
