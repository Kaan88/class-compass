/**
 * Local OCR for photos and scans of class lists (IMP-1, IMP-7, D-011). tesseract.js runs the
 * Tesseract engine (WebAssembly from node_modules) in a worker thread on this server; the image never
 * leaves it. Turkish + English language data come from the pinned `@tesseract.js-data/tur` and
 * `@tesseract.js-data/eng` packages (integrity in package-lock.json), are copied into the
 * gitignored `DATA_DIR/ocr-cache` and verified against the SHA-256 below before every use, so
 * tesseract.js never downloads anything. One OCR job runs at a time; a job that exceeds
 * OCR_TIMEOUT_MS terminates its worker.
 */
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker, OEM, type Worker } from 'tesseract.js';
import type { Config } from '../../../config.ts';
import { AppError } from '../../../lib/errors.ts';

/** SHA-256 of the gzipped `4.0.0_best_int` traineddata files of @tesseract.js-data/{tur,eng}@1.0.0. */
export const TRAINEDDATA = {
  tur: '384ba0dc28040451b7818d7d60e0a88df0d3003fa5a01d713a468779bc3d8c04',
  eng: '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91',
} as const;
type Lang = keyof typeof TRAINEDDATA;

const require = createRequire(import.meta.url);

async function sha256(file: string): Promise<string> {
  return crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex');
}

/** Copy (if needed) and verify the language data; returns the local language directory. */
export async function ensureLanguageData(config: Pick<Config, 'ocrCacheDir'>): Promise<string> {
  const dir = path.join(config.ocrCacheDir, 'tessdata');
  await fsp.mkdir(dir, { recursive: true });
  for (const lang of Object.keys(TRAINEDDATA) as Lang[]) {
    const target = path.join(dir, `${lang}.traineddata.gz`);
    let ok = false;
    try {
      ok = (await sha256(target)) === TRAINEDDATA[lang];
    } catch {
      ok = false;
    }
    if (!ok) {
      const pkg = path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
      const source = path.join(pkg, '4.0.0_best_int', `${lang}.traineddata.gz`);
      if ((await sha256(source)) !== TRAINEDDATA[lang]) throw new Error(`OCR language data for ${lang} does not match its pinned checksum`);
      await fsp.copyFile(source, `${target}.tmp`);
      await fsp.rename(`${target}.tmp`, target);
    }
  }
  return dir;
}

export interface OcrLine {
  text: string;
  confidence: number;
}

/** Contrast and size help Tesseract with phone photos: greyscale, normalise, upscale small images. */
async function prepare(image: Buffer): Promise<Buffer> {
  const img = sharp(image, { limitInputPixels: 50_000_000 }).rotate();
  const meta = await img.metadata();
  const width = meta.width ?? 0;
  const pipeline = sharp(image, { limitInputPixels: 50_000_000 }).rotate().greyscale().normalise();
  return (width > 0 && width < 1600 ? pipeline.resize({ width: Math.min(width * 2, 3200) }) : pipeline).png().toBuffer();
}

let queue: Promise<unknown> = Promise.resolve();

/** Run OCR on an image (one job at a time); returns its text lines with Tesseract's confidence (0–100). */
export function recognise(config: Pick<Config, 'ocrCacheDir' | 'OCR_TIMEOUT_MS'>, image: Buffer): Promise<OcrLine[]> {
  const job = queue.then(() => run(config, image));
  queue = job.catch(() => undefined);
  return job;
}

async function run(config: Pick<Config, 'ocrCacheDir' | 'OCR_TIMEOUT_MS'>, image: Buffer): Promise<OcrLine[]> {
  const langPath = await ensureLanguageData(config);
  const png = await prepare(image);
  let worker: Worker | null = null;
  let timer: NodeJS.Timeout | undefined;
  let finished = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError('CONFLICT', 'Reading the picture took too long', { reason: 'OCR_TIMEOUT' })), config.OCR_TIMEOUT_MS);
  });
  try {
    const work = (async () => {
      worker = await createWorker(['tur', 'eng'], OEM.LSTM_ONLY, {
        langPath,
        cachePath: langPath,
        gzip: true,
        cacheMethod: 'none',
        logger: () => undefined,
        errorHandler: () => undefined,
      });
      // Timed out while the worker was starting: stop it at once.
      if (finished) {
        await worker.terminate().catch(() => undefined);
        return [];
      }
      const res = await worker.recognize(png, {}, { text: true, blocks: true });
      const lines: OcrLine[] = [];
      for (const b of res.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) lines.push({ text: l.text.replace(/\s+/gu, ' ').trim(), confidence: Math.round(l.confidence) });
      return lines.filter((l) => l.text);
    })();
    return await Promise.race([work, timeout]);
  } finally {
    finished = true;
    clearTimeout(timer);
    const w = worker as Worker | null;
    if (w) await w.terminate().catch(() => undefined);
  }
}
