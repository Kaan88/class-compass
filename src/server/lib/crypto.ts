import crypto from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { v7 as uuidv7 } from 'uuid';

export const newId = (): string => uuidv7();

/** 256-bit URL-safe random token (sessions, student links, reset tokens). */
export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');

/** Deterministic lookup hash for tokens. HMAC with the server pepper so a DB-only leak is useless. */
export function tokenHash(pepper: string, token: string): string {
  return crypto.createHmac('sha256', pepper).update(token).digest('base64url');
}

/**
 * Secrets that must be shown again (S13b2, D-115: student link tokens) are encrypted at rest with
 * AES-256-GCM. The key is derived from the server pepper with HKDF-SHA256 and a per-purpose `info`,
 * so it is separate from the HMAC lookup key; `aad` binds a ciphertext to its row (a value copied to
 * another row does not decrypt). Format: `v1.<base64url(iv 12 bytes | ciphertext | tag 16 bytes)>`.
 */
const sealKey = (pepper: string, purpose: string) => Buffer.from(crypto.hkdfSync('sha256', pepper, 'class-compass/seal/v1', purpose, 32));

export function sealSecret(pepper: string, purpose: string, aad: string, plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sealKey(pepper, purpose), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `v1.${Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64url')}`;
}

/** The plaintext, or null when the value is missing, malformed, tampered with or sealed with another pepper. */
export function openSecret(pepper: string, purpose: string, aad: string, sealed: string | null | undefined): string | null {
  if (!sealed?.startsWith('v1.')) return null;
  const raw = Buffer.from(sealed.slice(3), 'base64url');
  if (raw.length < 12 + 16 + 1) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', sealKey(pepper, purpose), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => argonHash(pw, ARGON);
export const verifyPassword = (stored: string, pw: string) => argonVerify(stored, pw).catch(() => false);

/** PINs are short, so hash HMAC(pepper, pin): a stolen DB alone cannot be brute-forced offline. */
export const hashPin = (pepper: string, pin: string) => argonHash(tokenHash(pepper, `pin:${pin}`), ARGON);
export const verifyPin = (pepper: string, stored: string, pin: string) =>
  argonVerify(stored, tokenHash(pepper, `pin:${pin}`)).catch(() => false);

/** Stable JSON for request hashing (sorted keys). */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
