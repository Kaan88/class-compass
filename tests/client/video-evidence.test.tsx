// @vitest-environment jsdom
/**
 * Video evidence on the device (S27a, D-193, GOL-4, D-014): the in-page recorder's states with a fake
 * camera and a fake MediaRecorder (preview → recording with a timer → stop → watch → Record again or
 * Use this video; it stops by itself at 3:00 and releases the camera), the two video choices only
 * while the video switch is on, a chosen video checked on the device (not a video, too big), uploaded
 * as kind `video` and attached as a file item, and the player in the evidence list. Fictional data only.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_VIDEO_MS, UPLOAD_LIMITS } from '../../src/shared/contracts/files.ts';
import type { Evidence } from '../../src/shared/contracts/goals.ts';
import { ApiError, upload as apiUpload } from '../../src/client/lib/api.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { currentToasts, showToast } from '../../src/client/lib/toast.ts';
import { useRun } from '../../src/client/lib/useRun.ts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as G from '../../src/shared/contracts/goals.ts';
import { EvidenceAdder, evidenceModes, type NewEvidence, type UploadKind } from '../../src/client/modules/goals/EvidenceAdder.tsx';
import { EvidenceView } from '../../src/client/modules/goals/shared.tsx';
import VideoRecorder, { videoName } from '../../src/client/modules/goals/VideoRecorder.tsx';
import { en } from '../messages.ts';

const wrap = (node: ReactNode) => <I18nProvider locale="en">{node}</I18nProvider>;

/** A fake camera stream: tracks that remember being stopped. */
class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}
let streams: Array<{ tracks: FakeTrack[] }> = [];
const fakeStream = () => {
  const s = { tracks: [new FakeTrack(), new FakeTrack()] };
  streams.push(s);
  return { getTracks: () => s.tracks } as unknown as MediaStream;
};

/** A fake MediaRecorder: start/stop as the browser does, with one chunk of "video". */
class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = (t: string) => t === 'video/webm;codecs=vp8,opus';
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  options: MediaRecorderOptions | undefined;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.options = options;
    this.mimeType = options?.mimeType ?? 'video/webm';
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])], { type: 'video/webm' }) });
    this.onstop?.();
  }
}

let getUserMedia: ReturnType<typeof vi.fn>;
beforeEach(() => {
  streams = [];
  FakeRecorder.instances = [];
  getUserMedia = vi.fn(async () => fakeStream());
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, enumerateDevices: async () => [{ kind: 'videoinput' }] } });
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:fake-${++n}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const button = (name: string) => screen.getByRole('button', { name });

