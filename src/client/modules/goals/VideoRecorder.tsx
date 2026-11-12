/**
 * "Record a video" in the page (S27a, D-193), for classroom laptops and desktops with a webcam (a
 * phone or tablet opens its own camera app instead, through the capture input in `EvidenceAdder`).
 * Loaded lazily, so the student page does not download it until a student chooses it (budget D-151).
 *
 * Live preview → Start recording → a visible timer counting to 3:00 that stops by itself → watch it
 * back → Record again or Use this video. Switch camera when the device has more than one. The camera
 * and the microphone are released as soon as the recording stops, after "Use this video" and when
 * the panel closes. Nothing is uploaded here: the video joins the evidence form's list and is sent
 * when the student saves. The recording dot pulses only without reduced motion (app.css).
 * Shown only while the admin turned `media.evidenceVideo` on; the server checks it again.
 */
import { useEffect, useRef, useState } from 'react';
import { MAX_VIDEO_MS } from '../../../shared/contracts/files.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { IconCheck, IconStop, IconSwap, IconUndo, IconVideo } from '../../ui/icons.tsx';
import { clockText } from './VoiceRecorder.tsx';

/** Recording formats in order of preference; the browser's default when none is supported. */
const TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
/** About 9 MB a minute: three minutes stay far below the 150 MB upload limit. */
const VIDEO_BITS = 1_200_000;
const AUDIO_BITS = 64_000;

export type RecorderPhase = 'starting' | 'ready' | 'recording' | 'recorded' | 'idle' | 'denied';

/** Can this browser record video in the page at all? */
export function canRecordVideo(): boolean {
  return typeof window !== 'undefined' && 'MediaRecorder' in window && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

function recorderOptions(): MediaRecorderOptions {
  const supported = typeof MediaRecorder.isTypeSupported === 'function' ? TYPES.find((t) => MediaRecorder.isTypeSupported(t)) : undefined;
  return { ...(supported ? { mimeType: supported } : {}), videoBitsPerSecond: VIDEO_BITS, audioBitsPerSecond: AUDIO_BITS };
}

/** A file name for the recording from its type (`video.webm`, `video.mp4`). */
export const videoName = (type: string) => (type.includes('mp4') ? 'video.mp4' : 'video.webm');

export default function VideoRecorder({ onVideo }: { onVideo: (video: Blob, name: string) => void }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<RecorderPhase>('starting');
  const [facing, setFacing] = useState<'environment' | 'user'>('user');
  const [cameras, setCameras] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [autoStopped, setAutoStopped] = useState(false);
  const [clip, setClip] = useState<Blob | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const live = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  const release = () => {
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
  };
  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
      if (recorder.current?.state === 'recording') recorder.current.stop();
      release();
    };
  }, []);

  // The camera runs only while the preview is shown (starting → ready).
  useEffect(() => {
    if (phase !== 'starting') return;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        stream.current = s;
        if (live.current) {
          live.current.srcObject = s;
          await live.current.play().catch(() => undefined);
        }
        if (cancelled) return;
        setPhase('ready');
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (!cancelled) setCameras(devices.filter((d) => d.kind === 'videoinput').length);
      })
      .catch(() => !cancelled && setPhase('denied'));
    return () => {
      cancelled = true;
    };
  }, [phase, facing]);

  useEffect(() => {
    if (!clip) {
      setClipUrl(null);
      return;
    }
    const url = URL.createObjectURL(clip);
    setClipUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [clip]);

  const stop = (auto = false) => {
    clearTimer();
    setAutoStopped(auto);
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };
  const start = () => {
    const s = stream.current;
    if (!s) return;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(s, recorderOptions());
    } catch {
      rec = new MediaRecorder(s);
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      release();
      if (!mounted.current) return;
      const type = rec.mimeType || chunks[0]?.type || 'video/webm';
      setClip(new Blob(chunks, { type: type.split(';')[0] }));
      setPhase('recorded');
    };
    recorder.current = rec;
    rec.start(1000);
    const began = Date.now();
    setElapsed(0);
    setAutoStopped(false);
    setPhase('recording');
    timer.current = setInterval(() => {
      const ms = Math.min(MAX_VIDEO_MS, Date.now() - began);
      setElapsed(ms);
      if (ms >= MAX_VIDEO_MS) stop(true);
    }, 250);
  };
  const again = () => {
    setClip(null);
    setPhase('starting');
  };
  const use = () => {
    if (!clip) return;
    onVideo(clip, videoName(clip.type));
    setClip(null);
    setPhase('idle');
  };

  if (phase === 'denied') return <Alert kind="warning">{t('evidence.video.denied')}</Alert>;
  if (phase === 'idle')
    return (
      <div className="cc-row" data-testid="video-recorder" data-phase="idle">
        <Button onPress={again}>
          <IconVideo />
          {t('evidence.video.another')}
        </Button>
      </div>
    );
  const recording = phase === 'recording';
  return (
    <div className="cc-stack cc-camera cc-video-recorder" data-testid="video-recorder" data-phase={phase}>
      {phase === 'recorded' && clip && clipUrl ? (
        <video className="cc-camera__view" src={clipUrl} controls playsInline preload="metadata" aria-label={t('evidence.video.preview')} />
      ) : (
        <video ref={live} className="cc-camera__view" playsInline muted aria-label={t('evidence.cameraView')} />
      )}
      {recording ? (
        <p className="cc-video-recorder__timer" data-testid="video-timer" role="timer">
          <span className="cc-video-recorder__dot" aria-hidden="true" />
          {t('evidence.video.recordingFor', { time: clockText(elapsed), max: clockText(MAX_VIDEO_MS) })}
        </p>
      ) : null}
      {phase === 'recorded' && autoStopped ? <p role="status">{t('evidence.video.stopped', { max: clockText(MAX_VIDEO_MS) })}</p> : null}
      {phase === 'starting' || phase === 'ready' ? <p className="cc-muted">{t('evidence.video.limit', { minutes: MAX_VIDEO_MS / 60000 })}</p> : null}
      <div className="cc-row">
        {phase === 'recorded' ? (
          <>
            <Button variant="primary" onPress={use}>
              <IconCheck />
              {t('evidence.video.use')}
            </Button>
            <Button onPress={again}>
              <IconUndo />
              {t('evidence.video.retake')}
            </Button>
          </>
        ) : recording ? (
          <Button variant="danger" onPress={() => stop()}>
            <IconStop />
            {t('student.audio.stop')}
          </Button>
        ) : (
          <>
            <Button variant="primary" isDisabled={phase !== 'ready'} onPress={start}>
              <IconVideo />
              {t('evidence.video.start')}
            </Button>
            {cameras > 1 ? (
              <Button
                isDisabled={phase !== 'ready'}
                onPress={() => {
                  release();
                  setFacing((f) => (f === 'environment' ? 'user' : 'environment'));
                  setPhase('starting');
                }}
              >
                <IconSwap />
                {t('evidence.switchCamera')}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
