/**
 * Video evidence containers (S27a, D-193). Videos are stored as uploaded (no server re-encoder): the
 * type is decided from the bytes only, never from the client's type or name.
 *
 * - **MP4 / MOV**: the file starts with an `ftyp` box. Audio-only brands (`M4A `, …) are refused.
 *   The `moov` box is read (at most 64 MB) and must hold a track whose handler is `vide`. The duration
 *   is the longest of `mvhd`, every track's `mdhd` and (fragmented files) `mvex/mehd`.
 * - **WebM**: an EBML header whose DocType is `webm`, then a Segment whose Tracks hold a video track
 *   (TrackType 1 or a `V_` codec). The duration is the longest of Info/Duration and the last block's
 *   time (cluster Timecode plus the block's relative time), because a browser recording usually has no
 *   Info/Duration at all. Clusters of unknown size (what MediaRecorder writes) are read as they come.
 *
 * Anything else, a file without a picture track, or one whose boxes or elements do not add up, is
 * refused. When the duration cannot be read (`durationMs: null`), the caller accepts the file within
 * the size cap only and records the duration as unknown.
 *
 * Metadata: without re-encoding, the boxes that carry location, device and software tags are
 * neutralised in place, so every offset in the file stays valid: in MP4/MOV the `udta` and `meta`
 * boxes (top level, in `moov` and in each `trak`) and an XMP `uuid` box become `free` boxes of the
 * same size with zeroed content (`©xyz` and `com.apple.quicktime.location.ISO6709` live there); in
 * WebM a Tags element becomes a Void element of the same size with zeroed content. Creation times in
 * `mvhd`/`tkhd`/`mdhd` stay (dates, not places).
 */
import type { FileHandle } from 'node:fs/promises';
import fsp from 'node:fs/promises';

export type VideoContainer = 'mp4' | 'quicktime' | 'webm';
export const VIDEO_MIME: Record<VideoContainer, string> = { mp4: 'video/mp4', quicktime: 'video/quicktime', webm: 'video/webm' };

/** A box or element to neutralise in place: absolute start, total size and header length. */
type Span = { start: number; size: number; header: number; idLen?: number; sizeLen?: number };

export type VideoInspection =
  | {
      ok: true;
      container: VideoContainer;
      mime: string;
      /** The duration when it could be read, else null (unknown). */
      durationMs: number | null;
      /** A lower bound read so far (blocks seen before an unreadable part); 0 when nothing was read. */
      atLeastMs: number;
      /** Metadata boxes or elements that `neutraliseVideoMetadata` blanks. */
      metadata: Span[];
    }
  | { ok: false; reason: 'FILE_TYPE_NOT_ALLOWED' | 'FILE_EMPTY' | 'VIDEO_UNREADABLE' };

class Unreadable extends Error {}

/** Positioned reads with a small window, so walking a large file reads only what it needs. */
class Reader {
  private buf = Buffer.alloc(0);
  private at = 0;
  private readonly fh: FileHandle;
  readonly size: number;
  constructor(fh: FileHandle, size: number) {
    this.fh = fh;
    this.size = size;
  }
  /** Up to `len` bytes at `pos` (fewer at the end of the file). */
  async peek(pos: number, len: number): Promise<Buffer> {
    if (pos < 0 || pos >= this.size) return Buffer.alloc(0);
    const n = Math.min(len, this.size - pos);
    if (pos >= this.at && pos + n <= this.at + this.buf.length) return this.buf.subarray(pos - this.at, pos - this.at + n);
    const want = Math.min(Math.max(n, 64 * 1024), this.size - pos);
    const b = Buffer.alloc(want);
    const { bytesRead } = await this.fh.read(b, 0, want, pos);
    this.buf = b.subarray(0, bytesRead);
    this.at = pos;
    return this.buf.subarray(0, Math.min(n, bytesRead));
  }
  /** Exactly `len` bytes at `pos`, or Unreadable. */
  async bytes(pos: number, len: number): Promise<Buffer> {
    const b = await this.peek(pos, len);
    if (b.length < len) throw new Unreadable();
    return b;
  }
}

