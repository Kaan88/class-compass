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
