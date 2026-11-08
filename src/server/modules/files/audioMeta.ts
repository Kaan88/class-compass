/**
 * Audio metadata removal (S13b2, D-119, STU-8). Uploaded voice files can carry tags with names,
 * places, dates, devices or a cover picture. Before an audio upload is stored, the tags are removed
 * from the container without decoding the sound (there is no transcoder on the server):
 *
 * - MP3: ID3v2 blocks at the start, ID3v1 and APEv2 tags at the end are cut off.
 * - WAV: the file is rebuilt with only the `fmt `, `fact` and `data` chunks (no LIST/INFO, id3, bext…).
 * - MP4/M4A: `udta` and `meta` boxes (top level, in `moov` and in each `trak`) and XMP `uuid` boxes
 *   are turned into `free` boxes of the same size with their content zeroed, so offsets stay valid.
 * - Ogg (Opus, Vorbis): the comment header is replaced by an empty one (vendor string replaced too);
 *   the header pages are rebuilt and every later page renumbered with a new checksum.
 * - WebM/Matroska: `Tags`, `Attachments`, `Chapters` and the segment `Title` become `Void` elements
 *   of the same size with zeroed content. Scanning stops at the first cluster of unknown size (what
 *   browsers record), after which no tags are written by MediaRecorder.
 *
 * A file whose structure cannot be followed is refused (`AudioMetaError`), so nothing is stored with
 * tags we could not check.
 */
import { MIME } from './sniff.ts';

export class AudioMetaError extends Error {}

function fail(msg: string): never {
  throw new AudioMetaError(msg);
}
const ascii = (b: Buffer, at: number, len: number) => b.toString('latin1', at, at + len);

// ---------------------------------------------------------------- MP3
function stripMp3(buf: Buffer): Buffer {
  let start = 0;
  while (start + 10 <= buf.length && ascii(buf, start, 3) === 'ID3') {
    const size = ((buf[start + 6]! & 0x7f) << 21) | ((buf[start + 7]! & 0x7f) << 14) | ((buf[start + 8]! & 0x7f) << 7) | (buf[start + 9]! & 0x7f);
    const footer = (buf[start + 5]! & 0x10) !== 0 ? 10 : 0;
    start += 10 + size + footer;
  }
  let end = buf.length;
  for (let changed = true; changed; ) {
    changed = false;
    if (end - 128 >= start && ascii(buf, end - 128, 3) === 'TAG') {
      end -= 128;
      changed = true;
    }
    if (end - 32 >= start && ascii(buf, end - 32, 8) === 'APETAGEX') {
      const size = buf.readUInt32LE(end - 32 + 12);
      const flags = buf.readUInt32LE(end - 32 + 20);
      const header = (flags & 0x80000000) !== 0 ? 32 : 0;
      end -= size + header;
      changed = true;
    }
  }
  if (end - start < 4) fail('no audio frames');
  // The sound must start with an MPEG frame header after the tags.
  if (!(buf[start] === 0xff && (buf[start + 1]! & 0xe0) === 0xe0)) fail('no MPEG frame after the tags');
  return start === 0 && end === buf.length ? buf : Buffer.from(buf.subarray(start, end));
}

// ---------------------------------------------------------------- WAV
const WAV_KEEP = new Set(['fmt ', 'fact', 'data']);
function stripWav(buf: Buffer): Buffer {
  if (buf.length < 12 || ascii(buf, 0, 4) !== 'RIFF' || ascii(buf, 8, 4) !== 'WAVE') fail('not a WAVE file');
  const kept: Buffer[] = [];
  let pos = 12;
  let fmt = false;
  let data = false;
  while (pos + 8 <= buf.length) {
    const id = ascii(buf, pos, 4);
    let size = buf.readUInt32LE(pos + 4);
    // Streaming writers may leave the data size open (0xFFFFFFFF): it runs to the end of the file.
    if (pos + 8 + size > buf.length) size = buf.length - pos - 8;
    if (WAV_KEEP.has(id)) {
      const chunk = Buffer.alloc(8 + size + (size % 2));
      chunk.write(id, 0, 'latin1');
      chunk.writeUInt32LE(size, 4);
      buf.copy(chunk, 8, pos + 8, pos + 8 + size);
      kept.push(chunk);
      if (id === 'fmt ') fmt = true;
      if (id === 'data') data = true;
    }
    pos += 8 + size + (size % 2);
  }
  if (!fmt || !data) fail('WAVE file without fmt or data');
  const body = Buffer.concat(kept);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WAVE', 8, 'latin1');
  return Buffer.concat([head, body]);
}