// ---------------------------------------------------------------- MP4 / MOV

/** Brands of audio-only MP4 files (iTunes audio, audiobooks, Flash audio). */
const AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ', 'F4A ', 'F4B ']);
/** The XMP uuid box (`BE7ACFCB-97A9-42E8-9C71-999491E3AFAC`). */
const XMP_UUID = Buffer.from('be7acfcb97a942e89c71999491e3afac', 'hex');
const MAX_MOOV = 64 * 1024 * 1024;
const MAX_BOXES = 100_000;

type Box = { type: string; start: number; size: number; header: number };

/** A box header at `pos` inside `[pos, end)`, from a buffer (`at` = the buffer's absolute offset). */
function boxIn(buf: Buffer, pos: number, end: number): Box | null {
  if (pos + 8 > end) return null;
  const s32 = buf.readUInt32BE(pos);
  const type = buf.toString('latin1', pos + 4, pos + 8);
  let size = s32;
  let header = 8;
  if (s32 === 1) {
    if (pos + 16 > end) return null;
    size = Number(buf.readBigUInt64BE(pos + 8));
    header = 16;
  } else if (s32 === 0) size = end - pos;
  if (size < header || pos + size > end) return null;
  return { type, start: pos, size, header };
}

function* childrenOf(buf: Buffer, start: number, end: number): Generator<Box> {
  let pos = start;
  while (pos + 8 <= end) {
    const b = boxIn(buf, pos, end);
    if (!b) throw new Unreadable();
    yield b;
    pos += b.size;
  }
}

/** Timescale and duration of an `mvhd` or `mdhd` payload (version 0 or 1); null when unknown. */
function timeOf(buf: Buffer, p: number, end: number): { timescale: number; duration: number | null } | null {
  const v = buf[p];
  if (v === 1) {
    if (p + 32 > end) return null;
    const d = buf.readBigUInt64BE(p + 24);
    return { timescale: buf.readUInt32BE(p + 20), duration: d === 0xffffffffffffffffn ? null : Number(d) };
  }
  if (p + 20 > end) return null;
  const d = buf.readUInt32BE(p + 16);
  return { timescale: buf.readUInt32BE(p + 12), duration: d === 0xffffffff ? null : d };
}
const msOf = (t: { timescale: number; duration: number | null } | null) => (t && t.timescale > 0 && t.duration !== null && t.duration > 0 ? (t.duration * 1000) / t.timescale : 0);

