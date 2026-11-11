/**
 * The picture editor of "Use my own picture" (S24, D-184): a lazy chunk of the student page, drawn on a
 * canvas on the device. Drag (or the arrow keys) moves the picture inside the circle, Zoom and
 * Brightness are labelled sliders, Turn left / Turn right / Mirror / Start again are buttons, and the
 * picture is previewed at the large and small card sizes. "Send to my teacher" makes ONE square
 * 512 px picture and uploads it once; the server checks and re-encodes it again.
 *
 * The maths (`clampState`, `keyMove`, `scaleOf`, `pictureMatrix`, `turned`) is pure and unit-tested; the component only draws and listens.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { AVATAR_PICTURE_EDGE } from '../../shared/avatarPictures.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from '../ui/Button.tsx';
import { IconUndo, IconUpload } from '../ui/icons.tsx';

export interface EditState {
  /** 1 = the picture just covers the circle; up to 4. */
  zoom: number;
  /** Offset of the picture's centre from the circle's centre, in output pixels (512 per side). */
  x: number;
  y: number;
  /** Quarter turns clockwise (0–3). */
  turns: number;
  mirror: boolean;
  /** Percent, 50–150. */
  brightness: number;
}

export const START: EditState = { zoom: 1, x: 0, y: 0, turns: 0, mirror: false, brightness: 100 };
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const KEY_STEP = 16;

/** The picture's size once turned (a quarter turn swaps width and height). */
export const turnedSize = (w: number, h: number, turns: number) => (turns % 2 === 1 ? { w: h, h: w } : { w, h });

/** Scale from source pixels to output pixels: the turned picture covers the square, times the zoom. */
export const scaleOf = (w: number, h: number, s: EditState, edge = AVATAR_PICTURE_EDGE) => {
  const t = turnedSize(w, h, s.turns);
  return Math.max(edge / t.w, edge / t.h) * s.zoom;
};

/** Keep the picture covering the whole square: the offset may not show an empty edge. */
export function clampState(w: number, h: number, s: EditState, edge = AVATAR_PICTURE_EDGE): EditState {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s.zoom));
  const next = { ...s, zoom, turns: ((s.turns % 4) + 4) % 4 };
  const k = scaleOf(w, h, next, edge);
  const t = turnedSize(w, h, next.turns);
  const maxX = Math.max(0, (t.w * k - edge) / 2);
  const maxY = Math.max(0, (t.h * k - edge) / 2);
  return { ...next, x: Math.min(maxX, Math.max(-maxX, s.x)), y: Math.min(maxY, Math.max(-maxY, s.y)), brightness: Math.min(150, Math.max(50, s.brightness)) };
}

/** Arrow keys move the picture (Shift: four times as far). Returns null for other keys. */
export function keyMove(key: string, shift: boolean): { dx: number; dy: number } | null {
  const d = shift ? KEY_STEP * 4 : KEY_STEP;
  if (key === 'ArrowLeft') return { dx: -d, dy: 0 };
  if (key === 'ArrowRight') return { dx: d, dy: 0 };
  if (key === 'ArrowUp') return { dx: 0, dy: -d };
  if (key === 'ArrowDown') return { dx: 0, dy: d };
  return null;
}

export type PictureSource = { width: number; height: number; draw: CanvasImageSource };

/** A 2D affine matrix as the canvas takes it: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * Where a point of the source picture (relative to its centre, in source pixels) lands on a square
 * canvas of `size` pixels: scale, then turn, then mirror ON THE SCREEN (left-right whatever the turn),
 * then move. Mirroring after the turn keeps Mirror a left-right flip after a quarter turn.
 */
export function pictureMatrix(w: number, h: number, s: EditState, size: number): Matrix {
  const f = size / AVATAR_PICTURE_EDGE;
  const k = scaleOf(w, h, s) * f;
  const q = ((s.turns % 4) + 4) % 4;
  // Exact quarter turns (no rounding noise): cos and sin of q × 90°.
  const cos = [1, 0, -1, 0][q]!;
  const sin = [0, 1, 0, -1][q]!;
  const m = s.mirror ? -1 : 1;
  return { a: m * k * cos, b: k * sin, c: -m * k * sin, d: k * cos, e: size / 2 + s.x * f, f: size / 2 + s.y * f };
}

/** Where a source point (relative to the picture's centre) lands on the canvas. */
export const applyMatrix = (M: Matrix, x: number, y: number) => ({ x: M.a * x + M.c * y + M.e, y: M.b * x + M.d * y + M.f });

/** Turn right (1) or left (-1) as the child sees it: a mirrored picture turns the other way in source terms. */
export const turned = (s: EditState, dir: 1 | -1): EditState => ({ ...s, turns: s.turns + (s.mirror ? -dir : dir) + 4, x: 0, y: 0 });

/** Draws the edited picture into a square canvas of `size` pixels. */
export function drawInto(canvas: HTMLCanvasElement, src: PictureSource, s: EditState, size: number) {
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, size, size);
  g.save();
  g.filter = s.brightness === 100 ? 'none' : `brightness(${s.brightness}%)`;
  const M = pictureMatrix(src.width, src.height, s, size);
  g.setTransform(M.a, M.b, M.c, M.d, M.e, M.f);
  g.drawImage(src.draw, -src.width / 2, -src.height / 2, src.width, src.height);
  g.restore();
}

