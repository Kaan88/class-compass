/**
 * Record a short audio clip in the browser (MediaRecorder) for audio evidence. Shown only when the
 * admin turned `media.evidenceAudio` on (D-014); the server checks the flag again on upload.
 * Nothing is uploaded until the student presses "Add evidence"; the microphone is released when
 * recording stops.
 */
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from '../ui/Button.tsx';
import { Alert } from '../ui/Feedback.tsx';
import { IconMic, IconStop, IconTrash } from '../ui/icons.tsx';

/** Longest recording (ms); the server's audio size limit is far above this at speech bit rates. */
export const MAX_RECORDING_MS = 3 * 60 * 1000;

export function AudioRecorder({ value, onChange }: { value: Blob | null; onChange: (b: Blob | null) => void }) {
  const { t } = useI18n();
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((tr) => tr.stop()), []);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
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
      setRecording(true);
      timer.current = setTimeout(stop, MAX_RECORDING_MS);
    } catch {
      setError(true);
    }
  };

  if (!supported) return <Alert kind="warning">{t('student.audio.unsupported')}</Alert>;
  return (
    <div className="cc-stack" data-testid="audio-recorder">
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
        {recording ? <span role="status">{t('student.audio.recording')}</span> : null}
        {value && !recording ? (
          <Button variant="ghost" onPress={() => onChange(null)}>
            <IconTrash />
            {t('student.audio.discard')}
          </Button>
        ) : null}
      </div>
      {preview ? <audio controls src={preview} aria-label={t('student.audio.preview')} /> : null}
      {error ? <Alert kind="warning">{t('student.audio.denied')}</Alert> : null}
    </div>
  );
}
