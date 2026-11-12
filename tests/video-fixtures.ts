/**
 * Tiny synthetic video containers for the S27a tests (D-193). They show nothing (no real frames):
 * only the boxes and elements the server reads (type, picture track, duration, metadata). The
 * "location" in them is a made-up point, not a real place anyone was.
 */

export const FAKE_LOCATION = '+00.0001+000.0001/';

// ---------------------------------------------------------------- MP4 / MOV
const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
};
/** `mvhd` / `mdhd` version 0: version+flags, creation, modification, timescale, duration (+ padding). */
const timeBox = (type: 'mvhd' | 'mdhd', timescale: number, duration: number, pad: number) => box(type, u32(0), u32(0), u32(0), u32(timescale), u32(duration), Buffer.alloc(pad));
const hdlr = (handler: string) => box('hdlr', u32(0), u32(0), Buffer.from(handler, 'latin1'), Buffer.alloc(12), Buffer.from('fictional\0', 'latin1'));
const trak = (handler: string, timescale: number, duration: number, extra: Buffer[] = []) =>
  box('trak', box('tkhd', Buffer.alloc(84)), box('mdia', timeBox('mdhd', timescale, duration, 4), hdlr(handler)), ...extra);

export interface Mp4Options {
  /** Movie length in seconds (mvhd and every track's mdhd); 0 = unknown (fragmented, no mehd). */
  seconds?: number;
  brand?: string;
  /** Track handlers: `vide` makes it a video, only `soun` makes it audio-only. */
  tracks?: string[];
  /** Put location tags in `moov/udta` (©xyz), `moov/meta` and a track's `udta`. */
  location?: boolean;
  /** Bytes of (meaningless) media data. */
  mdat?: number;
  /** Leave out the moov box (a cut-off upload). */
  noMoov?: boolean;
  /** Fragmented: mvhd duration 0 plus an `mvex` (with a `mehd` of this many seconds when given). */
  fragmentSeconds?: number | null;
}

export function mp4Video(o: Mp4Options = {}): Buffer {
  const ts = 1000;
  const seconds = o.seconds ?? 2;
  const dur = Math.round(seconds * ts);
  const brand = o.brand ?? 'isom';
  const ftyp = box('ftyp', Buffer.from(brand, 'latin1'), u32(0), Buffer.from('isommp42', 'latin1'));
  const loc = Buffer.from(FAKE_LOCATION, 'latin1');
  const udta = box('udta', box('©xyz', Buffer.from([0, loc.length, 0x15, 0xc7]), loc), box('©mod', Buffer.from('Fictional Phone 1', 'latin1')));
  const meta = box('meta', box('hdlr', u32(0), u32(0), Buffer.from('mdta', 'latin1'), Buffer.alloc(12), Buffer.from([0])), box('keys', Buffer.from('com.apple.quicktime.location.ISO6709', 'latin1')), box('ilst', loc));
  const tracks = (o.tracks ?? ['vide', 'soun']).map((h, i) => trak(h, ts, o.fragmentSeconds !== undefined ? 0 : dur, o.location && i === 0 ? [box('udta', box('©xyz', loc))] : []));
  const mvex = o.fragmentSeconds !== undefined ? [box('mvex', ...(o.fragmentSeconds !== null ? [box('mehd', u32(0), u32(Math.round(o.fragmentSeconds * ts)))] : []), box('trex', Buffer.alloc(24)))] : [];
  const moov = box('moov', timeBox('mvhd', ts, o.fragmentSeconds !== undefined ? 0 : dur, 80), ...tracks, ...mvex, ...(o.location ? [udta, meta] : []));
  const mdat = box('mdat', Buffer.alloc(o.mdat ?? 256, 0x5a));
  return Buffer.concat(o.noMoov ? [ftyp, mdat] : [ftyp, moov, mdat]);
}

// ---------------------------------------------------------------- WebM (EBML)
const idBytes = (id: number) => {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256);
  return Buffer.from(out);
};
const sizeVint = (n: number) => {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const b = Buffer.alloc(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) {
        b[i] = v % 256;
        v = Math.floor(v / 256);
      }
      b[0] = b[0]! | (0x80 >> (len - 1));
      return b;
    }
  }
  throw new Error('too big');
};
const UNKNOWN = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
const el = (id: number, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([idBytes(id), sizeVint(body.length), body]);
};
const elUnknown = (id: number, ...parts: Buffer[]) => Buffer.concat([idBytes(id), UNKNOWN, ...parts]);
const uint = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
};
const str = (s: string) => Buffer.from(s, 'latin1');
const f64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(n, 0);
  return b;
};
const block = (rel: number, track = 1) => {
  const b = Buffer.alloc(4 + 16, 0x33);
  b[0] = 0x80 | track;
  b.writeInt16BE(rel, 1);
  b[3] = 0x80;
  return el(0xa3, b);
};

export interface WebmOptions {
  docType?: string;
  /** Info/Duration in ms (a browser recording has none). */
  infoMs?: number | null;
  /** Clusters of blocks: [cluster time in ms, block times relative to it]. */
  clusters?: Array<[number, number[]]>;
  /** Track types: 1 = video, 2 = audio. */
  tracks?: number[];
  /** Segment and clusters of unknown size, as MediaRecorder writes them. */
  unknownSizes?: boolean;
  /** A Tags element with a location tag. */
  tags?: boolean;
}

export function webmVideo(o: WebmOptions = {}): Buffer {
  const header = el(0x1a45dfa3, el(0x4286, Buffer.from([1])), el(0x42f7, Buffer.from([1])), el(0x42f2, Buffer.from([4])), el(0x42f3, Buffer.from([8])), el(0x4282, str(o.docType ?? 'webm')), el(0x4287, Buffer.from([4])), el(0x4285, Buffer.from([2])));
  const info = el(0x1549a966, el(0x2ad7b1, uint(1_000_000)), ...(o.infoMs ? [el(0x4489, f64(o.infoMs))] : []), el(0x4d80, str('fictional-muxer')));
  const tracks = el(
    0x1654ae6b,
    ...(o.tracks ?? [1, 2]).map((t, i) => el(0xae, el(0xd7, Buffer.from([i + 1])), el(0x83, Buffer.from([t])), el(0x86, str(t === 1 ? 'V_VP8' : 'A_OPUS')))),
  );
  const unknown = o.unknownSizes ?? true;
  const clusters = (o.clusters ?? [[0, [0, 500, 1000]], [1500, [0, 500]]]).map(([tc, rels]) => (unknown ? elUnknown : el)(0x1f43b675, el(0xe7, uint(tc)), ...rels.map((r) => block(r))));
  const tags = o.tags ? [el(0x1254c367, el(0x7373, el(0x67c8, el(0x45a3, str('LOCATION')), el(0x4487, str(FAKE_LOCATION)))))] : [];
  const segmentBody = [info, tracks, ...clusters, ...tags];
  return Buffer.concat([header, unknown ? elUnknown(0x18538067, ...segmentBody) : el(0x18538067, ...segmentBody)]);
}
