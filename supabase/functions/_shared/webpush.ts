// Gedeelde Web Push-implementatie (VAPID RFC 8292 + encryptie RFC 8291/aes128gcm)
// Gebruikt door test-push en auto-remind. Getest in supabase/functions/tests/.

// Expliciet ArrayBuffer-backed zodat TS de waarden als BufferSource accepteert
export type Bytes = Uint8Array<ArrayBuffer>;

export function base64urlDecode(str: string): Bytes {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, c => c.charCodeAt(0)) as Bytes;
}

export function base64urlEncode(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function utf8ToBase64url(str: string): string {
  return base64urlEncode(new TextEncoder().encode(str));
}

// Deno's ring-crypto weigert minimale PKCS8 (zonder embedded public key) met
// "InvalidEncoding" bij het signen — daarom JWK-import: d = secret,
// x/y afgeleid uit de publieke sleutel (raw P-256 punt: 0x04 || x || y).
export async function importVapidPrivateKey(rawBase64url: string, publicKeyBase64url: string): Promise<CryptoKey> {
  const pubBytes = base64urlDecode(publicKeyBase64url);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: rawBase64url.trim(),
    x: base64urlEncode(pubBytes.slice(1, 33)),
    y: base64urlEncode(pubBytes.slice(33, 65)),
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

export async function makeVapidJWT(audience: string, subject: string, privateKey: CryptoKey): Promise<string> {
  const header = utf8ToBase64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = utf8ToBase64url(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 43200,
    sub: subject,
  }));
  const unsigned = `${header}.${payload}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(unsigned)
  );
  return `${unsigned}.${base64urlEncode(new Uint8Array(sig))}`;
}

// Alleen voor tests: vaste salt + server-sleutelpaar i.p.v. random (RFC 8291-testvector)
export interface EncryptTestOverrides {
  salt: Bytes;
  serverKeyPair: CryptoKeyPair;
}

export async function encryptPayload(
  subscription: { p256dh: string; auth_key: string },
  plaintext: string,
  testOverrides?: EncryptTestOverrides
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  const clientPublicKeyBytes = base64urlDecode(subscription.p256dh);
  const authSecret = base64urlDecode(subscription.auth_key);
  const salt = testOverrides?.salt ?? crypto.getRandomValues(new Uint8Array(16));

  const serverKeyPair = testOverrides?.serverKeyPair
    ?? await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
  const serverPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeyPair.publicKey));

  const clientPublicKey = await crypto.subtle.importKey(
    "raw", clientPublicKeyBytes, { name: "ECDH", namedCurve: "P-256" }, false, []
  );

  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPublicKey }, serverKeyPair.privateKey, 256
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, len: number): Promise<Bytes> {
    const key = await crypto.subtle.importKey("raw", ikm, { name: "HKDF" }, false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8);
    return new Uint8Array(bits);
  }

  const ikmInfo = new Uint8Array([
    ...new TextEncoder().encode("WebPush: info\0"),
    ...clientPublicKeyBytes,
    ...serverPublicKeyRaw,
  ]) as Bytes;
  const prk = await hkdf(authSecret, sharedSecret, ikmInfo, 32);

  const cekInfo = new TextEncoder().encode("Content-Encoding: aes128gcm\0") as Bytes;
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0") as Bytes;
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

// Bouwt de aes128gcm-body: header (salt | rs | idlen | keyid) + ciphertext
export function buildPushBody(ciphertext: Uint8Array, salt: Uint8Array, serverPublicKey: Uint8Array): Bytes {
  const header = new Uint8Array(16 + 4 + 1 + serverPublicKey.length);
  header.set(salt, 0);
  const view = new DataView(header.buffer);
  view.setUint32(16, 4096, false);
  header[20] = serverPublicKey.length;
  header.set(serverPublicKey, 21);

  const body = new Uint8Array(header.length + ciphertext.length);
  body.set(header);
  body.set(ciphertext, header.length);
  return body as Bytes;
}

export async function sendPush(
  endpoint: string,
  subscription: { p256dh: string; auth_key: string },
  payload: object,
  privateKey: CryptoKey,
  vapidPublicKey: string,
  vapidSubject: string
): Promise<Response> {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await makeVapidJWT(audience, vapidSubject, privateKey);

  const { ciphertext, salt, serverPublicKey } = await encryptPayload(subscription, JSON.stringify(payload));
  const body = buildPushBody(ciphertext, salt, serverPublicKey);

  return fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `vapid t=${jwt},k=${vapidPublicKey}`,
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": "3600",
    },
    body,
  });
}