// ---------------------------------------------------------------- MP4 / M4A
const XMP_UUID = 'be7acfcb97a942e89c71999491e3afac';
function stripMp4(buf: Buffer): Buffer {
  if (buf.length < 8 || ascii(buf, 4, 4) !== 'ftyp') fail('not an MP4 file');
  const out = Buffer.from(buf);
  const walk = (start: number, end: number, parent: string) => {
    let pos = start;
    while (pos + 8 <= end) {
      let size = out.readUInt32BE(pos);
      const type = ascii(out, pos + 4, 4);
      let header = 8;
      if (size === 1) {
        if (pos + 16 > end) fail('truncated box');
        size = Number(out.readBigUInt64BE(pos + 8));
        header = 16;
      } else if (size === 0) size = end - pos;
      if (size < header || pos + size > end) fail('bad box size');
      const tagged = type === 'udta' || type === 'meta' || (type === 'uuid' && size >= header + 16 && out.toString('hex', pos + header, pos + header + 16) === XMP_UUID);
      if (tagged && (parent === '' || parent === 'moov' || parent === 'trak')) {
        out.write('free', pos + 4, 'latin1');
        out.fill(0, pos + header, pos + size);
      } else if (type === 'moov' || type === 'trak') walk(pos + header, pos + size, type);
      pos += size;
    }
  };
  walk(0, out.length, '');
  return out;
}

// ---------------------------------------------------------------- Ogg
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

/** Ogg page checksum (CRC-32, polynomial 0x04c11db7, not reflected, initial 0). */
export function oggCrc(page: Buffer): number {
  let crc = 0;
  for (const b of page) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]!) >>> 0;
  return crc >>> 0;
}

interface OggPage {
  headerType: number;
  granule: Buffer;
  serial: number;
  segments: number[];
  data: Buffer;
}

function parseOgg(buf: Buffer): OggPage[] {
  const pages: OggPage[] = [];
  let pos = 0;
  while (pos < buf.length) {
    if (pos + 27 > buf.length || ascii(buf, pos, 4) !== 'OggS' || buf[pos + 4] !== 0) fail('bad Ogg page');
    const nsegs = buf[pos + 26]!;
    if (pos + 27 + nsegs > buf.length) fail('truncated Ogg page');
    const segments = [...buf.subarray(pos + 27, pos + 27 + nsegs)];
    const len = segments.reduce((a, b) => a + b, 0);
    const dataStart = pos + 27 + nsegs;
    if (dataStart + len > buf.length) fail('truncated Ogg page');
    pages.push({ headerType: buf[pos + 5]!, granule: Buffer.from(buf.subarray(pos + 6, pos + 14)), serial: buf.readUInt32LE(pos + 14), segments, data: Buffer.from(buf.subarray(dataStart, dataStart + len)) });
    pos = dataStart + len;
  }
  return pages;
}

function writePage(p: OggPage, seq: number): Buffer {
  const head = Buffer.alloc(27 + p.segments.length);
  head.write('OggS', 0, 'latin1');
  head[4] = 0;
  head[5] = p.headerType;
  p.granule.copy(head, 6);
  head.writeUInt32LE(p.serial, 14);
  head.writeUInt32LE(seq, 18);
  head.writeUInt32LE(0, 22);
  head[26] = p.segments.length;
  Buffer.from(p.segments).copy(head, 27);
  const page = Buffer.concat([head, p.data]);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}

const GRANULE_ZERO = Buffer.alloc(8);
const GRANULE_NONE = Buffer.alloc(8, 0xff);

/** Lay header packets out on fresh pages (the last one ends on a page boundary). */
function paginate(packets: Buffer[], serial: number): OggPage[] {
  const pages: OggPage[] = [];
  let segs: number[] = [];
  let chunks: Buffer[] = [];
  let continued = false;
  let packetEnded = false;
  const flush = (nextContinued: boolean) => {
    pages.push({ headerType: continued ? 0x01 : 0, granule: packetEnded ? GRANULE_ZERO : GRANULE_NONE, serial, segments: segs, data: Buffer.concat(chunks) });
    segs = [];
    chunks = [];
    continued = nextContinued;
    packetEnded = false;
  };
  for (const pkt of packets) {
    let off = 0;
    for (;;) {
      const n = Math.min(255, pkt.length - off);
      segs.push(n);
      chunks.push(pkt.subarray(off, off + n));
      off += n;
      const last = n < 255;
      if (last) packetEnded = true;
      if (segs.length === 255) flush(!last);
      if (last) break;
    }
  }
  if (segs.length) flush(false);
  return pages;
}