async function inspectMp4(r: Reader): Promise<VideoInspection> {
  const head = await r.peek(0, 12);
  const major = head.toString('latin1', 8, 12);
  if (AUDIO_BRANDS.has(major)) return { ok: false, reason: 'FILE_TYPE_NOT_ALLOWED' };
  const container: VideoContainer = major === 'qt  ' ? 'quicktime' : 'mp4';
  const metadata: Span[] = [];
  let moov: Box | null = null;
  let pos = 0;
  let count = 0;
  while (pos + 8 <= r.size) {
    if (++count > MAX_BOXES) throw new Unreadable();
    const h = await r.peek(pos, 16);
    if (h.length < 8) throw new Unreadable();
    const s32 = h.readUInt32BE(0);
    let size = s32;
    let header = 8;
    if (s32 === 1) {
      if (h.length < 16) throw new Unreadable();
      size = Number(h.readBigUInt64BE(8));
      header = 16;
    } else if (s32 === 0) size = r.size - pos;
    if (size < header || pos + size > r.size) throw new Unreadable();
    const box: Box = { type: h.toString('latin1', 4, 8), start: pos, size, header };
    if (box.type === 'moov') {
      if (moov) throw new Unreadable();
      moov = box;
    } else if (box.type === 'udta' || box.type === 'meta') metadata.push(box);
    else if (box.type === 'uuid' && box.size >= 24 && (await r.bytes(pos + 8, 16)).equals(XMP_UUID)) metadata.push(box);
    pos += box.size;
  }
  if (!moov) throw new Unreadable();
  if (moov.size > MAX_MOOV) throw new Unreadable();
  const buf = await r.bytes(moov.start, moov.size);
  const base = moov.start;
  let longest = 0;
  let movieScale = 0;
  let video = false;
  for (const c of childrenOf(buf, moov.header, moov.size)) {
    const p = c.start + c.header;
    const end = c.start + c.size;
    if (c.type === 'mvhd') {
      const t = timeOf(buf, p, end);
      movieScale = t?.timescale ?? 0;
      longest = Math.max(longest, msOf(t));
    } else if (c.type === 'udta' || c.type === 'meta') metadata.push({ ...c, start: base + c.start });
    else if (c.type === 'mvex') {
      for (const m of childrenOf(buf, p, end)) {
        if (m.type !== 'mehd') continue;
        const q = m.start + m.header;
        const v1 = buf[q] === 1;
        if (q + (v1 ? 12 : 8) > m.start + m.size) continue;
        const d = v1 ? Number(buf.readBigUInt64BE(q + 4)) : buf.readUInt32BE(q + 4);
        if (movieScale > 0) longest = Math.max(longest, (d * 1000) / movieScale);
      }
    } else if (c.type === 'trak') {
      for (const t of childrenOf(buf, p, end)) {
        if (t.type === 'udta' || t.type === 'meta') metadata.push({ ...t, start: base + t.start });
        if (t.type !== 'mdia') continue;
        for (const m of childrenOf(buf, t.start + t.header, t.start + t.size)) {
          const q = m.start + m.header;
          if (m.type === 'hdlr' && q + 12 <= m.start + m.size && buf.toString('latin1', q + 8, q + 12) === 'vide') video = true;
          if (m.type === 'mdhd') longest = Math.max(longest, msOf(timeOf(buf, q, m.start + m.size)));
        }
      }
    }
  }
  if (!video) return { ok: false, reason: 'FILE_TYPE_NOT_ALLOWED' };
  const durationMs = longest > 0 ? Math.round(longest) : null;
  return { ok: true, container, mime: VIDEO_MIME[container], durationMs, atLeastMs: durationMs ?? 0, metadata };
}

// ---------------------------------------------------------------- WebM (EBML)

const ID = {
  EBML: 0x1a45dfa3,
  DocType: 0x4282,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackType: 0x83,
  CodecID: 0x86,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  BlockGroup: 0xa0,
  Block: 0xa1,
  SimpleBlock: 0xa3,
  Tags: 0x1254c367,
  Void: 0xec,
} as const;
/** Elements walked at most in one file (a file of tiny blocks must not keep the server busy). */
const MAX_ELEMENTS = 1_000_000;

type El = { id: number; idLen: number; size: number | null; sizeLen: number; start: number; data: number };

/** An element header at `pos` (null when it is not a valid header). `size` is null for "unknown". */
function elementIn(b: Buffer, at: number): Omit<El, 'start' | 'data'> | null {
  const first = b[at];
  if (first === undefined || first === 0) return null;
  const idLen = Math.clz32(first) - 23;
  if (idLen > 4 || at + idLen > b.length) return null;
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + b[at + i]!;
  const s = b[at + idLen];
  if (s === undefined || s === 0) return null;
  const sizeLen = Math.clz32(s) - 23;
  if (at + idLen + sizeLen > b.length) return null;
  let size = s & (0xff >> sizeLen);
  let allOnes = size === 0xff >> sizeLen;
  for (let i = 1; i < sizeLen; i++) {
    const v = b[at + idLen + i]!;
    allOnes &&= v === 0xff;
    size = size * 256 + v;
  }
  return { id, idLen, size: allOnes ? null : size, sizeLen };
}
async function elementAt(r: Reader, pos: number): Promise<El | null> {
  const b = await r.peek(pos, 12);
  const e = elementIn(b, 0);
  if (!e) return null;
  return { ...e, start: pos, data: pos + e.idLen + e.sizeLen };
}
const uintOf = (b: Buffer) => b.reduce((n, v) => n * 256 + v, 0);