describe('the in-page video recorder (S27a, D-193)', () => {
  it('GOL-4: preview → record with a timer → stop → watch → Record again → record → Use this video; the camera is released', async () => {
    const onVideo = vi.fn();
    render(wrap(<VideoRecorder onVideo={onVideo} />));
    const recorder = screen.getByTestId('video-recorder');
    expect(recorder.getAttribute('data-phase')).toBe('starting');
    await waitFor(() => expect(recorder.getAttribute('data-phase')).toBe('ready'));
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: true, video: expect.objectContaining({ facingMode: 'user' }) }));
    expect(screen.getByText(en['evidence.video.limit'].replace('{minutes}', '3'))).toBeTruthy();

    fireEvent.click(button(en['evidence.video.start']));
    expect(recorder.getAttribute('data-phase')).toBe('recording');
    // A modest bit rate (3 minutes stay far under the upload limit) and the first supported format.
    expect(FakeRecorder.instances[0]!.options).toMatchObject({ mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 1_200_000 });
    expect(screen.getByTestId('video-timer').textContent).toContain('of 3:00');

    const liveEl = screen.getByLabelText(en['evidence.cameraView']) as HTMLVideoElement;
    expect(liveEl.srcObject).toBeTruthy();
    fireEvent.click(button(en['student.audio.stop']));
    expect(recorder.getAttribute('data-phase')).toBe('recorded');
    expect(streams[0]!.tracks.every((t) => t.stopped)).toBe(true);
    // The clip plays in its own element: no camera stream on it (it would win over src), the clip's address as src.
    const clipEl = screen.getByLabelText(en['evidence.video.preview']) as HTMLVideoElement;
    expect(clipEl.tagName).toBe('VIDEO');
    expect(clipEl).not.toBe(liveEl);
    expect(clipEl.srcObject ?? null).toBeNull();
    expect(clipEl.getAttribute('src')).toMatch(/^blob:fake-/u);
    expect(liveEl.srcObject).toBeNull();

    fireEvent.click(button(en['evidence.video.retake']));
    await waitFor(() => expect(recorder.getAttribute('data-phase')).toBe('ready'));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    fireEvent.click(button(en['evidence.video.start']));
    fireEvent.click(button(en['student.audio.stop']));
    fireEvent.click(button(en['evidence.video.use']));
    expect(onVideo).toHaveBeenCalledTimes(1);
    const [blob, name] = onVideo.mock.calls[0]! as [Blob, string];
    expect(blob.type).toBe('video/webm');
    expect(name).toBe('video.webm');
    expect(screen.getByTestId('video-recorder').getAttribute('data-phase')).toBe('idle');
    expect(streams.every((s) => s.tracks.every((t) => t.stopped))).toBe(true);
    expect(button(en['evidence.video.another'])).toBeTruthy();
  });

  it('stops by itself at 3:00 and says so', async () => {
    render(wrap(<VideoRecorder onVideo={() => undefined} />));
    await waitFor(() => expect(screen.getByTestId('video-recorder').getAttribute('data-phase')).toBe('ready'));
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    fireEvent.click(button(en['evidence.video.start']));
    act(() => {
      vi.advanceTimersByTime(MAX_VIDEO_MS / 2);
    });
    expect(screen.getByTestId('video-timer').textContent).toContain('1:30 of 3:00');
    act(() => {
      vi.advanceTimersByTime(MAX_VIDEO_MS / 2 + 500);
    });
    expect(screen.getByTestId('video-recorder').getAttribute('data-phase')).toBe('recorded');
    expect(FakeRecorder.instances[0]!.state).toBe('inactive');
    expect(screen.getByRole('status').textContent).toBe(en['evidence.video.stopped'].replace('{max}', '3:00'));
  });

  it('a refused camera shows a calm explanation instead of the recorder', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('NotAllowedError'));
    render(wrap(<VideoRecorder onVideo={() => undefined} />));
    expect(await screen.findByText(en['evidence.video.denied'])).toBeTruthy();
  });

  it('switch camera asks for the other camera when there is more than one', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, enumerateDevices: async () => [{ kind: 'videoinput' }, { kind: 'videoinput' }] } });
    render(wrap(<VideoRecorder onVideo={() => undefined} />));
    fireEvent.click(await screen.findByRole('button', { name: en['evidence.switchCamera'] }));
    await waitFor(() => expect(getUserMedia).toHaveBeenLastCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: 'environment' }) })));
    expect(streams[0]!.tracks.every((t) => t.stopped)).toBe(true);
  });

  it('names the file after its type', () => {
    expect(videoName('video/mp4')).toBe('video.mp4');
    expect(videoName('video/webm')).toBe('video.webm');
  });
});

