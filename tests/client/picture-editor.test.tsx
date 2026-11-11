// @vitest-environment jsdom
/**
 * "Use my own picture" (S24, D-184): the editor's maths, its controls and keyboard, and the screen's
 * statuses with the shared FilePick (CRD-1, STU-8, UX-1). Fictional names only; no real picture.
 */
import axe from 'axe-core';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AVATAR_PICTURE_EDGE, PENDING_MS } from '../../src/shared/avatarPictures.ts';
import type { StudentPictureInfo } from '../../src/shared/contracts/avatars.ts';
import { en } from '../../src/shared/i18n/en.ts';
import { tr } from '../../src/shared/i18n/tr.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import PictureEditor, { applyMatrix, clampState, keyMove, KEY_STEP, pictureMatrix, scaleOf, START, turned, turnedSize, ZOOM_MAX, type EditState } from '../../src/client/student/PictureEditor.tsx';
import AvatarPictureScreen from '../../src/client/student/AvatarPictureScreen.tsx';

const wrap = (node: ReactNode, locale: 'en' | 'tr' = 'en') => createElement(QueryClientProvider, { client: new QueryClient() }, createElement(I18nProvider, { locale, children: node }));

describe('editor maths', () => {
  it('a quarter turn swaps width and height; the picture always covers the square', () => {
    expect(turnedSize(800, 400, 1)).toEqual({ w: 400, h: 800 });
    expect(turnedSize(800, 400, 2)).toEqual({ w: 800, h: 400 });
    // 800×400 at zoom 1: the height fills 512, so the scale is 512/400.
    expect(scaleOf(800, 400, START)).toBeCloseTo(AVATAR_PICTURE_EDGE / 400);
    // It may move sideways by half of the extra width, never up or down.
    const moved = clampState(800, 400, { ...START, x: 10_000, y: 10_000 });
    expect(moved.x).toBeCloseTo((800 * (512 / 400) - 512) / 2);
    expect(moved.y).toBe(0);
    // Zoom, turns and brightness stay in range.
    expect(clampState(800, 400, { ...START, zoom: 9, turns: -1, brightness: 400 })).toMatchObject({ zoom: ZOOM_MAX, turns: 3, brightness: 150 });
    expect(clampState(800, 400, { ...START, zoom: 0.2, brightness: 0 })).toMatchObject({ zoom: 1, brightness: 50 });
  });

  it('arrow keys move by a step, Shift by four; other keys do nothing', () => {
    expect(keyMove('ArrowLeft', false)).toEqual({ dx: -KEY_STEP, dy: 0 });
    expect(keyMove('ArrowDown', true)).toEqual({ dx: 0, dy: 4 * KEY_STEP });
    expect(keyMove('Enter', false)).toBeNull();
  });

  // Review fix: Mirror flips left-right on the screen after a quarter turn too, and Turn right keeps
  // turning clockwise as the child sees it while mirrored.
  it('Mirror is a left-right flip on the screen whatever the turn; turns stay clockwise on screen', () => {
    // Where the source's top-middle, right-middle and centre land (unit square, no offset).
    const at = (st: EditState, x: number, y: number) => {
      const p = applyMatrix(pictureMatrix(512, 512, st, 512), x, y);
      return { x: Math.round(p.x - 256) + 0, y: Math.round(p.y - 256) + 0 };
    };
    const top = (st: EditState) => at(st, 0, -100);
    // A quarter turn right: the top goes to the right.
    expect(top({ ...START, turns: 1 })).toEqual({ x: 100, y: 0 });
    // Mirrored after the turn: the top is on the LEFT (a left-right flip), not at the bottom.
    for (const turns of [0, 1, 2, 3]) {
      const plain = top({ ...START, turns });
      const mirrored = top({ ...START, turns, mirror: true });
      expect(mirrored).toEqual({ x: 0 - plain.x, y: plain.y });
    }
    // Turn right while mirrored: what the child sees turns clockwise (screen (x, y) -> (-y, x)).
    const m: EditState = { ...START, mirror: true };
    const before = at(m, 100, 0);
    const after = at(turned(m, 1), 100, 0);
    expect(after).toEqual({ x: 0 - before.y, y: before.x });
    const left = at(turned(m, -1), 100, 0);
    expect(left).toEqual({ x: before.y, y: 0 - before.x });
    // Turning puts the picture back in the middle.
    expect(turned({ ...START, x: 40, y: 10 }, 1)).toMatchObject({ x: 0, y: 0 });
  });
});

