/**
 * Sound pack generator (S13b, D-110). Moved to `src/shared/themePackage/sound.ts` in S14g (D-158) so
 * the theme package validator builds and checks a package's sounds exactly like the client plays them.
 */
import type { ThemePackageSounds } from '../../shared/themePackage/schema.ts';
import { makeSoundPack, type SoundPackOptions } from '../../shared/themePackage/sound.ts';
import type { ThemeSoundPack } from '../../shared/themePackage/tokens.ts';

export { degree, makeSoundPack, soundLength, soundPackProblems, type SoundPackOptions } from '../../shared/themePackage/sound.ts';

/**
 * A theme's `sounds` and the parameters behind them (`soundParams`), so the theme can be exported as
 * a package (S14g). Spread it into a ThemeDefinition: `...themeSounds({ root: 523, wave: 'sine' })`.
 */
export function themeSounds(opts: SoundPackOptions, overrides: Partial<ThemeSoundPack> = {}): { sounds: ThemeSoundPack; soundParams: ThemePackageSounds } {
  const params = { root: opts.root, wave: opts.wave, scale: opts.scale ?? 'major', gain: opts.gain ?? 0.1, tempo: opts.tempo ?? 1 };
  const own = Object.entries(overrides).filter(([, v]) => v !== undefined);
  const ov = own.length ? { overrides: Object.fromEntries(own.map(([k, v]) => [k, v!.map((n) => ({ ...n }))])) } : {};
  return { sounds: makeSoundPack(opts, overrides), soundParams: { ...params, ...ov } };
}
