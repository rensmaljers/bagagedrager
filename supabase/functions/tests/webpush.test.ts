// Tests voor de Web Push-implementatie. Draaien met:
//   deno test supabase/functions/tests/
import { assert, assertEquals } from "jsr:@std/assert";
import {
  base64urlDecode,
  base64urlEncode,
  buildPushBody,
  encryptPayload,
  importVapidPrivateKey,
  makeVapidJWT,
} from "../_shared/webpush.ts";

// RFC 8291 Appendix A — officiële testvector
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  expectedCiphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
  expectedHeader: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
};

async function rfcServerKeyPair(): Promise<CryptoKeyPair> {
  const pub = base64urlDecode(RFC.asPublic);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: RFC.asPrivate,
    x: base64urlEncode(pub.slice(1, 33)),
    y: base64urlEncode(pub.slice(33, 65)),
  };
  const privateKey = await crypto.subtle.importKey(
    "jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]
  );
  const publicKey = await crypto.subtle.importKey(
    "raw", pub, { name: "ECDH", namedCurve: "P-256" }, true, []
  );
  return { privateKey, publicKey };
}

Deno.test("encryptPayload komt byte-voor-byte overeen met RFC 8291-testvector", async () => {
  const { ciphertext, salt, serverPublicKey } = await encryptPayload(
    { p256dh: RFC.uaPublic, auth_key: RFC.authSecret },
    RFC.plaintext,
    { salt: base64urlDecode(RFC.salt), serverKeyPair: await rfcServerKeyPair() }
  );
  assertEquals(base64urlEncode(ciphertext), RFC.expectedCiphertext);

  // Header (salt | recordsize | idlen | keyid) volgens RFC 8188/8291
  const body = buildPushBody(ciphertext, salt, serverPublicKey);
  const header = body.slice(0, 16 + 4 + 1 + 65);
  assertEquals(base64urlEncode(header), RFC.expectedHeader);
});

Deno.test("importVapidPrivateKey (JWK) levert een sleutel die echt kan signen", async () => {
  // Regressietest: het oude PKCS8-pad importeerde wél maar faalde bij sign()
  // met InvalidEncoding in de Supabase Deno-runtime.
  const key = await importVapidPrivateKey(RFC.asPrivate, RFC.asPublic);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode("x")
  );
  assertEquals(new Uint8Array(sig).length, 64);
});

Deno.test("makeVapidJWT: geldige ES256-handtekening en claims", async () => {
  const key = await importVapidPrivateKey(RFC.asPrivate, RFC.asPublic);
  const jwt = await makeVapidJWT("https://fcm.googleapis.com", "https://example.test", key);

  const [h, p, s] = jwt.split(".");
  const header = JSON.parse(new TextDecoder().decode(base64urlDecode(h)));
  assertEquals(header, { typ: "JWT", alg: "ES256" });

  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(p)));
  assertEquals(payload.aud, "https://fcm.googleapis.com");
  assertEquals(payload.sub, "https://example.test");
  assert(payload.exp > Date.now() / 1000);

  const pub = await crypto.subtle.importKey(
    "raw", base64urlDecode(RFC.asPublic), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    pub,
    base64urlDecode(s),
    new TextEncoder().encode(`${h}.${p}`)
  );
  assertEquals(valid, true);
});

Deno.test("encryptie is door de ontvanger te ontsleutelen (rondrit)", async () => {
  // Simuleer browserkant: eigen ECDH-paar + auth secret, ontsleutel per RFC 8291
  const uaPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const uaPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", uaPair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));

  const payload = JSON.stringify({ title: "🚴 Bagagedrager", body: "Vergeet je keuze niet!" });
  const { ciphertext, salt, serverPublicKey } = await encryptPayload(
    { p256dh: base64urlEncode(uaPubRaw), auth_key: base64urlEncode(auth) },
    payload
  );

  // Ontvangerkant
  const serverPub = await crypto.subtle.importKey(
    "raw", serverPublicKey as Uint8Array<ArrayBuffer>, { name: "ECDH", namedCurve: "P-256" }, false, []
  );
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: serverPub }, uaPair.privateKey, 256));
  const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) => {
    const k = await crypto.subtle.importKey("raw", ikm as Uint8Array<ArrayBuffer>, { name: "HKDF" }, false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: salt as Uint8Array<ArrayBuffer>, info: info as Uint8Array<ArrayBuffer> }, k, len * 8
    ));
  };
  const ikmInfo = new Uint8Array([...new TextEncoder().encode("WebPush: info\0"), ...uaPubRaw, ...serverPublicKey]);
  const prk = await hkdf(auth, shared, ikmInfo, 32);
  const cek = await hkdf(salt, prk, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, prk, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce }, aes, ciphertext as Uint8Array<ArrayBuffer>
  ));

  assertEquals(padded[padded.length - 1], 0x02);
  assertEquals(new TextDecoder().decode(padded.slice(0, -1)), payload);
});