describe('the editor', () => {
  let translates: Array<[number, number]>;
  let filters: string[];
  beforeEach(() => {
    translates = [];
    filters = [];
    const ctx = {
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      drawImage: () => {},
      setTransform: (_a: number, _b: number, _c: number, _d: number, e: number, f: number) => void translates.push([e, f]),
      set filter(v: string) {
        filters.push(v);
      },
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  const source = () => ({ width: 1024, height: 512, draw: document.createElement('canvas') });

  it('every control is labelled; arrow keys move the picture inside the circle; Start again resets', () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    const v = render(wrap(<PictureEditor source={source()} busy={false} onSend={onSend} onCancel={onCancel} />));
    const zoom = v.getByLabelText(en['avatar.picture.editor.zoom']) as HTMLInputElement;
    const bright = v.getByLabelText(en['avatar.picture.editor.brightness']) as HTMLInputElement;
    expect(zoom.type).toBe('range');
    expect(zoom.getAttribute('aria-valuetext')).toBe('100 %');
    expect(bright.value).toBe('100');
    for (const id of ['picture-turn-left', 'picture-turn-right', 'picture-mirror', 'picture-reset', 'picture-send', 'picture-choose-another']) expect(v.getByTestId(id)).toBeTruthy();
    const stage = v.getByTestId('picture-stage');
    expect(stage.getAttribute('tabindex')).toBe('0');
    expect(stage.getAttribute('aria-label')).toBe(en['avatar.picture.editor.area']);

    // Main canvas first at the centre (256, 256); ArrowRight moves the picture right by one step.
    expect(translates[0]).toEqual([256, 256]);
    translates = [];
    fireEvent.keyDown(stage, { key: 'ArrowRight' });
    expect(translates[0]).toEqual([256 + KEY_STEP, 256]);
    // Up/down does not move a picture that only just fills the height.
    translates = [];
    fireEvent.keyDown(stage, { key: 'ArrowUp' });
    expect(translates[0]).toEqual([256 + KEY_STEP, 256]);
    // The large and small previews are drawn too (144 and 72 px: centres 72 and 36).
    expect(translates.length).toBe(3);

    fireEvent.change(zoom, { target: { value: '200' } });
    expect(zoom.value).toBe('200');
    fireEvent.change(bright, { target: { value: '120' } });
    expect(filters).toContain('brightness(120%)');
    fireEvent.click(v.getByTestId('picture-mirror'));
    expect(v.getByTestId('picture-mirror').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(v.getByTestId('picture-turn-right'));
    translates = [];
    fireEvent.click(v.getByTestId('picture-reset'));
    expect(translates[0]).toEqual([256, 256]);
    expect((v.getByLabelText(en['avatar.picture.editor.zoom']) as HTMLInputElement).value).toBe('100');
    expect(v.getByTestId('picture-mirror').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(v.getByTestId('picture-choose-another'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('is in Turkish too, and has no axe violations', async () => {
    const v = render(wrap(<PictureEditor source={source()} busy={false} onSend={() => {}} onCancel={() => {}} />, 'tr'));
    expect(v.getByLabelText(tr['avatar.picture.editor.zoom'])).toBeTruthy();
    expect(v.getByTestId('picture-send').textContent).toContain(tr['avatar.picture.editor.send']);
    const r = await axe.run(v.container, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });
});

describe('the "Use my own picture" screen', () => {
  afterEach(cleanup);
  const now = Date.UTC(2026, 10, 9, 7);
  const info = (p: Partial<StudentPictureInfo>): StudentPictureInfo => ({ state: 'open', approvedUrl: null, pending: null, refused: null, ...p });

  it('open: Fine and Not allowed with icons and words, the shared FilePick and the deletion note', async () => {
    const v = render(wrap(<AvatarPictureScreen info={info({})} name="Ada Kurgu" />));
    expect(v.getByText(en['avatar.picture.fineTitle'])).toBeTruthy();
    expect(v.getByText(en['avatar.picture.notTitle'])).toBeTruthy();
    expect(v.getByText(en['avatar.picture.not.self'])).toBeTruthy();
    const input = v.container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.id).toBe('avatar-picture-file');
    expect(input.accept).toContain('image/png');
    expect(input.multiple).toBe(false);
    expect(v.getByText(en['avatar.picture.choose'])).toBeTruthy();
    expect(v.getByText(en['avatar.picture.deleteNote'])).toBeTruthy();
    const r = await axe.run(v.container, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });

  it('a file this browser cannot open says so instead of opening the editor', async () => {
    const v = render(wrap(<AvatarPictureScreen info={info({})} name="Ada Kurgu" />));
    const input = v.container.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'IMG_0001.HEIC', { type: 'image/heic' })] } });
    });
    // Not the evidence message (it points to a camera button this screen does not have).
    expect(v.getByRole('alert').textContent).toBe(en['avatar.picture.cannotOpen']);
    expect(v.queryByTestId('picture-editor')).toBeNull();
  });

  it('waiting, refused with its reason, in use, paused', () => {
    const waiting = render(wrap(<AvatarPictureScreen info={info({ pending: { sentAt: now, deleteAt: now + PENDING_MS, url: '/api/student/avatar-picture/x' } })} name="Ada Kurgu" />));
    expect(waiting.getByTestId('picture-waiting').textContent).toContain(en['avatar.picture.waiting']);
    expect(waiting.getByTestId('picture-take-back')).toBeTruthy();
    expect(waiting.container.querySelector('input[type="file"]')).toBeNull();
    fireEvent.click(waiting.getByTestId('picture-replace'));
    expect(waiting.container.querySelector('input[type="file"]')).not.toBeNull();
    cleanup();

    const refused = render(wrap(<AvatarPictureScreen info={info({ refused: { reason: 'namePlace', at: now } })} name="Ada Kurgu" />, 'tr'));
    expect(refused.getByTestId('picture-refused-reason').textContent).toBe(tr['avatar.picture.reason.namePlace']);
    expect(refused.getByText(tr['avatar.picture.deleted'])).toBeTruthy();
    expect(refused.getByTestId('picture-choose-another-after-refusal')).toBeTruthy();
    cleanup();

    const inUse = render(wrap(<AvatarPictureScreen info={info({ approvedUrl: '/api/student/avatar-picture/y' })} name="Ada Kurgu" />));
    expect(inUse.getByTestId('picture-in-use')).toBeTruthy();
    fireEvent.click(inUse.getByTestId('picture-stop-using'));
    expect(inUse.getAllByText(en['avatar.picture.stopUsing']).length).toBeGreaterThan(0);
    cleanup();

    const locked = render(wrap(<AvatarPictureScreen info={info({ state: 'locked' })} name="Ada Kurgu" />));
    expect(locked.getByTestId('picture-paused').textContent).toBe(en['avatar.picture.locked']);
    expect(locked.container.querySelector('input[type="file"]')).toBeNull();
  });
});