describe('upload with progress (D-193)', () => {
  /** A fake XMLHttpRequest that reports progress and then answers. */
  class FakeXhr {
    static last: FakeXhr | null = null;
    static answer: { status: number; body: string } = { status: 200, body: '{"id":"f1"}' };
    upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    withCredentials = false;
    headers: Record<string, string> = {};
    method = '';
    url = '';
    status = 0;
    statusText = '';
    responseText = '';
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(k: string, v: string) {
      this.headers[k] = v;
    }
    send() {
      FakeXhr.last = this;
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      this.status = FakeXhr.answer.status;
      this.responseText = FakeXhr.answer.body;
      this.onload?.();
    }
  }
  beforeEach(() => {
    (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
  });

  it('reports progress, sends the CSRF header, and maps a proxy 413 (no JSON) to FILE_TOO_LARGE', async () => {
    const seen: number[] = [];
    FakeXhr.answer = { status: 200, body: '{"id":"f1","kind":"video"}' };
    const r = await apiUpload(G.studentUploadFile, { kind: 'video' }, new Blob(['v']), 'v.webm', (f) => seen.push(f));
    expect(r).toMatchObject({ id: 'f1' });
    expect(seen).toEqual([0.5]);
    expect(FakeXhr.last!.headers['x-cc-csrf']).toBe('1');
    expect(FakeXhr.last!.url).toBe('/api/student/files?kind=video');
    FakeXhr.answer = { status: 413, body: '<html>413 Request Entity Too Large</html>' };
    const err = await apiUpload(G.studentUploadFile, { kind: 'video' }, new Blob(['v']), 'v.webm', () => undefined).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).details).toMatchObject({ reason: 'FILE_TOO_LARGE' });
  });
});

