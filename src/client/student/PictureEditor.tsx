/**
 * The picture editor of "Use my own picture" (S24, D-184): a lazy chunk of the student page, drawn on a
 * canvas on the device. Drag (or the arrow keys) moves the picture inside the circle, Zoom and
 * Brightness are labelled sliders, Turn left / Turn right / Mirror / Start again are buttons, and the
 * picture is previewed at the large and small card sizes. "Send to my teacher" makes ONE square
 * 512 px picture and uploads it once; the server checks and re-encodes it again.
 *
 * The maths (`clampState`, `keyMove`, `scaleOf`) is pure and unit-tested; the component only draws and listens.
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

/** Draws the edited picture into a square canvas of `size` pixels. */
export function drawInto(canvas: HTMLCanvasElement, src: PictureSource, s: EditState, size: number) {
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return;
  const f = size / AVATAR_PICTURE_EDGE;
  g.clearRect(0, 0, size, size);
  g.save();
  g.filter = s.brightness === 100 ? 'none' : `brightness(${s.brightness}%)`;
  g.translate(size / 2 + s.x * f, size / 2 + s.y * f);
  g.rotate((s.turns * Math.PI) / 2);
  if (s.mirror) g.scale(-1, 1);
  const k = scaleOf(src.width, src.height, s) * f;
  g.drawImage(src.draw, (-src.width * k) / 2, (-src.height * k) / 2, src.width * k, src.height * k);
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
              className="cc-range"
              type="range"
              min={ZOOM_MIN * 100}
              max={ZOOM_MAX * 100}
              step={5}
              value={Math.round(state.zoom * 100)}
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
              className="cc-range"
              type="range"
              min={50}
              max={150}
              step={5}
              value={state.brightness}
              onChange={(e) => update((s) => ({ ...s, brightness: Number(e.target.value) }))}
              data-testid="picture-brightness"
            />
          </div>
          <div className="cc-picture-editor__buttons">
            <Button onPress={() => update((s) => ({ ...s, turns: s.turns + 3, x: 0, y: 0 }))} data-testid="picture-turn-left">
              {t('avatar.picture.editor.turnLeft')}
            </Button>
            <Button onPress={() => update((s) => ({ ...s, turns: s.turns + 1, x: 0, y: 0 }))} data-testid="picture-turn-right">
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
