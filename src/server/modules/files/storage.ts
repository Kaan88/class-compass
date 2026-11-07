/**
 * File storage on disk (S9, STU-8). Bytes live under `config.uploadsDir` at a random key
 * `xx/yy/<uuid>` without an extension, so nothing the client sent (name, type) ever reaches the file
 * system and nothing under the uploads folder can be served or executed by a web server by accident.
 * Uploads are streamed into `uploads/tmp` first and moved into place only after they passed the checks.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { UPLOAD_LIMITS } from '../../../shared/contracts/files.ts';
import type { Config } from '../../config.ts';

/** The largest per-kind limit: the multipart plugin's global cap (each kind is limited again). */
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(UPLOAD_LIMITS));

/** A new random storage key: two levels of 2-hex-digit folders and a UUID, no extension. */
export function newStorageKey(): string {
  const id = crypto.randomUUID();
  const h = crypto.randomBytes(2).toString('hex');
  return `${h.slice(0, 2)}/${h.slice(2, 4)}/${id}`;
}

const KEY_RE = /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f-]{36}(-thumb)?$/;

/** Absolute path of a storage key; refuses anything that is not a key we generated (no traversal). */
export function storagePath(config: Pick<Config, 'uploadsDir'>, key: string): string {
  if (!KEY_RE.test(key)) throw new Error('Invalid storage key');
  return path.join(config.uploadsDir, ...key.split('/'));
}

export function tmpDir(config: Pick<Config, 'uploadsDir'>): string {
  return path.join(config.uploadsDir, 'tmp');
}

/** A fresh temp file path inside the uploads folder (same volume, so the final move is a rename). */
export async function newTempPath(config: Pick<Config, 'uploadsDir'>): Promise<string> {
  const dir = tmpDir(config);
  await fsp.mkdir(dir, { recursive: true });
  return path.join(dir, `${crypto.randomUUID()}.part`);
}

/** Write bytes to a new key and return it. */
export async function storeBuffer(config: Pick<Config, 'uploadsDir'>, key: string, data: Buffer): Promise<void> {
  const target = storagePath(config, key);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, data, { flag: 'wx' });
}

/** Move a temp file into place under `key`. */
export async function storeTemp(config: Pick<Config, 'uploadsDir'>, key: string, tmp: string): Promise<void> {
  const target = storagePath(config, key);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.rename(tmp, target);
}

export async function removeQuietly(p: string | null | undefined): Promise<void> {
  if (!p) return;
  await fsp.rm(p, { force: true }).catch(() => undefined);
}

export async function removeKey(config: Pick<Config, 'uploadsDir'>, key: string | null | undefined): Promise<void> {
  if (!key) return;
  await removeQuietly(storagePath(config, key));
}

export function sha256File(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(p)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}
