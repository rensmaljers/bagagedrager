import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Draait elke 30 minuten.
// Stuurt een browser push notificatie naar spelers die nog geen keuze hebben gemaakt
// voor een etappe waarvan de deadline over 30–90 minuten verstrijkt.

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

async function importVapidPrivateKey(rawBase64url: string): Promise<CryptoKey> {
  const rawBytes = base64urlDecode(rawBase64url);
  // Wrap raw 32-byte P-256 private key in PKCS8 DER envelope
  const pkcs8Prefix = new Uint8Array([
    0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06,
    0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03,
    0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01,
    0x01, 0x04, 0x20,
  ]);
  const pkcs8 = new Uint8Array(pkcs8Prefix.length + rawBytes.length);
  pkcs8.set(pkcs8Prefix);
  pkcs8.set(rawBytes, pkcs8Prefix.length);
  return crypto.subtle.importKey("pkcs8", pkcs8, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
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

// Web Push message encryption (RFC 8291 / aes128gcm)
async function encryptPayload(
  subscription: { p256dh: string; auth_key: string },
  plaintext: string
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  const clientPublicKeyBytes = base64urlDecode(subscription.p256dh);
  const authSecret = base64urlDecode(subscription.auth_key);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Ephemeral ECDH key pair
  const serverKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
  const serverPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeyPair.publicKey));

  // Import client public key
  const clientPublicKey = await crypto.subtle.importKey(
    "raw", clientPublicKeyBytes, { name: "ECDH", namedCurve: "P-256" }, false, []
  );

  // ECDH shared secret
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPublicKey }, serverKeyPair.privateKey, 256
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  // PRK via HKDF
  async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey("raw", ikm, { name: "HKDF" }, false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8);
    return new Uint8Array(bits);
  }

  // ikm = PRK_key
  const ikmInfo = new Uint8Array([
    ...new TextEncoder().encode("WebPush: info\0"),
    ...clientPublicKeyBytes,
    ...serverPublicKeyRaw,
  ]);
  const prk = await hkdf(authSecret, sharedSecret, ikmInfo, 32);

  // Content encryption key and nonce
  const cekInfo = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0");
  const cek = await hkdf(salt, prk, cekInfo, 16);
  const nonce = await hkdf(salt, prk, nonceInfo, 12);

  // AES-128-GCM encrypt
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const body = new TextEncoder().encode(plaintext);
  // Padding: add 1 byte (0x02) delimiter after message
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
): Promise<void> {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await makeVapidJWT(audience, privateKey);

  const { ciphertext, salt, serverPublicKey } = await encryptPayload(subscription, JSON.stringify(payload));

  // Build aes128gcm content (RFC 8188)
  const recordSize = ciphertext.length + 16 + 1; // rough upper bound
  const header = new Uint8Array(16 + 4 + 1 + serverPublicKey.length);
  header.set(salt, 0);
  const view = new DataView(header.buffer);
  view.setUint32(16, 4096, false); // record size
  header[20] = serverPublicKey.length; // key id length
  header.set(serverPublicKey, 21);

  const body = new Uint8Array(header.length + ciphertext.length);
  body.set(header);
  body.set(ciphertext, header.length);

  await fetch(endpoint, {
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

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const vapidPrivateKeyRaw = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!vapidPrivateKeyRaw) {
    return new Response(JSON.stringify({ error: "VAPID_PRIVATE_KEY niet ingesteld" }), { status: 500 });
  }
  const privateKey = await importVapidPrivateKey(vapidPrivateKeyRaw);

  // Etappes met deadline over 30–90 minuten, nog geen herinnering verstuurd
  const { data: stages, error } = await supabase
    .from("stages")
    .select("id, stage_number, name, deadline, competition_id")
    .eq("reminder_sent", false)
    .gt("deadline", new Date(Date.now() + 30 * 60 * 1000).toISOString())
    .lt("deadline", new Date(Date.now() + 90 * 60 * 1000).toISOString());

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!stages?.length) return new Response(JSON.stringify({ reminded: 0 }));

  const results = [];

  for (const stage of stages) {
    // Gebruikers in deze competitie zonder keuze voor deze etappe
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id")
      .eq("competition_id", stage.competition_id);

    const { data: picks } = await supabase
      .from("picks")
      .select("user_id")
      .eq("stage_id", stage.id);

    const pickedUserIds = new Set((picks || []).map((p: any) => p.user_id));
    const unpicked = (profiles || []).filter((p: any) => !pickedUserIds.has(p.id));

    if (!unpicked.length) {
      await supabase.from("stages").update({ reminder_sent: true }).eq("id", stage.id);
      results.push({ stage_id: stage.id, reminded: 0 });
      continue;
    }

    // Haal push subscriptions op voor deze gebruikers
    const unpickedIds = unpicked.map((p: any) => p.id);
    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth_key")
      .in("user_id", unpickedIds);

    if (!subscriptions?.length) {
      await supabase.from("stages").update({ reminder_sent: true }).eq("id", stage.id);
      results.push({ stage_id: stage.id, reminded: 0, reason: "Geen subscriptions" });
      continue;
    }

    const deadlineMinutes = Math.round((new Date(stage.deadline).getTime() - Date.now()) / 60000);
    const payload = {
      title: `⏰ Keuze deadline nadert — Etappe ${stage.stage_number}`,
      body: `Nog ${deadlineMinutes} minuten om je renner te kiezen!`,
      url: "/#pick",
    };

    let sent = 0;
    for (const sub of subscriptions) {
      try {
        await sendPush(sub.endpoint, sub, payload, privateKey);
        sent++;
      } catch (_) { /* subscription mogelijk verlopen */ }
    }

    await supabase.from("stages").update({ reminder_sent: true }).eq("id", stage.id);
    results.push({ stage_id: stage.id, stage_number: stage.stage_number, reminded: sent });
  }

  return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json" } });
});
