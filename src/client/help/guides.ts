/**
 * The user guides bundled into the app (docs/guides/<lang>/<id>.md and their screenshots in
 * docs/guides/img/<lang>/). Everything is part of the build: nothing is fetched from another site.
 * The Markdown is loaded on demand (one chunk per guide); images are bundled files served by this
 * server. This module is only reached through a dynamic import, so the guides never weigh on the
 * classroom bundle.
 */
import type { Locale } from '../../shared/i18n/index.ts';
import { isLocale } from '../../shared/languages.ts';

export { GUIDE_IDS, GUIDE_TITLE_KEYS, isGuideId, type GuideId } from './guideList.ts';
import type { GuideId } from './guideList.ts';

const sources = import.meta.glob<string>('../../../docs/guides/*/*.md', { query: '?raw', import: 'default' });
const images = import.meta.glob<string>('../../../docs/guides/img/*/*.png', { query: '?url', import: 'default', eager: true });

/** The Markdown of a guide, or null when it does not exist in that language. */
export async function loadGuide(id: GuideId, locale: Locale): Promise<string | null> {
  const load = sources[`../../../docs/guides/${locale}/${id}.md`];
  return load ? load() : null;
}

/**
 * The bundled URL of an image referenced from a guide (`../img/en/x.png`), or null for anything
 * else (a remote address or a missing file is never loaded).
 */
export function guideImageUrl(src: string): string | null {
  // Any ready interface language (S26c, D-191), not a hand-written list.
  const m = /^\.\.\/img\/([a-z]{2,3})\/([a-z0-9-]+\.png)$/u.exec(src);
  if (!m || !isLocale(m[1]!)) return null;
  return images[`../../../docs/guides/img/${m[1]}/${m[2]}`] ?? null;
}
