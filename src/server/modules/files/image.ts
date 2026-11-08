/**
 * Image re-encoding (S9, STU-8). Every accepted image is decoded and encoded again with sharp, so
 * what we store is pixels only: EXIF (including GPS), XMP, ICC comments and anything appended to
 * the file (polyglots such as HTML hidden in a JPEG) are dropped. The orientation from EXIF is
 * applied first, the size is capped at 2560 px (evidence pictures at 2048 px, D-119) and a small thumbnail is made.
 */
import sharp from 'sharp';
import { MIME } from './sniff.ts';

export const MAX_IMAGE_EDGE = 2560;
export const THUMB_EDGE = 320;
/** Refuse decompression bombs: at most 50 megapixels before resizing. */
const LIMIT_INPUT_PIXELS = 50_000_000;

export interface ReencodedImage {
  main: Buffer;
  mime: string;
  thumb: Buffer;
  thumbMime: string;
  width: number;
  height: number;
}

export async function reencodeImage(input: Buffer | string, mime: string, maxEdge = MAX_IMAGE_EDGE): Promise<ReencodedImage> {
  const base = () => sharp(input, { limitInputPixels: LIMIT_INPUT_PIXELS, failOn: 'error', animated: false }).rotate();
  const resized = base().resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true });
  // sharp writes no metadata unless asked to (no keepMetadata/withMetadata here).
  const encoded =
    mime === MIME.png ? resized.png({ compressionLevel: 9 }) : mime === MIME.webp ? resized.webp({ quality: 85 }) : resized.jpeg({ quality: 85, mozjpeg: true });
  const { data: main, info } = await encoded.toBuffer({ resolveWithObject: true });
  const thumb = await base().resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  return { main, mime: mime === MIME.png || mime === MIME.webp ? mime : MIME.jpeg, thumb, thumbMime: MIME.webp, width: info.width, height: info.height };
}
