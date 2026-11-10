/**
 * Theme scene (S17a, D-166): the theme's viewport-scale artwork, fixed behind the app (or inside a
 * preview with `contained`). Decorative only: `aria-hidden`, `pointer-events: none`, below the tile
 * pattern and the ambient layer. Text never sits on it: boxes and bars keep their surfaces and
 * headings on the page get the `scene-scrim` panel (app.css, `html[data-scene]`).
 *
 * Each layer is one SVG in its own `viewBox`, placed by `fit` (cover / contain / width / height) and
 * `anchor`, at most `maxHeightVh` high. Below the phone breakpoint `smallScreens` decides: every
 * layer, only the last one as a strip at the bottom (`bottomStrip`), or none (`hidden`).
 */
import { useEffect, useSyncExternalStore, type CSSProperties } from 'react';
import { scenePreserveAspectRatio } from '../../shared/themePackage/engine.ts';
import type { ThemeKey } from '../../shared/themes.ts';
import { useTheme } from './index.tsx';
import type { ThemeDefinition, ThemeSceneLayer } from './types.ts';

/** The phone breakpoint of the app (the `max-width: 40rem` block of app.css). */
export const SMALL_SCREEN_QUERY = '(max-width: 40rem)';

function subscribeSmall(fn: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const mq = matchMedia(SMALL_SCREEN_QUERY);
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
}
const isSmall = () => typeof matchMedia === 'function' && matchMedia(SMALL_SCREEN_QUERY).matches;

/** Whether the viewport is below the phone breakpoint (re-renders when it changes). */
export function useSmallScreen(): boolean {
  return useSyncExternalStore(subscribeSmall, isSmall, () => false);
}

const STRIP_PERCENT = 24;

function ratioOf(viewBox: string): string {
  const [, , w, h] = viewBox.split(' ');
  return `${w} / ${h}`;
}

/** Where a layer box sits and how big it is (percent of the scene box, which is the viewport). */
function layerStyle(l: ThemeSceneLayer, strip: boolean): CSSProperties {
  if (strip) return { left: 0, right: 0, bottom: 0, width: '100%', height: `${Math.min(STRIP_PERCENT, l.maxHeightVh ?? STRIP_PERCENT)}%` };
  const h = l.maxHeightVh ?? 100;
  const top = l.anchor.startsWith('top');
  const bottom = l.anchor.startsWith('bottom');
  const left = l.anchor.endsWith('left');
  const right = l.anchor.endsWith('right');
  // Vertical place of a box lower than the screen; horizontal place of a box narrower than it.
  const y: CSSProperties = top ? { top: 0 } : bottom ? { bottom: 0 } : { top: `${(100 - h) / 2}%` };
  if (l.fit === 'width') return { ...(top ? { top: 0 } : bottom ? { bottom: 0 } : { top: '50%', translate: '0 -50%' }), left: 0, width: '100%', height: 'auto', aspectRatio: ratioOf(l.viewBox), maxHeight: `${h}%` };
  if (l.fit === 'height') return { ...y, ...(left ? { left: 0 } : right ? { right: 0 } : { left: '50%', translate: '-50% 0' }), height: `${h}%`, width: 'auto', aspectRatio: ratioOf(l.viewBox) };
  return { ...y, left: 0, width: '100%', height: `${h}%` };
}

/** The layers to draw on this screen size. */
export function sceneLayers(def: Pick<ThemeDefinition, 'scene'>, small: boolean): Array<{ layer: ThemeSceneLayer; strip: boolean }> {
  const scene = def.scene;
  if (!scene) return [];
  if (!small || scene.smallScreens === 'full') return scene.layers.map((layer) => ({ layer, strip: false }));
  if (scene.smallScreens === 'hidden') return [];
  const last = scene.layers[scene.layers.length - 1];
  return last ? [{ layer: last, strip: true }] : [];
}

/**
 * The scene of the active theme (or of `theme`). `contained`: inside a positioned preview box instead
 * of fixed to the viewport. `documentFlag`: mark `<html data-scene>` while it is shown, so the page
 * styles give headings a scrim (only the root layout's scene does this).
 */
export function ThemeScene({ theme, contained = false, documentFlag = false }: { theme?: ThemeKey; contained?: boolean; documentFlag?: boolean }) {
  const def = useTheme(theme);
  const small = useSmallScreen();
  const layers = sceneLayers(def, small);
  const on = layers.length > 0;
  useEffect(() => {
    if (!documentFlag || typeof document === 'undefined') return;
    const html = document.documentElement;
    if (on) html.dataset.scene = '';
    else delete html.dataset.scene;
    return () => void delete html.dataset.scene;
  }, [documentFlag, on]);
  if (!on || !def.scene) return null;
  return (
    <div className={`cc-scene${contained ? ' cc-scene--contained' : ''}`} style={{ opacity: def.scene.opacity }} aria-hidden="true" data-testid="theme-scene" data-layers={layers.length} data-strip={layers.some((l) => l.strip) ? '' : undefined}>
      {layers.map(({ layer, strip }, i) => {
        const Art = layer.Art;
        return (
          <svg
            key={`${i}-${strip ? 's' : 'l'}`}
            className="cc-scene__layer"
            viewBox={layer.viewBox}
            preserveAspectRatio={strip ? 'xMidYMax slice' : scenePreserveAspectRatio(layer.fit, layer.anchor)}
            style={layerStyle(layer, strip)}
            focusable="false"
          >
            <Art />
          </svg>
        );
      })}
    </div>
  );
}