describe('video choices in the evidence form (S27a, D-193)', () => {
  const media = { photos: false, audio: false, documents: true, video: true };

  it('D-014: Record a video and Add a video only while the video switch is on', () => {
    expect(evidenceModes({ ...media, video: false })).not.toContain('video');
    expect(evidenceModes(media)).toEqual(['text', 'link', 'document', 'video', 'videoFile']);
  });

  it('a chosen video goes up as kind video and is attached as a file item; a file that is not a video or is too big is explained, not sent', async () => {
    const upload = vi.fn<(k: UploadKind, f: Blob, n: string) => Promise<{ id: string }>>(async () => ({ id: 'file-v' }));
    const add = vi.fn<(i: NewEvidence) => Promise<unknown>>(async () => ({}));
    render(wrap(<EvidenceAdder idPrefix="t" goals={[]} media={media} upload={upload} add={add} run={(fn) => fn()} />));
    fireEvent.click(button(en['evidence.mode.videoFile']));
    expect(screen.getByText(en['evidence.videoHint'].replace('{minutes}', '3').replace('{mb}', '150'))).toBeTruthy();
    const input = screen.getByLabelText(en['evidence.chooseVideo']) as HTMLInputElement;
    const pick = async (f: File) => {
      await act(async () => {
        fireEvent.change(input, { target: { files: [f] } });
      });
    };
    await pick(new File(['not a video'], 'notes.txt', { type: 'text/plain' }));
    expect(screen.getByText(en['evidence.videoNotVideo'])).toBeTruthy();
    const huge = new File(['x'], 'long.mp4', { type: 'video/mp4' });
    Object.defineProperty(huge, 'size', { value: UPLOAD_LIMITS.video + 1 });
    await pick(huge);
    expect(screen.getByText(en['evidence.videoTooBig'].replace('{mb}', '150'))).toBeTruthy();
    await pick(new File([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])], 'our-play.mp4', { type: 'video/mp4' }));
    await waitFor(() => expect(screen.getByTestId('evidence-pending').textContent).toContain('our-play.mp4'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en['student.addEvidence'] }));
    });
    expect(upload).toHaveBeenCalledWith('video', expect.any(File), 'our-play.mp4', expect.any(Function));
    expect(add).toHaveBeenCalledWith({ kind: 'file', fileId: 'file-v' });
  });

  it('Record a video: the in-page recorder on a computer; on a phone the recorder too (3:00 stop, small files) with the camera app as a second choice; the camera app alone where the browser cannot record', async () => {
    const noop = async () => ({ id: 'x' });
    const { unmount } = render(wrap(<EvidenceAdder idPrefix="t" goals={[]} media={media} upload={noop} add={noop} run={(fn) => fn()} />));
    fireEvent.click(button(en['evidence.mode.video']));
    expect(await screen.findByTestId('video-recorder')).toBeTruthy();
    expect(screen.queryByLabelText(en['evidence.useCameraApp'])).toBeNull();
    unmount();
    window.matchMedia = ((q: string) => ({ matches: q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    const phone = render(wrap(<EvidenceAdder idPrefix="p" goals={[]} media={media} upload={noop} add={noop} run={(fn) => fn()} />));
    fireEvent.click(button(en['evidence.mode.video']));
    expect(await screen.findByTestId('video-recorder')).toBeTruthy();
    const input = screen.getByLabelText(en['evidence.useCameraApp']) as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('video/*');
    expect(input.getAttribute('capture')).toBe('environment');
    expect(screen.getByText(en['evidence.cameraAppBig'])).toBeTruthy();
    phone.unmount();
    delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    render(wrap(<EvidenceAdder idPrefix="q" goals={[]} media={media} upload={noop} add={noop} run={(fn) => fn()} />));
    fireEvent.click(button(en['evidence.mode.video']));
    expect(screen.getByLabelText(en['evidence.openVideoCamera']).getAttribute('capture')).toBe('environment');
    expect(screen.queryByTestId('video-recorder')).toBeNull();
  });

  it('the hint and the device check use the real limit for this student (videoMaxBytes); a full space says so', async () => {
    const MB = 1024 * 1024;
    const noop = async () => ({ id: 'x' });
    const { unmount } = render(wrap(<EvidenceAdder idPrefix="t" goals={[]} media={{ ...media, videoMaxBytes: 90 * MB }} upload={noop} add={noop} run={(fn) => fn()} />));
    fireEvent.click(button(en['evidence.mode.videoFile']));
    expect(screen.getByText(en['evidence.videoHint'].replace('{minutes}', '3').replace('{mb}', '90'))).toBeTruthy();
    const big = new File(['x'], 'trip.mp4', { type: 'video/mp4' });
    Object.defineProperty(big, 'size', { value: 95 * MB });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(en['evidence.chooseVideo']), { target: { files: [big] } });
    });
    expect(screen.getByText(en['evidence.videoTooBig'].replace('{mb}', '90'))).toBeTruthy();
    expect(screen.queryByTestId('evidence-pending')).toBeNull();
    unmount();
    render(wrap(<EvidenceAdder layout="steps" idPrefix="s" goals={[]} media={{ ...media, videoMaxBytes: 1000 }} upload={noop} add={noop} run={(fn) => fn()} />));
    fireEvent.click(button(en['evidence.mode.videoFile']));
    expect(screen.getByText(en['evidence.videoNoSpace'])).toBeTruthy();
    expect(screen.queryByLabelText(en['evidence.chooseVideo'])).toBeNull();
  });

  it('a video upload shows how far it is (role=status, a progress bar, Sending… on the button) and clears an old error toast', async () => {
    let report: ((f: number) => void) | undefined;
    let finish: (v: { id: string }) => void = () => undefined;
    const upload = vi.fn((_k: UploadKind, _f: Blob, _n: string, onProgress?: (f: number) => void) => {
      report = onProgress;
      return new Promise<{ id: string }>((r) => (finish = r));
    });
    const add = vi.fn(async () => ({}));
    showToast({ message: 'an older error', kind: 'error' });
    render(wrap(<EvidenceAdder idPrefix="t" goals={[]} media={media} upload={upload} add={add} run={(fn) => fn()} />));
    fireEvent.click(button(en['evidence.mode.videoFile']));
    await act(async () => {
      fireEvent.change(screen.getByLabelText(en['evidence.chooseVideo']), { target: { files: [new File([new Uint8Array([0, 0, 0, 24])], 'trip.mp4', { type: 'video/mp4' })] } });
    });
    await waitFor(() => expect(screen.getByTestId('evidence-pending')).toBeTruthy());
    await act(async () => {
      fireEvent.click(button(en['student.addEvidence']));
    });
    expect(currentToasts().some((x) => x.kind === 'error')).toBe(false);
    expect(screen.getByRole('button', { name: en['evidence.sending'] })).toBeTruthy();
    act(() => report!(0.47));
    const status = screen.getByTestId('evidence-progress');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toContain(en['evidence.sendingVideo'].replace('{percent}', '45'));
    expect((screen.getByLabelText(en['evidence.sendingProgress']) as HTMLProgressElement).getAttribute('value')).toBe('45');
    await act(async () => finish({ id: 'f1' }));
    await waitFor(() => expect(add).toHaveBeenCalledWith({ kind: 'file', fileId: 'f1' }));
    expect(screen.queryByTestId('evidence-progress')).toBeNull();
  });

  it('a video the server refuses for its content leaves the list; too big and a full space get child words on the student page', async () => {
    const qc = new QueryClient();
    const Harness = ({ upload }: { upload: (k: UploadKind, f: Blob, n: string) => Promise<{ id: string }> }) => {
      const run = useRun();
      return <EvidenceAdder layout="steps" idPrefix="s" goals={[]} media={media} upload={upload} add={async () => ({})} run={(fn, success) => run(fn, { success })} />;
    };
    const tryWith = async (err: ApiError) => {
      const view = render(
        <QueryClientProvider client={qc}>
          {wrap(<Harness upload={async () => Promise.reject(err)} />)}
        </QueryClientProvider>,
      );
      fireEvent.click(button(en['evidence.mode.videoFile']));
      await act(async () => {
        fireEvent.change(screen.getByLabelText(en['evidence.chooseVideo']), { target: { files: [new File([new Uint8Array([1, 2, 3, 4])], 'clip.mp4', { type: 'video/mp4' })] } });
      });
      await waitFor(() => expect(screen.getByTestId('evidence-pending')).toBeTruthy());
      await act(async () => {
        fireEvent.click(button(en['student.work.save']));
      });
      const last = currentToasts().at(-1)?.message;
      const pending = screen.queryByTestId('evidence-pending');
      view.unmount();
      return { last, pending };
    };
    const notVideo = await tryWith(new ApiError(400, 'VALIDATION', 'x', { reason: 'VIDEO_NOT_VIDEO' }));
    expect(notVideo.last).toBe(en['error.VIDEO_NOT_VIDEO']);
    expect(notVideo.pending).toBeNull();
    const tooBig = await tryWith(new ApiError(413, 'VALIDATION', 'x', { reason: 'FILE_TOO_LARGE' }));
    expect(tooBig.last).toBe(en['error.VIDEO_TOO_BIG']);
    const full = await tryWith(new ApiError(409, 'CONFLICT', 'x', { reason: 'QUOTA_STUDENT' }));
    expect(full.last).toBe(en['error.QUOTA_STUDENT_OWN']);
    expect(full.pending).not.toBeNull(); // nothing wrong with the video itself: it stays for a later try
  });

  it('the evidence list plays a video with controls and preload="metadata"', () => {
    const item: Evidence = {
      id: 'e1',
      goalId: null,
      kind: 'file',
      body: 'Our class play',
      url: null,
      file: { id: 'f1', mime: 'video/webm', size: 2048, name: 'video.webm', hasThumbnail: false },
      authorType: 'student',
      createdAt: Date.UTC(2026, 10, 12, 9),
      updatedAt: Date.UTC(2026, 10, 12, 9),
    };
    const { container } = render(
      wrap(
        <ul>
          <EvidenceView item={item} fileUrl={(id) => `/f/${id}`} />
        </ul>,
      ),
    );
    const video = screen.getByLabelText(en['goals.videoOf'].replace('{name}', 'video.webm')) as HTMLVideoElement;
    expect(video.tagName).toBe('VIDEO');
    expect(video.getAttribute('src')).toBe('/f/f1');
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.getAttribute('preload')).toBe('metadata');
    expect(container.querySelector('[data-kind="video"]')).not.toBeNull();
    expect(screen.getByText(en['goals.evidenceKind.video'])).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