function stripOgg(buf: Buffer): Buffer {
  const pages = parseOgg(buf);
  if (!pages.length) fail('empty Ogg file');
  const serial = pages[0]!.serial;
  if (pages.some((p) => p.serial !== serial)) fail('several Ogg streams');
  // Collect the header packets.
  const packets: Buffer[] = [];
  let cur: Buffer[] = [];
  let need = 0;
  let codec: 'opus' | 'vorbis' | null = null;
  let headerPages = 0;
  for (let i = 0; i < pages.length && (need === 0 || packets.length < need); i++) {
    const p = pages[i]!;
    let off = 0;
    for (let s = 0; s < p.segments.length; s++) {
      const n = p.segments[s]!;
      cur.push(p.data.subarray(off, off + n));
      off += n;
      if (n < 255) {
        packets.push(Buffer.concat(cur));
        cur = [];
        if (packets.length === 1) {
          const first = packets[0]!;
          if (ascii(first, 0, 8) === 'OpusHead') [codec, need] = ['opus', 2];
          else if (first[0] === 1 && ascii(first, 1, 6) === 'vorbis') [codec, need] = ['vorbis', 3];
          else fail('unsupported Ogg codec');
        }
        if (need && packets.length === need && s !== p.segments.length - 1) fail('audio starts inside a header page');
      }
    }
    headerPages = i + 1;
  }
  if (!codec || packets.length < need || cur.length) fail('incomplete Ogg headers');
  const vendor = Buffer.from('class-compass', 'latin1');
  const vlen = Buffer.alloc(4);
  vlen.writeUInt32LE(vendor.length);
  const zero = Buffer.alloc(4);
  packets[1] =
    codec === 'opus'
      ? Buffer.concat([Buffer.from('OpusTags', 'latin1'), vlen, vendor, zero])
      : Buffer.concat([Buffer.from([3]), Buffer.from('vorbis', 'latin1'), vlen, vendor, zero, Buffer.from([1])]);
  const first: OggPage = { ...pages[0]!, headerType: 0x02, granule: GRANULE_ZERO, segments: paginate([packets[0]!], serial)[0]!.segments, data: packets[0]! };
  const rebuilt = [first, ...paginate(packets.slice(1), serial), ...pages.slice(headerPages)];
  return Buffer.concat(rebuilt.map((p, seq) => writePage(p, seq)));
}

// ---------------------------------------------------------------- WebM / Matroska
function readVint(buf: Buffer, pos: number, keepMarker: boolean): { value: number; len: number; unknown: boolean } {
  const b = buf[pos];
  if (b === undefined || b === 0) fail('bad EBML number');
  let len = 1;
  while (len <= 8 && !(b! & (0x80 >> (len - 1)))) len++;
  if (len > 8 || pos + len > buf.length) fail('bad EBML number');
  let value = keepMarker ? b! : b! & (0xff >> len);
  let allOnes = (b! & (0xff >> len)) === 0xff >> len;
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[pos + i]!;
    if (buf[pos + i] !== 0xff) allOnes = false;
  }
  return { value, len, unknown: !keepMarker && allOnes };
}

const EBML = { header: 0x1a45dfa3, segment: 0x18538067, cluster: 0x1f43b675, tags: 0x1254c367, attachments: 0x1941a469, chapters: 0x1043a770, info: 0x1549a966, title: 0x7ba9 };

/** Overwrite [start, end) with a Void element (ID 0xEC) of exactly that length. */
function voidOut(out: Buffer, start: number, end: number) {
  const total = end - start;
  if (total < 2) fail('element too small');
  out.fill(0, start, end);
  out[start] = 0xec;
  if (total >= 9) {
    out[start + 1] = 0x01;
    let v = total - 9;
    for (let i = 8; i >= 2; i--) {
      out[start + i] = v % 256;
      v = Math.floor(v / 256);
    }
  } else out[start + 1] = 0x80 >> (total - 2); // a size of zero written on the remaining bytes
}

function stripMatroska(buf: Buffer): Buffer {
  const out = Buffer.from(buf);
  const element = (pos: number) => {
    const id = readVint(out, pos, true);
    const size = readVint(out, pos + id.len, false);
    const dataStart = pos + id.len + size.len;
    return { id: id.value, dataStart, end: size.unknown ? null : dataStart + size.value };
  };
  const head = element(0);
  if (head.id !== EBML.header || head.end === null) fail('not an EBML file');
  let pos = head.end;
  while (pos < out.length) {
    const seg = element(pos);
    if (seg.id !== EBML.segment) {
      if (seg.end === null) fail('unknown-size element');
      pos = seg.end;
      continue;
    }
    const segEnd = Math.min(seg.end ?? out.length, out.length);
    let p = seg.dataStart;
    while (p < segEnd) {
      const el = element(p);
      if (el.end === null) {
        if (el.id === EBML.cluster) break; // a live recording: clusters run to the end
        fail('unknown-size element');
      }
      const end = el.end!;
      if (end > out.length) fail('truncated element');
      if (el.id === EBML.tags || el.id === EBML.attachments || el.id === EBML.chapters) voidOut(out, p, end);
      else if (el.id === EBML.info) {
        let q = el.dataStart;
        while (q < end) {
          const child = element(q);
          if (child.end === null || child.end > end) fail('bad Info element');
          if (child.id === EBML.title) voidOut(out, q, child.end);
          q = child.end;
        }
      }
      p = end;
    }
    pos = segEnd;
  }
  return out;
}

/** Remove metadata tags from an audio upload of the sniffed type `mime` (throws AudioMetaError). */
export function stripAudioMetadata(buf: Buffer, mime: string): Buffer {
  switch (mime) {
    case MIME.mp3:
      return stripMp3(buf);
    case MIME.wav:
      return stripWav(buf);
    case MIME.mp4:
      return stripMp4(buf);
    case MIME.ogg:
      return stripOgg(buf);
    case MIME.webm:
      return stripMatroska(buf);
    default:
      return fail('unsupported audio type');
  }
}
