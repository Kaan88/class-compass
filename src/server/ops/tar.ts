/**
 * Minimal POSIX ustar writer and reader for backup bundles (D-089). Regular files only; names up to
 * 100 bytes (backup entries are `manifest.json`, `class-compass.db` and `uploads/xx/yy/<uuid>[-thumb]`),
 * sizes up to 8 GiB per entry. Reading never writes outside the target directory (no absolute names,
 * no `..`, no links).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const BLOCK = 512;
const MAX_SIZE = 8 * 1024 ** 3 - 1;

function header(name: string, size: number, mtimeMs: number): Buffer {
  const nameBytes = Buffer.from(name, 'utf8');
  if (nameBytes.length > 100) throw new Error(`tar entry name too long: ${name}`);
  if (size > MAX_SIZE) throw new Error(`tar entry too large: ${name}`);
  const h = Buffer.alloc(BLOCK, 0);
  nameBytes.copy(h, 0);
  const octal = (n: number, len: number) => n.toString(8).padStart(len - 1, '0') + '\0';
  h.write(octal(0o644, 8), 100, 'ascii');
  h.write(octal(0, 8), 108, 'ascii');
  h.write(octal(0, 8), 116, 'ascii');
  h.write(octal(size, 12), 124, 'ascii');
  h.write(octal(Math.floor(mtimeMs / 1000), 12), 136, 'ascii');
  h.write('        ', 148, 'ascii');
  h.write('0', 156, 'ascii');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return h;
}

export interface TarEntryInfo {
  name: string;
  size: number;
  sha256: string;
}

/** Streams entries into one tar file. Call `finish()` to write the end marker and close the file. */
export class TarWriter {
  private readonly fd: fs.promises.FileHandle;
  private offset = 0;
  private constructor(fd: fs.promises.FileHandle) {
    this.fd = fd;
  }

  static async create(file: string): Promise<TarWriter> {
    return new TarWriter(await fsp.open(file, 'wx'));
  }

  private async write(buf: Buffer) {
    await this.fd.write(buf, 0, buf.length, this.offset);
    this.offset += buf.length;
  }

  private async pad(size: number) {
    const rest = size % BLOCK;
    if (rest) await this.write(Buffer.alloc(BLOCK - rest, 0));
  }

  async addBuffer(name: string, data: Buffer, mtimeMs = Date.now()): Promise<TarEntryInfo> {
    await this.write(header(name, data.length, mtimeMs));
    await this.write(data);
    await this.pad(data.length);
    return { name, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
  }

  /** Copies a file in chunks (large databases never sit in memory). */
  async addFile(name: string, source: string): Promise<TarEntryInfo> {
    const st = await fsp.stat(source);
    await this.write(header(name, st.size, st.mtimeMs));
    const hash = crypto.createHash('sha256');
    let copied = 0;
    for await (const chunk of fs.createReadStream(source, { highWaterMark: 1024 * 1024 })) {
      const b = chunk as Buffer;
      hash.update(b);
      await this.write(b);
      copied += b.length;
    }
    if (copied !== st.size) throw new Error(`file changed while it was being backed up: ${name}`);
    await this.pad(st.size);
    return { name, size: st.size, sha256: hash.digest('hex') };
  }

  async finish(): Promise<void> {
    await this.write(Buffer.alloc(BLOCK * 2, 0));
    await this.fd.sync();
    await this.fd.close();
  }

  async abort(): Promise<void> {
    await this.fd.close().catch(() => undefined);
  }
}

const safeName = (name: string) => name.length > 0 && !name.startsWith('/') && !name.includes('\\') && !name.split('/').some((p) => p === '..' || p === '' || p === '.');

function parseHeader(h: Buffer): { name: string; size: number; type: string } | null {
  if (h.every((b) => b === 0)) return null;
  const str = (start: number, len: number) => h.subarray(start, start + len).toString('utf8').replace(/\0.*$/su, '');
  let stored = 0;
  for (let i = 0; i < BLOCK; i++) stored += i >= 148 && i < 156 ? 32 : h[i]!;
  const expected = parseInt(str(148, 8).trim(), 8);
  if (!Number.isFinite(expected) || expected !== stored) throw new Error('tar header checksum mismatch (damaged backup)');
  const prefix = str(345, 155);
  const name = prefix ? `${prefix}/${str(0, 100)}` : str(0, 100);
  const size = parseInt(str(124, 12).trim() || '0', 8);
  if (!Number.isFinite(size) || size < 0) throw new Error('tar header size invalid (damaged backup)');
  return { name, size, type: str(156, 1) || '0' };
}

/**
 * Reads every regular entry of a tar file. `sink(name, size)` returns where to write the bytes (a
 * file path) or null to only hash them. Returns name, size and SHA-256 of every entry.
 */
export async function readTar(file: string, sink: (name: string, size: number) => string | null = () => null): Promise<TarEntryInfo[]> {
  const fd = await fsp.open(file, 'r');
  const out: TarEntryInfo[] = [];
  try {
    const total = (await fd.stat()).size;
    let pos = 0;
    const head = Buffer.alloc(BLOCK);
    const buf = Buffer.alloc(1024 * 1024);
    while (pos + BLOCK <= total) {
      await fd.read(head, 0, BLOCK, pos);
      pos += BLOCK;
      const h = parseHeader(head);
      if (!h) break;
      if (pos + h.size > total) throw new Error(`tar entry ${h.name} is truncated (damaged backup)`);
      const regular = h.type === '0';
      if (regular && !safeName(h.name)) throw new Error(`unsafe name in backup: ${h.name}`);
      const target = regular ? sink(h.name, h.size) : null;
      const outFd = target ? (await fsp.mkdir(path.dirname(target), { recursive: true }), await fsp.open(target, 'wx')) : null;
      const hash = crypto.createHash('sha256');
      try {
        let left = h.size;
        let at = pos;
        while (left > 0) {
          const n = Math.min(left, buf.length);
          const { bytesRead } = await fd.read(buf, 0, n, at);
          if (bytesRead !== n) throw new Error('short read (damaged backup)');
          const chunk = buf.subarray(0, n);
          hash.update(chunk);
          if (outFd) await outFd.write(chunk);
          left -= n;
          at += n;
        }
      } finally {
        await outFd?.close();
      }
      if (regular) out.push({ name: h.name, size: h.size, sha256: hash.digest('hex') });
      pos += Math.ceil(h.size / BLOCK) * BLOCK;
    }
  } finally {
    await fd.close();
  }
  return out;
}

/** Reads one small entry (e.g. manifest.json) into memory, or null when absent. */
export async function readTarEntry(file: string, wanted: string, maxBytes = 64 * 1024 * 1024): Promise<Buffer | null> {
  const dir = await fsp.mkdtemp(path.join(path.dirname(file), '.read-'));
  try {
    const target = path.join(dir, 'entry');
    let found = false;
    await readTar(file, (name, size) => {
      if (name !== wanted || found || size > maxBytes) return null;
      found = true;
      return target;
    });
    return found ? await fsp.readFile(target) : null;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
