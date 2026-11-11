/**
 * Content sniffing (S9, STU-8). The type of an upload is decided from its bytes only, never from the
 * client's Content-Type or file name, and checked against the per-kind allow-list. Markup (SVG,
 * HTML, XML) and scripts are always refused, also when they pretend to be text or an image.
 *
 * The one exception (S20c, D-171): an HTML document with a table, uploaded as a student list with a
 * `.xls` name (some school systems export lists like that), gets the internal type
 * `application/x-cc-html-table`. Only the `import_source` kind allows it, the name is an extra
 * condition (never a reason on its own), the importer reads only the table text in its parser worker,
 * and the file is never served as HTML (attachment, sandbox CSP, nosniff, that internal type).
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
  /** An HTML table saved with a `.xls` name (import sources only, D-171); never served as HTML. */
  htmlTable: 'application/x-cc-html-table',
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

/**
 * Is this an HTML document with a table (D-171)? Before the first element there may only be
 * whitespace, a BOM, an XML declaration, an HTML doctype and comments; the first element must be
 * `html`, `head`, `body`, `meta` or `table`, and a `<table` followed by a `<tr` must come later.
 */
export function looksLikeHtmlTable(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const le = buf[0] === 0xff && buf[1] === 0xfe;
  const be = buf[0] === 0xfe && buf[1] === 0xff;
  let text: string;
  if (le || be) {
    const body = buf.subarray(2, 2 + (Math.min(buf.length - 2, 8_000_000) & ~1));
    text = le ? body.toString('utf16le') : Buffer.from(body).swap16().toString('utf16le');
  } else {
    if (buf.subarray(0, 65536).includes(0)) return false;
    text = buf.subarray(0, 4_000_000).toString('latin1');
  }
  const head = text.slice(0, 65536);
  let i = 0;
  for (;;) {
    while (i < head.length && /[\s﻿ï»¿]/u.test(head[i]!)) i++;
    if (head.startsWith('<!--', i)) {
      const e = head.indexOf('-->', i + 4);
      if (e < 0) return false;
      i = e + 3;
    } else if (head.startsWith('<?xml', i) || /^<!doctype\s+html/iu.test(head.slice(i, i + 20))) {
      const e = head.indexOf('>', i);
      if (e < 0) return false;
      i = e + 1;
    } else break;
  }
  if (!/^<(html|head|body|meta|table)[\s>/]/iu.test(head.slice(i, i + 8))) return false;
  const lower = text.toLowerCase();
  const table = lower.indexOf('<table');
  return table >= 0 && lower.indexOf('<tr', table) >= 0;
}

/**
 * Sniff a file on disk against the allow-list `allowed`. `name` (the client's file name) is used only
 * as an extra condition for the HTML-table exception above, never to accept anything by itself.
 */
export async function sniffFile(file: string, allowed: readonly string[], opts: { name?: string | null } = {}): Promise<SniffResult> {
  const stat = await fsp.stat(file);
  if (stat.size === 0) return { ok: false, reason: 'FILE_EMPTY', detected: null };
  const ft = await fileTypeFromFile(file);
  let mime: string | null = null;
  const htmlTableAllowed = allowed.includes(MIME.htmlTable) && /\.xls$/iu.test(opts.name ?? '');
  if ((!ft || ft.ext === 'xml') && htmlTableAllowed && looksLikeHtmlTable(await fsp.readFile(file))) return { ok: true, mime: MIME.htmlTable };
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
