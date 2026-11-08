// @vitest-environment jsdom
/**
 * S13b2 client logic: the link cards (15 or 8 per A4 page, QR that decodes with jsQR including its
 * quiet zone), the student-page language select, the evidence choices per media flag, picture
 * preparation helpers and the voice timer. Fictional data only.
 */
import { cleanup, render, screen } from '@testing-library/react';
import jsQRImport from 'jsqr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVIDENCE_IMAGE_EDGE, MAX_VOICE_RECORDING_MS } from '../../src/shared/contracts/files.ts';
import { studentPageLanguage } from '../../src/shared/classLanguage.ts';
import { evidenceModes } from '../../src/client/modules/goals/EvidenceAdder.tsx';
import { clockText } from '../../src/client/modules/goals/VoiceRecorder.tsx';
import { fitWithin, formatBytes, isHeic, jpegName, looksLikeImage, preparePicture } from '../../src/client/lib/images.ts';
import { CARDS_PER_PAGE, LinkCardSheets, QR_QUIET_MODULES, QrCode, qrMatrix } from '../../src/client/routes/teacher/StudentLinks.tsx';
import { StudentPageLanguageSelect, studentPageOverride } from '../../src/client/ui/ClassLanguageSelect.tsx';

// jsqr is a CommonJS bundle: its default export is the decoder at runtime, typed as a namespace under NodeNext.
type Decode = (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null;
const jsQR = ((jsQRImport as unknown as { default?: Decode }).default ?? jsQRImport) as unknown as Decode;

afterEach(cleanup);

const URL_SAMPLE = 'https://class.example.test/s/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdEfG';
const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `student-fictional-${i}`, fullName: `Pupil Fictional ${i + 1}`, className: '5A', url: `${URL_SAMPLE}${i}` }));

