const ENC_PREFIX = 'enc:v1:';

async function importKey(secret: string): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(secret);
  const hash = await crypto.subtle.digest('SHA-256', raw);
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealSecret(secret: string | undefined, value: string): Promise<string> {
  if (!secret || !value || value.startsWith(ENC_PREFIX)) return value;
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
  const packed = new Uint8Array(iv.length + cipher.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(cipher), iv.length);
  return ENC_PREFIX + btoa(String.fromCharCode(...packed));
}

export async function openSecret(secret: string | undefined, value: string): Promise<string> {
  if (!secret || !value.startsWith(ENC_PREFIX)) return value;
  const packed = Uint8Array.from(atob(value.slice(ENC_PREFIX.length)), (c) => c.charCodeAt(0));
  const iv = packed.slice(0, 12);
  const cipher = packed.slice(12);
  const key = await importKey(secret);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new TextDecoder().decode(plain);
}
