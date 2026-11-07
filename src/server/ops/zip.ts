/**
 * Minimal ZIP writer for data exports (DAT-4, D-090): deflate for text, store for uploads (already
 * compressed images/documents), UTF-8 names, written to a file entry by entry. No ZIP64: an export
 * larger than 4 GiB is refused with EXPORT_TOO_LARGE (the backup, a tar file, has no such limit).
 */
import fsp from 'node:fs/promises';
import zlib from 'node:zlib';
import { AppError } from '../lib/errors.ts';

const LIMIT = 0xffff_fffe;

function dosDateTime(ms: number): { date: number; time: number } {
  const d = new Date(ms);
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
  };
}

interface Central {
  name: Buffer;
  crc: number;
  method: number;
  compressed: number;
  size: number;
  offset: number;
  date: number;
  time: number;
}

export class ZipWriter {
  private readonly fd: fsp.FileHandle;
  private offset = 0;
  private readonly entries: Central[] = [];
  private readonly mtime: number;
  private constructor(fd: fsp.FileHandle, mtime: number) {
    this.fd = fd;
    this.mtime = mtime;
  }

  static async create(file: string, mtime: number): Promise<ZipWriter> {
    return new ZipWriter(await fsp.open(file, 'wx'), mtime);
  }

  private async write(buf: Buffer) {
    if (this.offset + buf.length > LIMIT) throw new AppError('CONFLICT', 'The export is larger than 4 GB; use a backup instead', { reason: 'EXPORT_TOO_LARGE' });
    await this.fd.write(buf, 0, buf.length, this.offset);
    this.offset += buf.length;
  }

  /** Adds one entry. `compress` = deflate (text); otherwise stored as is. */
  async add(name: string, data: Buffer, compress = true): Promise<void> {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data) >>> 0;
    const body = compress ? zlib.deflateRawSync(data, { level: 6 }) : data;
    const method = compress ? 8 : 0;
    const { date, time } = dosDateTime(this.mtime);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // UTF-8 names
    h.writeUInt16LE(method, 8);
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(body.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    h.writeUInt16LE(0, 28);
    const offset = this.offset;
    await this.write(h);
    await this.write(nameBuf);
    await this.write(body);
    this.entries.push({ name: nameBuf, crc, method, compressed: body.length, size: data.length, offset, date, time });
  }

  async finish(): Promise<void> {
    const start = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.time, 12);
      c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.compressed, 20);
      c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.name.length, 28);
      c.writeUInt32LE(e.offset, 42);
      await this.write(c);
      await this.write(e.name);
    }
    const size = this.offset - start;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(start, 16);
    if (this.entries.length > 0xffff) throw new AppError('CONFLICT', 'Too many files for one export; use a backup instead', { reason: 'EXPORT_TOO_LARGE' });
    await this.write(end);
    await this.fd.close();
  }

  async abort(): Promise<void> {
    await this.fd.close().catch(() => undefined);
  }
}
