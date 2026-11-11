/**
 * Worker-thread entry for document parsing (S10, closes the S9 gap of D-079/D-081): workbooks, Word
 * and PDF files are parsed here instead of on the server's main thread, so a slow or hostile file can
 * neither block other requests nor run past its time limit (`runParser` terminates the thread).
 * Receives `{ kind, buf }`, answers `{ ok: true, result }` or `{ ok: false, message }`.
 */
import { parentPort } from 'node:worker_threads';
import { parseDocx } from './docx.ts';
import { parseHtmlTables } from './html.ts';
import { parsePdf } from './pdf.ts';
import { parseWorkbook } from './spreadsheet.ts';

export type ParserKind = 'workbook' | 'docx' | 'pdf' | 'htmlTable';

async function parse(kind: ParserKind, buf: Buffer): Promise<unknown> {
  if (kind === 'workbook') return parseWorkbook(buf);
  if (kind === 'docx') return parseDocx(buf);
  // HTML-table .xls (S20c, D-171): table text only, never executed or fetched.
  if (kind === 'htmlTable') return parseHtmlTables(buf);
  return parsePdf(buf);
}

parentPort?.once('message', (msg: { kind: ParserKind; buf: Uint8Array }) => {
  parse(msg.kind, Buffer.from(msg.buf.buffer, msg.buf.byteOffset, msg.buf.byteLength)).then(
    (result) => parentPort!.postMessage({ ok: true, result }),
    (err: unknown) => parentPort!.postMessage({ ok: false, message: err instanceof Error ? err.message : String(err) }),
  );
});
