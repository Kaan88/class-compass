/**
 * Record the student's (or teacher's) voice in the browser (MediaRecorder) for audio evidence
 * (S13b2, D-119; was student/AudioRecorder). Shown only when the admin turned `media.evidenceAudio`
 * on (D-014); the server checks the flag again on upload. At most MAX_VOICE_RECORDING_MS, with a
 * running timer; the recording can be played back, recorded again or deleted before it is added.
 * Nothing is uploaded until "Add evidence"; the microphone is released as soon as recording stops.
 */
import { useEffect, useRef, useState } from 'react';
import { MAX_VOICE_RECORDING_MS } from '../../../shared/contracts/files.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { IconMic, IconStop, IconTrash } from '../../ui/icons.tsx';

/** "m:ss" for the recording timer. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function VoiceRecorder({ value, onChange }: { value: Blob | null; onChange: (b: Blob | null) => void }) {
  const { t } = useI18n();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const supported = typeof window !== 'undefined' && 'MediaRecorder' in window && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    if (!value) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((tr) => tr.stop());
    },
    [],
  );

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };
  const start = async () => {
    setError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setRecording(false);
        onChange(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      recorder.current = rec;
      rec.start();
      started.current = Date.now();
      setElapsed(0);
      setRecording(true);
      timer.current = setInterval(() => {
        const ms = Date.now() - started.current;
        setElapsed(ms);
        if (ms >= MAX_VOICE_RECORDING_MS) stop();
      }, 250);
    } catch {
      setError(true);
    }
  };

  if (!supported) return <Alert kind="warning">{t('student.audio.unsupported')}</Alert>;
  return (
    <div className="cc-stack" data-testid="voice-recorder">
      <div className="cc-row">
        {recording ? (
          <Button variant="danger" onPress={stop}>
            <IconStop />
            {t('student.audio.stop')}
          </Button>
        ) : (
          <Button onPress={() => void start()}>
            <IconMic />
            {value ? t('student.audio.again') : t('student.audio.start')}
          </Button>
        )}
        {recording ? (
          <span role="status" className="cc-voice__timer" data-testid="voice-timer">
            {t('student.audio.recordingFor', { time: clockText(elapsed), max: clockText(MAX_VOICE_RECORDING_MS) })}
          </span>
        ) : null}
        {value && !recording ? (
          <Button variant="ghost" onPress={() => onChange(null)}>
            <IconTrash />
            {t('student.audio.discard')}
          </Button>
        ) : null}
      </div>
      {!recording && !value ? <p className="cc-muted">{t('student.audio.limit', { minutes: MAX_VOICE_RECORDING_MS / 60000 })}</p> : null}
      {preview ? <audio controls src={preview} aria-label={t('student.audio.preview')} /> : null}
      {error ? <Alert kind="warning">{t('student.audio.denied')}</Alert> : null}
    </div>
  );
}
