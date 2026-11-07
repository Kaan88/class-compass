/**
 * Copies and verifies the pinned OCR language data (tur + eng, D-011) into OCR_CACHE_DIR, so a
 * container image carries it at build time and the app never downloads anything at run time.
 *   OCR_CACHE_DIR=/opt/class-compass/ocr node scripts/prepare-ocr.ts
 */
import path from 'node:path';
import { ensureLanguageData } from '../src/server/modules/import/parsers/ocr.ts';

const dir = path.resolve(process.env.OCR_CACHE_DIR ?? './data/ocr-cache');
const out = await ensureLanguageData({ ocrCacheDir: dir });
console.log(`OCR language data ready in ${out}`);
