import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Stuurt een testmelding naar de ingelogde admin.
// Alleen beschikbaar voor admins (gecontroleerd via profiles.is_admin).

const VAPID_PUBLIC_KEY = "BHodiDUcQDWpi3kcE5Y6zWPslv5Gzw50tups7rev8hd98zAlMiUHnTSdmvfoa4G1zUycnhf5hVjdg_SiXGRpoPQ";
const VAPID_SUBJECT = "https://hdkvirtytljnuawcmoui.supabase.co";

function base64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function base64urlEncode(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function utf8ToBase64url(str: string): string {
  return base64urlEncode(new TextEncoder().encode(str));
}

// Deno's ring-crypto weigert minimale PKCS8 (zonder embedded public key) met
// "InvalidEncoding" bij het signen — daarom JWK-import: d = secret,
// x/y afgeleid uit de publieke sleutel (raw P-256 punt: 0x04 || x || y).
async function importVapidPrivateKey(rawBase64url: string): Promise<CryptoKey> {
  const pubBytes = base64urlDecode(VAPID_PUBLIC_KEY);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: rawBase64url.trim(),
    x: base64urlEncode(pubBytes.slice(1, 33)),
    y: base64urlEncode(pubBytes.slice(33, 65)),
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function makeVapidJWT(audience: string, privateKey: CryptoKey): Promise<string> {
  const header = utf8ToBase64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = utf8ToBase64url(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 43200,
    sub: VAPID_SUBJECT,
  }));
  const unsigned = `${header}.${payload}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(unsigned)
  );
  return `${unsigned}.${base64urlEncode(new Uint8Array(sig))}`;
}

async function encryptPayload(
  subscription: { p256dh: string; auth_key: string },
  plaintext: string
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  const clientPublicKeyBytes = base64urlDecode(subscription.p256dh);
  const authSecret = base64urlDecode(subscription.auth_key);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const serverKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
  const serverPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeyPair.publicKey));

  const clientPublicKey = await crypto.subtle.importKey(
    "raw", clientPublicKeyBytes, { name: "ECDH", namedCurve: "P-256" }, false, []
  );

  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPublicKey }, serverKeyPair.privateKey, 256
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey("raw", ikm, { name: "HKDF" }, false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8);
    return new Uint8Array(bits);
  }

  const ikmInfo = new Uint8Array([
    ...new TextEncoder().encode("WebPush: info\0"),
    ...clientPublicKeyBytes,
    ...serverPublicKeyRaw,
  ]);
  const prk = await hkdf(authSecret, sharedSecret, ikmInfo, 32);

  const cekInfo = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0");
  const cek = await hkdf(salt, prk, cekInfo, 16);
  const nonce = await hkdf(salt, prk, nonceInfo, 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const body = new TextEncoder().encode(plaintext);
  const padded = new Uint8Array(body.length + 1);
  padded.set(body);
  padded[body.length] = 0x02;

  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));
  return { ciphertext: encrypted, salt, serverPublicKey: serverPublicKeyRaw };
}

async function sendPush(
  endpoint: string,
  subscription: { p256dh: string; auth_key: string },
  payload: object,
  privateKey: CryptoKey
): Promise<Response> {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await makeVapidJWT(audience, privateKey);

  const { ciphertext, salt, serverPublicKey } = await encryptPayload(subscription, JSON.stringify(payload));

  const header = new Uint8Array(16 + 4 + 1 + serverPublicKey.length);
  header.set(salt, 0);
  const view = new DataView(header.buffer);
  view.setUint32(16, 4096, false);
  header[20] = serverPublicKey.length;
  header.set(serverPublicKey, 21);

  const body = new Uint8Array(header.length + ciphertext.length);
  body.set(header);
  body.set(ciphertext, header.length);

  return fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": "3600",
    },
    body,
  });
}

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
  const privateKey = await importVapidPrivateKey(vapidPrivateKeyRaw);

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
      const res = await sendPush(sub.endpoint, sub, payload, privateKey);
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