/** The sized children of a master element read into memory (Info, Tracks, a TrackEntry). */
function* sizedChildren(b: Buffer): Generator<{ id: number; data: Buffer }> {
  let pos = 0;
  while (pos < b.length) {
    const e = elementIn(b, pos);
    if (!e || e.size === null) throw new Unreadable();
    const data = pos + e.idLen + e.sizeLen;
    if (data + e.size > b.length) throw new Unreadable();
    yield { id: e.id, data: b.subarray(data, data + e.size) };
    pos = data + e.size;
  }
}
const MAX_HEADER_ELEMENT = 4 * 1024 * 1024;
async function sizedData(r: Reader, e: El): Promise<Buffer> {
  if (e.size === null || e.size > MAX_HEADER_ELEMENT) throw new Unreadable();
  return r.bytes(e.data, e.size);
}

async function inspectWebm(r: Reader): Promise<VideoInspection> {
  const ebml = await elementAt(r, 0);
  if (!ebml || ebml.id !== ID.EBML) throw new Unreadable();
  let docType = '';
  for (const c of sizedChildren(await sizedData(r, ebml))) if (c.id === ID.DocType) docType = c.data.toString('latin1').replace(/\0+$/u, '');
  if (docType !== 'webm') return { ok: false, reason: 'FILE_TYPE_NOT_ALLOWED' };

  let pos = ebml.data + ebml.size!;
  let seg = await elementAt(r, pos);
  while (seg && seg.id === ID.Void && seg.size !== null) seg = await elementAt(r, seg.data + seg.size);
  if (!seg || seg.id !== ID.Segment) throw new Unreadable();
  const segEnd = seg.size === null ? r.size : Math.min(r.size, seg.data + seg.size);

  let scale = 1_000_000;
  let infoDuration: number | null = null;
  let video = false;
  let tracksSeen = false;
  let clusterTc = 0;
  let maxTc = -1;
  let complete = true;
  const metadata: Span[] = [];
  let count = 0;
  pos = seg.data;
  while (pos < segEnd) {
    if (++count > MAX_ELEMENTS) {
      complete = false;
      break;
    }
    const e = await elementAt(r, pos);
    if (!e || (e.size !== null && e.data + e.size > segEnd)) {
      // A cut-off last element (a recording stopped mid-write) ends the walk; a broken header before
      // the tracks makes the file unreadable.
      if (!tracksSeen) throw new Unreadable();
      complete = false;
      break;
    }
    if (e.id === ID.Cluster || e.id === ID.BlockGroup) {
      pos = e.data; // read the children as they come (a cluster may have an unknown size)
      continue;
    }
    if (e.size === null) {
      if (!tracksSeen) throw new Unreadable();
      complete = false;
      break;
    }
    if (e.id === ID.Info) {
      for (const c of sizedChildren(await sizedData(r, e))) {
        if (c.id === ID.TimecodeScale && c.data.length >= 1 && c.data.length <= 8) scale = uintOf(c.data) || 1_000_000;
        if (c.id === ID.Duration) infoDuration = c.data.length === 4 ? c.data.readFloatBE(0) : c.data.length === 8 ? c.data.readDoubleBE(0) : null;
      }
    } else if (e.id === ID.Tracks) {
      tracksSeen = true;
      for (const t of sizedChildren(await sizedData(r, e))) {
        if (t.id !== ID.TrackEntry) continue;
        for (const c of sizedChildren(t.data)) {
          if (c.id === ID.TrackType && uintOf(c.data) === 1) video = true;
          if (c.id === ID.CodecID && c.data.toString('latin1').startsWith('V_')) video = true;
        }
      }
    } else if (e.id === ID.Timecode) {
      if (e.size > 8) throw new Unreadable();
      clusterTc = uintOf(await r.bytes(e.data, e.size));
    } else if (e.id === ID.SimpleBlock || e.id === ID.Block) {
      const b = await r.peek(e.data, Math.min(e.size, 11));
      const tn = b[0];
      const tnLen = tn ? Math.clz32(tn) - 23 : 9;
      if (tnLen <= 8 && b.length >= tnLen + 2) maxTc = Math.max(maxTc, clusterTc + b.readInt16BE(tnLen));
    } else if (e.id === ID.Tags) metadata.push({ start: e.start, size: e.idLen + e.sizeLen + e.size, header: e.idLen + e.sizeLen, idLen: e.idLen, sizeLen: e.sizeLen });
    pos = e.data + e.size;
  }
  if (!tracksSeen) throw new Unreadable();
  if (!video) return { ok: false, reason: 'FILE_TYPE_NOT_ALLOWED' };
  const info = infoDuration !== null && Number.isFinite(infoDuration) && infoDuration > 0 ? (infoDuration * scale) / 1e6 : 0;
  const blocks = maxTc >= 0 ? (maxTc * scale) / 1e6 : 0;
  const atLeastMs = Math.round(Math.max(info, blocks));
  const durationMs = (complete && maxTc >= 0) || info > 0 ? atLeastMs : null;
  return { ok: true, container: 'webm', mime: VIDEO_MIME.webm, durationMs, atLeastMs, metadata };
}

