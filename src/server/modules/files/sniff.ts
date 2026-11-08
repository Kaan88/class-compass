/**
 * Content sniffing (S9, STU-8). The type of an upload is decided from its bytes only, never from the
 * client's Content-Type or file name, and checked against the per-kind allow-list. Markup (SVG,
 * HTML, XML) and scripts are always refused, also when they pretend to be text or an image.
 */
import fsp from 'node:fs/promises';
import { fileTypeFromFile } from 'file-type';
import * as XLSX from 'xlsx';

export const MIME = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  text: 'text/plain',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  mp4: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
} as const;

export type SniffResult = { ok: true; mime: string } | { ok: false; reason: 'FILE_TYPE_NOT_ALLOWED' | 'FILE_EMPTY'; detected: string | null };

/** file-type extensions → our canonical MIME types. Everything else is refused. */
const BY_EXT: Record<string, string> = {
  jpg: MIME.jpeg,
  png: MIME.png,
  webp: MIME.webp,
  pdf: MIME.pdf,
  docx: MIME.docx,
  pptx: MIME.pptx,
  odt: MIME.odt,
  xlsx: MIME.xlsx,
  webm: MIME.webm,
  ogg: MIME.ogg,
  oga: MIME.ogg,
  opus: MIME.ogg,
  m4a: MIME.mp4,
  mp4: MIME.mp4,
  mp3: MIME.mp3,
  wav: MIME.wav,
};

/** Markup or script markers that make a "text" upload unacceptable (served text must never render). */
const MARKUP = /<\s*(?:!doctype|html|head|body|script|svg|iframe|object|embed|xml|\?xml|style|meta|link|img|a\s|form|math)\b|<\?xml|javascript:/iu;

/** Is this an Excel 97-2003 workbook (an OLE compound file with a Workbook/Book stream)? */
function isLegacyWorkbook(buf: Buffer): boolean {
  try {
    const cfb = XLSX.CFB.read(buf, { type: 'buffer' });
    return cfb.FullPaths.some((p: string) => /\/(Workbook|Book)$/iu.test(p));
  } catch {
    return false;
  }
}

/**
 * Plain text check: UTF-16 with a BOM, or 8-bit text without NUL bytes and with few control
 * characters, and without markup.
 */
export function looksLikePlainText(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  let text: string;
  if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) {
    const le = buf[0] === 0xff;
    const body = buf.subarray(2);
    if (body.length % 2 !== 0) return false;
    text = le ? body.toString('utf16le') : Buffer.from(body).swap16().toString('utf16le');
  } else {
    if (buf.includes(0)) return false;
    text = buf.toString('latin1');
  }
  let control = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12) control++;
  }
  if (control > text.length / 100 + 2) return false;
  return !MARKUP.test(text);
}

/** Sniff a file on disk against the allow-list `allowed`. */
export async function sniffFile(file: string, allowed: readonly string[]): Promise<SniffResult> {
  const stat = await fsp.stat(file);
  if (stat.size === 0) return { ok: false, reason: 'FILE_EMPTY', detected: null };
  const ft = await fileTypeFromFile(file);
  let mime: string | null = null;
  if (ft) {
    if (ft.ext === 'cfb') {
      const buf = await fsp.readFile(file);
      mime = isLegacyWorkbook(buf) ? MIME.xls : null;
    } else mime = BY_EXT[ft.ext] ?? null;
    if (!mime) return { ok: false, reason: 'FILE_TYPE_NOT_ALLOWED', detected: ft.mime };
  } else {
    // No binary signature: accept only plain text (CSV/TXT) without markup anywhere in it (uploads
    // are size-limited, so reading the whole file is bounded).
    mime = looksLikePlainText(await fsp.readFile(file)) ? MIME.text : null;
    if (!mime) return { ok: false, reason: 'FILE_TYPE_NOT_ALLOWED', detected: null };
  }
  if (!allowed.includes(mime)) return { ok: false, reason: 'FILE_TYPE_NOT_ALLOWED', detected: mime };
  return { ok: true, mime };
}
