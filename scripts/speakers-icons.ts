/**
 * Super Speakers PWA icons (S12, D-134): renders the original SVG below to the PNGs the scorer app's
 * manifest and iOS need (192, 512, maskable 512, apple-touch-icon 180) into public/p/.
 * Run `node scripts/speakers-icons.ts` after changing the drawing; the PNGs are committed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/p');

/** A speech bubble with a star; `pad` shrinks the drawing into the maskable safe zone. */
function svg(pad: number): string {
  const s = 512;
  const inner = s - 2 * pad;
  const k = inner / 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${pad ? 0 : 96}" fill="#1f5f8b"/>
  <g transform="translate(${pad} ${pad}) scale(${k})">
    <path d="M96 120h320a40 40 0 0 1 40 40v176a40 40 0 0 1-40 40H236l-92 72v-72H96a40 40 0 0 1-40-40V160a40 40 0 0 1 40-40z" fill="#ffffff"/>
    <path d="M256 162l26 53 58 8-42 41 10 58-52-27-52 27 10-58-42-41 58-8z" fill="#f2b632" stroke="#c98a12" stroke-width="6" stroke-linejoin="round"/>
  </g>
</svg>`;
}

const jobs: Array<[string, number, number]> = [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-maskable-512.png', 512, 64],
  ['apple-touch-icon.png', 180, 40],
];
fs.mkdirSync(OUT, { recursive: true });
for (const [name, size, pad] of jobs) {
  await sharp(Buffer.from(svg(pad))).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(OUT, name));
  console.log(`wrote ${name}`);
}
