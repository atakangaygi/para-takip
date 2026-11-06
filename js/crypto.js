// Şifreleme katmanı (Web Crypto).
//
// Tasarım: "zarf şifreleme"
//  - Rastgele 256-bit bir veri anahtarı (DEK) üretilir; tüm kayıtlar bununla AES-GCM ile şifrelenir.
//  - PIN'den PBKDF2-SHA256 ile bir anahtar şifreleme anahtarı (KEK) türetilir; DEK, KEK ile
//    AES-GCM kullanılarak "sarılır" (wrap) ve meta deposuna yazılır.
//  - PIN değişince yalnızca DEK yeniden sarılır; verilerin yeniden şifrelenmesi gerekmez.
//  - Yanlış PIN -> AES-GCM doğrulama etiketi tutmaz -> unwrap hata verir.
//  - Her kayıt, "depo:id" ek doğrulama verisi (AAD) ile şifrelenir; kayıtlar arası takas tespit edilir.

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto?.subtle;

export const PBKDF2_ITERATIONS = 600000;

export function isSupported() {
  return !!(subtle && globalThis.isSecureContext !== false);
}

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function deriveKek(pin, salt, iterations) {
  const base = await subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function wrapDek(dek, pin) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const kek = await deriveKek(pin, salt, PBKDF2_ITERATIONS);
  const wrapped = await subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt, iv, wrapped };
}

/** Yeni kurulum: DEK üretir ve PIN ile sarar. */
export async function createKeyring(pin) {
  const dek = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const keyring = await wrapDek(dek, pin);
  return { dek, keyring };
}

/** PIN ile DEK'i açar. Yanlış PIN'de hata fırlatır. */
export async function openKeyring(pin, keyring) {
  const kek = await deriveKek(pin, keyring.salt, keyring.iterations);
  // extractable: true -> PIN değişiminde yeniden sarılabilmesi için gerekli.
  return subtle.unwrapKey(
    'raw', keyring.wrapped, kek, { name: 'AES-GCM', iv: keyring.iv },
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
  );
}

/** PIN değişimi: aynı DEK'i yeni PIN ile sarar. */
export function rewrapKeyring(dek, newPin) {
  return wrapDek(dek, newPin);
}

export async function encryptRecord(dek, store, obj) {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(`${store}:${obj.id}`) },
    dek,
    enc.encode(JSON.stringify(obj)),
  );
  return { id: obj.id, iv, ct };
}

export async function decryptRecord(dek, store, rec) {
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: rec.iv, additionalData: enc.encode(`${store}:${rec.id}`) },
    dek,
    rec.ct,
  );
  return JSON.parse(dec.decode(pt));
}
