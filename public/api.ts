import { state } from './state';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TEAMS, VAPID_PUBLIC_KEY } from './config';
import { $, escapeHtml, formatTime, formatGap, formatDeadline, riderDisplay, avatarHtml, compBadge, skeletonRows, toast, confettiBurst } from './utils';
import { supabase } from './supabase-client';
import { icon } from './icons';

// --- SUPABASE REST HELPERS ---
function authHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, ...extra };
  if (state.session?.access_token) h['Authorization'] = `Bearer ${state.session.access_token}`;
  return h;
}

export async function supaRest(table: string, { method = 'GET', filters = '', body = undefined as any, select = '*' } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}${filters ? '&' + filters : ''}`;
  const prefer = method === 'POST' || method === 'PATCH' ? 'return=representation' : '';
  const opts: any = { method, headers: authHeaders({ 'Prefer': prefer }) };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function supaDelete(table, filters) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filters}`;
  const res = await fetch(url, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
}

export async function supaPatch(table, filters, body) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filters}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: authHeaders({ 'Prefer': 'return=representation' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function supaUpsert(table: string, body: any) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Prefer': 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Call a Postgres RPC function via Supabase client
export async function supaRpc(fnName, params = {}) {
  const { data, error } = await supabase.rpc(fnName, params);
  if (error) throw new Error(error.message);
  return data;
}

