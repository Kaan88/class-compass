/**
 * Pictures on the device before upload (S13b2, D-119): scale down to EVIDENCE_IMAGE_EDGE on the long
 * edge and re-encode as JPEG, so phone photos upload quickly. The canvas re-encode also drops the
 * EXIF block (GPS, camera); the server re-encodes again and is the real guarantee (D-014).
 * HEIC/HEIF (iPhone default) is tried too: where the browser can decode it (Safari on iOS and macOS)
 * it is converted to JPEG here; where it cannot, the student gets a friendly explanation instead of
 * an upload error (the server cannot decode HEIC and refuses it with IMAGE_HEIC).
 */
import { EVIDENCE_IMAGE_EDGE } from '../../shared/contracts/files.ts';

export const JPEG_QUALITY = 0.85;

/** Size that fits inside `maxEdge` on the long edge, keeping the aspect ratio; never upscales. */
export function fitWithin(width: number, height: number, maxEdge = EVIDENCE_IMAGE_EDGE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge || long === 0) return { width, height };
  const scale = maxEdge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** A HEIC/HEIF picture (iPhone default format), by type or by file name. */
export function isHeic(file: { type: string; name?: string }): boolean {
  return /^image\/hei[cf](-sequence)?$/iu.test(file.type) || /\.(heic|heif)$/iu.test(file.name ?? '');
}

/** Any picture type, judged by the browser's type or the name (for choosing the upload kind). */
export function looksLikeImage(file: { type: string; name?: string }): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/iu.test(file.name ?? '');
}

/** JPEG file name for a re-encoded picture. */
export function jpegName(name: string | undefined, fallback: string): string {
  const base = (name ?? '').replace(/\.[^.]+$/u, '').trim();
  return `${base || fallback}.jpg`;
}

/**
 * Scale a picture down and re-encode it as JPEG. Falls back to the original blob when the browser
 * cannot decode it here (the server still checks, re-encodes and strips metadata).
 */
export async function prepareImage(blob: Blob, maxEdge = EVIDENCE_IMAGE_EDGE, quality = JPEG_QUALITY): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return blob;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return blob;
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const g = canvas.getContext('2d');
    if (!g) return blob;
    g.drawImage(bitmap, 0, 0, size.width, size.height);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return out ?? blob;
  } finally {
    bitmap.close();
  }
}

/**
 * Prepare a chosen picture for upload. HEIC/HEIF is converted where the browser can decode it;
 * `null` means it could not be converted here (show IMAGE_HEIC instead of uploading).
 */
export async function preparePicture(file: Blob & { name?: string }): Promise<Blob | null> {
  const out = await prepareImage(file);
  if (isHeic(file) && (out === file || out.type !== 'image/jpeg')) return null;
  return out;
}

/** Grab one frame of a playing video element as a JPEG (the in-page camera). */
export async function captureFrame(video: HTMLVideoElement, maxEdge = EVIDENCE_IMAGE_EDGE, quality = JPEG_QUALITY): Promise<Blob | null> {
  const size = fitWithin(video.videoWidth, video.videoHeight, maxEdge);
  if (!size.width || !size.height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.drawImage(video, 0, 0, size.width, size.height);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** Human-readable file size ("2.4 MB"). */
export function formatBytes(n: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { maximumFractionDigits: i === 0 ? 0 : 1 }).format(v)} ${units[i]}`;
}
