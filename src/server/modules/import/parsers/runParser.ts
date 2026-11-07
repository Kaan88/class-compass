/**
 * Runs a document parser in its own worker thread with a time limit and a memory cap (S10; like OCR,
 * D-080). One thread per file: it is started for the job and always terminated afterwards, so a parser
 * stuck in a loop or holding memory is stopped (`PARSE_TIMEOUT`) without affecting the server.
 */
import { Worker } from 'node:worker_threads';
import type { SourceRow } from '../../../../domain/importing.ts';
import { AppError } from '../../../lib/errors.ts';
import type { ParserKind } from './worker.ts';

export interface ParserResults {
  workbook: { rows: SourceRow[]; sheets: number };
  docx: SourceRow[];
  pdf: { rows: SourceRow[]; scanned: boolean; pages: number };
}

const WORKER_URL = new URL('./worker.ts', import.meta.url);

export function runParser<K extends ParserKind>(kind: K, buf: Buffer, timeoutMs: number): Promise<ParserResults[K]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { resourceLimits: { maxOldGenerationSizeMb: 512 }, stdout: true, stderr: true });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => undefined);
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new AppError('CONFLICT', 'Reading the file took too long', { reason: 'PARSE_TIMEOUT' }))),
      timeoutMs,
    );
    worker.once('message', (msg: { ok: true; result: ParserResults[K] } | { ok: false; message: string }) =>
      finish(() => (msg.ok ? resolve(msg.result) : reject(new Error(msg.message)))),
    );
    worker.once('error', (err) => finish(() => reject(err)));
    worker.once('exit', (code) => finish(() => reject(new Error(`parser worker exited with ${code}`))));
    // Copy the bytes into the message (the caller keeps its buffer).
    worker.postMessage({ kind, buf: new Uint8Array(buf) });
  });
}