/** Rasterise a QR matrix with its quiet zone into RGBA pixels, `px` pixels per module. */
function rasterise(matrix: boolean[][], px: number, quiet = QR_QUIET_MODULES) {
  const n = matrix.length + quiet * 2;
  const size = n * px;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < matrix.length; r++)
    for (let c = 0; c < matrix.length; c++) {
      if (!matrix[r]![c]) continue;
      for (let y = 0; y < px; y++)
        for (let x = 0; x < px; x++) {
          const i = (((r + quiet) * px + y) * size + (c + quiet) * px + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
    }
  return { data, size };
}

describe('link cards (S13b 15, D-120)', () => {
  it('fits 30 students on 2 A4 pages of small cards and 4 of large ones', () => {
    expect(CARDS_PER_PAGE).toEqual({ small: 15, large: 8 });
    const { unmount } = render(<LinkCardSheets cards={cards(30)} size="small" cardLanguage="en" mode="preview" />);
    expect(screen.getAllByTestId('link-page')).toHaveLength(2);
    expect(screen.getAllByTestId('link-card')).toHaveLength(30);
    unmount();
    render(<LinkCardSheets cards={cards(30)} size="large" cardLanguage="en" mode="preview" />);
    expect(screen.getAllByTestId('link-page')).toHaveLength(4);
  });

  it('prints the short card line in the student-page language', () => {
    render(<LinkCardSheets cards={cards(1)} size="small" cardLanguage="tr" mode="preview" />);
    const card = screen.getByTestId('link-card');
    expect(card.querySelector('[lang="tr"]')?.textContent).toMatch(/okut/u);
  });

  it('builds a QR matrix that jsQR decodes back to the link (quiet zone included)', () => {
    const m = qrMatrix(URL_SAMPLE);
    const { data, size } = rasterise(m, 4);
    expect(jsQR(data, size, size)?.data).toBe(URL_SAMPLE);
  });

  it('draws the QR as one path with a 4-module quiet zone and a printed size from the module count', () => {
    render(<QrCode text={URL_SAMPLE} label="QR code for a fictional pupil" minMm={28} />);
    const svg = screen.getByRole('img', { name: 'QR code for a fictional pupil' });
    const n = qrMatrix(URL_SAMPLE).length;
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${n + 2 * QR_QUIET_MODULES} ${n + 2 * QR_QUIET_MODULES}`);
    const width = Number.parseFloat((svg as unknown as SVGSVGElement).style.width);
    expect((svg as unknown as SVGSVGElement).style.width).toMatch(/mm$/u);
    // The symbol itself (without the quiet zone) is at least 28 mm wide.
    expect((width * n) / (n + 2 * QR_QUIET_MODULES)).toBeGreaterThanOrEqual(27.99);
  });
});

describe('student-page language (S13b 14b, D-117)', () => {
  it('offers "Same as the class" plus the four modes', () => {
    render(<StudentPageLanguageSelect value={null} onChange={() => undefined} />);
    expect(screen.getAllByText('Student page language').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Same as the class').length).toBeGreaterThan(0);
  });

  it('reads the stored override and resolves the page language', () => {
    expect(studentPageOverride({ studentPageMainLanguage: null, studentPageSecondLanguageEnabled: null })).toBeNull();
    expect(studentPageOverride({ studentPageMainLanguage: 'tr', studentPageSecondLanguageEnabled: false })).toEqual({ mainLanguage: 'tr', secondLanguageEnabled: false });
    const englishClass = { mainLanguage: 'en' as const, secondLanguageEnabled: false };
    expect(studentPageLanguage(englishClass)).toEqual(englishClass);
    expect(studentPageLanguage({ ...englishClass, studentPageMainLanguage: 'tr', studentPageSecondLanguageEnabled: false })).toEqual({ mainLanguage: 'tr', secondLanguageEnabled: false });
  });
});

describe('evidence (S13b 13, 14c, D-119)', () => {
  it('offers only the ways the media flags allow', () => {
    expect(evidenceModes({ photos: false, audio: false, documents: false })).toEqual(['text', 'link']);
    expect(evidenceModes({ photos: false, audio: false, documents: true })).toEqual(['text', 'link', 'document']);
    expect(evidenceModes({ photos: true, audio: true, documents: true })).toEqual(['text', 'link', 'picture', 'camera', 'document', 'voice', 'voiceFile']);
  });

  it('scales pictures down to the long edge without upscaling', () => {
    expect(EVIDENCE_IMAGE_EDGE).toBe(2048);
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('recognises HEIC pictures and other images by type or name', () => {
    expect(isHeic({ type: 'image/heic', name: 'IMG_0001.HEIC' })).toBe(true);
    expect(isHeic({ type: '', name: 'holiday.heif' })).toBe(true);
    expect(isHeic({ type: 'image/jpeg', name: 'photo.jpg' })).toBe(false);
    expect(looksLikeImage({ type: '', name: 'scan.PNG' })).toBe(true);
    expect(looksLikeImage({ type: 'application/pdf', name: 'essay.pdf' })).toBe(false);
    expect(jpegName('My poster.png', 'picture')).toBe('My poster.jpg');
    expect(jpegName(undefined, 'photo')).toBe('photo.jpg');
  });

  it('converts HEIC to JPEG where the browser can decode it, and reports it as not convertible otherwise', async () => {
    const heic = new File([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])], 'IMG_0001.HEIC', { type: 'image/heic' });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({ drawImage: () => undefined })) as never);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
      cb(new Blob(['jpeg'], { type: 'image/jpeg' }));
    });
    try {
      // Safari-like: the browser decodes HEIC.
      vi.stubGlobal('createImageBitmap', async () => ({ width: 4032, height: 3024, close: () => undefined }));
      const out = await preparePicture(heic);
      expect(out?.type).toBe('image/jpeg');
      // Chrome/Firefox-like: decoding fails, so the caller shows IMAGE_HEIC.
      vi.stubGlobal('createImageBitmap', async () => {
        throw new DOMException('cannot decode', 'InvalidStateError');
      });
      expect(await preparePicture(heic)).toBeNull();
      // A normal picture the browser cannot decode is still sent (the server checks it).
      const png = new File([new Uint8Array([1, 2, 3])], 'scan.png', { type: 'image/png' });
      expect(await preparePicture(png)).toBe(png);
    } finally {
      vi.unstubAllGlobals();
      getContext.mockRestore();
      toBlob.mockRestore();
    }
  });

  it('shows sizes and the recording timer', () => {
    expect(formatBytes(512, 'en')).toBe('512 B');
    expect(formatBytes(2.5 * 1024 * 1024, 'en')).toBe('2.5 MB');
    expect(formatBytes(2.5 * 1024 * 1024, 'tr')).toBe('2,5 MB');
    expect(MAX_VOICE_RECORDING_MS).toBe(300000);
    expect(clockText(0)).toBe('0:00');
    expect(clockText(65_400)).toBe('1:05');
    expect(clockText(MAX_VOICE_RECORDING_MS)).toBe('5:00');
  });
});
