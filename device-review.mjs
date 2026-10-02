const ITERATIONS = 310_000;
const MAX_CIPHERTEXT = 3_000_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value, length = null) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > MAX_CIPHERTEXT) {
    throw new Error('The saved review is damaged or uses an unsupported format.');
  }
  let bytes;
  try { bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
  catch { throw new Error('The saved review is damaged or uses an unsupported format.'); }
  if (length !== null && bytes.length !== length) throw new Error('The saved review is damaged or uses an unsupported format.');
  return bytes;
}

async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptDeviceReview(reviewJson, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 200) {
    throw new Error('Use a passphrase of 12 to 200 characters.');
  }
  if (typeof reviewJson !== 'string' || encoder.encode(reviewJson).length > 2_000_000) {
    throw new Error('This review is too large to save on this device. Download a file instead.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(reviewJson));
  return JSON.stringify({ version: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS,
    cipher: 'AES-256-GCM', salt: bytesToBase64(salt), iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)) });
}

export async function decryptDeviceReview(saved, passphrase) {
  let envelope;
  try { envelope = JSON.parse(saved); }
  catch { throw new Error('The saved review is damaged or uses an unsupported format.'); }
  if (!envelope || Object.keys(envelope).sort().join('|') !==
      'cipher|ciphertext|iterations|iv|kdf|salt|version' || envelope.version !== 1 ||
      envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== ITERATIONS ||
      envelope.cipher !== 'AES-256-GCM') {
    throw new Error('The saved review is damaged or uses an unsupported format.');
  }
  const salt = base64ToBytes(envelope.salt, 16);
  const iv = base64ToBytes(envelope.iv, 12);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  if (ciphertext.length < 16 || ciphertext.length > 2_000_016) {
    throw new Error('The saved review is damaged or uses an unsupported format.');
  }
  try {
    const key = await deriveKey(passphrase, salt);
    return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext));
  } catch {
    throw new Error('Could not unlock this review. Check the passphrase or use a review file.');
  }
}