export default function PictureEditor({ source, busy, onSend, onCancel }: { source: PictureSource; busy: boolean; onSend: (blob: Blob) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const id = useId();
  const [state, setState] = useState<EditState>(START);
  const main = useRef<HTMLCanvasElement>(null);
  const large = useRef<HTMLCanvasElement>(null);
  const small = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; px: number } | null>(null);
  const update = useCallback((f: (s: EditState) => EditState) => setState((s) => clampState(source.width, source.height, f(s))), [source]);

  useEffect(() => {
    if (main.current) drawInto(main.current, source, state, AVATAR_PICTURE_EDGE);
    if (large.current) drawInto(large.current, source, state, 144);
    if (small.current) drawInto(small.current, source, state, 72);
  }, [source, state]);

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    drag.current = { x: e.clientX, y: e.clientY, px: AVATAR_PICTURE_EDGE / Math.max(1, box.width) };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) * d.px;
    const dy = (e.clientY - d.y) * d.px;
    drag.current = { ...d, x: e.clientX, y: e.clientY };
    update((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const m = keyMove(e.key, e.shiftKey);
    if (!m) return;
    e.preventDefault();
    update((s) => ({ ...s, x: s.x + m.dx, y: s.y + m.dy }));
  };
  const send = () => {
    const c = document.createElement('canvas');
    drawInto(c, source, state, AVATAR_PICTURE_EDGE);
    c.toBlob((b) => b && onSend(b), 'image/png');
  };

  return (
    <section className="cc-card cc-stack cc-picture-editor" aria-labelledby={`${id}-title`} data-testid="picture-editor">
      <h2 id={`${id}-title`} className="cc-h2">
        {t('avatar.picture.editor.title')}
      </h2>
      <p id={`${id}-help`} className="cc-muted">
        {t('avatar.picture.editor.help')}
      </p>
      <div className="cc-picture-editor__layout">
        <div
          className="cc-picture-editor__stage"
          tabIndex={0}
          role="group"
          aria-label={t('avatar.picture.editor.area')}
          aria-describedby={`${id}-help`}
          onKeyDown={onKeyDown}
          data-testid="picture-stage"
        >
          <canvas
            ref={main}
            className="cc-picture-editor__canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-hidden="true"
          />
        </div>
        <div className="cc-stack cc-picture-editor__controls">
          <div className="cc-field">
            <label htmlFor={`${id}-zoom`} className="cc-field__label">
              {t('avatar.picture.editor.zoom')}
            </label>
            <input
              id={`${id}-zoom`}
              className="cc-range cc-picture-editor__range"
              type="range"
              min={ZOOM_MIN * 100}
              max={ZOOM_MAX * 100}
              step={5}
              value={Math.round(state.zoom * 100)}
              aria-valuetext={`${Math.round(state.zoom * 100)} %`}
              onChange={(e) => update((s) => ({ ...s, zoom: Number(e.target.value) / 100 }))}
              data-testid="picture-zoom"
            />
          </div>
          <div className="cc-field">
            <label htmlFor={`${id}-bright`} className="cc-field__label">
              {t('avatar.picture.editor.brightness')}
            </label>
            <input
              id={`${id}-bright`}
              className="cc-range cc-picture-editor__range"
              type="range"
              min={50}
              max={150}
              step={5}
              value={state.brightness}
              aria-valuetext={`${state.brightness} %`}
              onChange={(e) => update((s) => ({ ...s, brightness: Number(e.target.value) }))}
              data-testid="picture-brightness"
            />
          </div>
          <div className="cc-picture-editor__buttons">
            <Button onPress={() => update((s) => turned(s, -1))} data-testid="picture-turn-left">
              {t('avatar.picture.editor.turnLeft')}
            </Button>
            <Button onPress={() => update((s) => turned(s, 1))} data-testid="picture-turn-right">
              {t('avatar.picture.editor.turnRight')}
            </Button>
            <Button aria-pressed={state.mirror} onPress={() => update((s) => ({ ...s, mirror: !s.mirror, x: -s.x }))} data-testid="picture-mirror">
              {t('avatar.picture.editor.mirror')}
            </Button>
            <Button onPress={() => setState(START)} data-testid="picture-reset">
              <IconUndo />
              {t('avatar.picture.editor.reset')}
            </Button>
          </div>
        </div>
      </div>
      <div className="cc-stack">
        <h3 className="cc-h3">{t('avatar.picture.editor.preview')}</h3>
        <div className="cc-picture-editor__previews">
          <figure className="cc-picture-editor__preview">
            <span className="cc-avatar cc-avatar--lg cc-avatar--picture">
              <canvas ref={large} aria-hidden="true" />
            </span>
            <figcaption className="cc-muted">{t('avatar.picture.editor.previewLarge')}</figcaption>
          </figure>
          <figure className="cc-picture-editor__preview">
            <span className="cc-avatar cc-avatar--sm cc-avatar--picture">
              <canvas ref={small} aria-hidden="true" />
            </span>
            <figcaption className="cc-muted">{t('avatar.picture.editor.previewSmall')}</figcaption>
          </figure>
        </div>
      </div>
      <div className="cc-row">
        <Button onPress={onCancel} data-testid="picture-choose-another">
          {t('avatar.picture.chooseAnother')}
        </Button>
        <Button variant="primary" className="cc-push-right" isDisabled={busy} onPress={send} data-testid="picture-send">
          <IconUpload />
          {busy ? t('avatar.picture.editor.sending') : t('avatar.picture.editor.send')}
        </Button>
      </div>
    </section>
  );
}