// ---------------------------------------------------------------- entry points

/** Decide whether `file` is an accepted video (by its bytes) and read its duration and metadata boxes. */
export async function inspectVideo(file: string): Promise<VideoInspection> {
  const fh = await fsp.open(file, 'r');
  try {
    const size = (await fh.stat()).size;
    if (size === 0) return { ok: false, reason: 'FILE_EMPTY' };
    const r = new Reader(fh, size);
    const head = await r.peek(0, 12);
    try {
      if (head.length >= 12 && head.toString('latin1', 4, 8) === 'ftyp') return await inspectMp4(r);
      if (head.length >= 4 && head.readUInt32BE(0) === ID.EBML) return await inspectWebm(r);
    } catch (err) {
      if (err instanceof Unreadable || err instanceof RangeError) return { ok: false, reason: 'VIDEO_UNREADABLE' };
      throw err;
    }
    return { ok: false, reason: 'FILE_TYPE_NOT_ALLOWED' };
  } finally {
    await fh.close();
  }
}

/** An EBML size field of exactly `len` bytes holding `value`. */
function vint(value: number, len: number): Buffer {
  const b = Buffer.alloc(len);
  let v = value;
  for (let i = len - 1; i >= 0; i--) {
    b[i] = v % 256;
    v = Math.floor(v / 256);
  }
  b[0] = b[0]! | (0x80 >> (len - 1));
  return b;
}

/**
 * Blank the metadata boxes or elements found by `inspectVideo`, in place and without changing any size
 * or offset: MP4/MOV boxes become `free`, WebM Tags become Void; their content is zeroed.
 */
export async function neutraliseVideoMetadata(file: string, container: VideoContainer, spans: readonly Span[]): Promise<number> {
  if (!spans.length) return 0;
  const fh = await fsp.open(file, 'r+');
  try {
    for (const s of spans) {
      let dataStart: number;
      if (container === 'webm') {
        // Void (1-byte id) + a size field long enough that the element keeps its total length.
        const len = Math.min(8, (s.idLen ?? 4) + (s.sizeLen ?? 1) - 1);
        dataStart = s.start + 1 + len;
        const header = Buffer.concat([Buffer.from([ID.Void]), vint(s.start + s.size - dataStart, len)]);
        await fh.write(header, 0, header.length, s.start);
      } else {
        dataStart = s.start + s.header;
        await fh.write(Buffer.from('free', 'latin1'), 0, 4, s.start + 4);
      }
      const zero = Buffer.alloc(Math.min(1024 * 1024, Math.max(0, s.start + s.size - dataStart)));
      for (let p = dataStart; p < s.start + s.size; p += zero.length) await fh.write(zero, 0, Math.min(zero.length, s.start + s.size - p), p);
    }
    return spans.length;
  } finally {
    await fh.close();
  }
}
