import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { importVapidPrivateKey, sendPush } from "../_shared/webpush.ts";

// Stuurt een testmelding naar de ingelogde admin.
// Alleen beschikbaar voor admins (gecontroleerd via profiles.is_admin).

const VAPID_PUBLIC_KEY = "BHodiDUcQDWpi3kcE5Y6zWPslv5Gzw50tups7rev8hd98zAlMiUHnTSdmvfoa4G1zUycnhf5hVjdg_SiXGRpoPQ";
const VAPID_SUBJECT = "https://hdkvirtytljnuawcmoui.supabase.co";

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Haal ingelogde gebruiker op via auth header
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Niet ingelogd" }), { status: 401 });
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Ongeldige sessie" }), { status: 401 });
  }

  // Controleer admin
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) {
    return new Response(JSON.stringify({ error: "Geen toegang" }), { status: 403 });
  }

  const vapidPrivateKeyRaw = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!vapidPrivateKeyRaw) {
    return new Response(JSON.stringify({ error: "VAPID_PRIVATE_KEY niet ingesteld" }), { status: 500 });
  }
  const privateKey = await importVapidPrivateKey(vapidPrivateKeyRaw, VAPID_PUBLIC_KEY);

  // Haal push subscriptions op voor deze gebruiker
  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth_key")
    .eq("user_id", user.id);

  if (!subscriptions?.length) {
    return new Response(JSON.stringify({ error: "Geen push subscription gevonden. Schakel eerst app-meldingen in." }), { status: 404 });
  }

  const payload = {
    title: "🚴 Bagagedrager — Testmelding",
    body: "Push notificaties werken correct!",
    url: "/#account",
  };

  let sent = 0;
  const details: object[] = [];
  for (const sub of subscriptions) {
    const endpointDomain = (() => { try { return new URL(sub.endpoint).hostname; } catch { return sub.endpoint.slice(0, 40); } })();
    try {
      const res = await sendPush(sub.endpoint, sub, payload, privateKey, VAPID_PUBLIC_KEY, VAPID_SUBJECT);
      const body = await res.text().catch(() => "");
      const ok = res.ok || res.status === 201;
      if (ok) sent++;
      details.push({ endpoint: endpointDomain, status: res.status, ok, body: body.slice(0, 200) });
    } catch (e: any) {
      details.push({ endpoint: endpointDomain, error: e.message });
    }
  }

  return new Response(
    JSON.stringify({ sent, subscriptions: subscriptions.length, details }),
    { headers: { "Content-Type": "application/json" } }
  );
});
