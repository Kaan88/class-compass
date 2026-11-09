/**
 * Teacher class display settings (S13b item 8, D-105) and the teacher's own time's-up clip (D-107).
 * - Class display: theme (live preview of every theme), sounds on/off, volume with a try button,
 *   animations, quote of the day, time's-up announcement (voice / own clip / chime / off) with a try
 *   button. Saved at once per change (PUT /api/teacher/classes/:classId/display, audited).
 * - Time's-up clip (profile): record up to 5 s with the microphone (or choose a file), listen, save,
 *   delete. Uploaded through the file pipeline (sniffed, 2 MB).
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TIME_UP_SOUNDS, type TimeUpSound } from '../../../shared/classDisplay.ts';
import { ACCEPT_HINT, deleteTimeUpClip, uploadTimeUpClip } from '../../../shared/contracts/files.ts';
import * as School from '../../../shared/contracts/school.ts';
import type { ThemeKey } from '../../../shared/themes.ts';
import { call, upload } from '../../lib/api.ts';
import { getDisplay } from '../../lib/display.ts';
import { errorText } from '../../lib/errors.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { showToast } from '../../lib/toast.ts';
import { announceTimeUp, TIME_UP_CLIP_URL } from '../../modules/lessons/timeUp.ts';
import { playThemeSound, sounds, themeOf } from '../../themes/index.tsx';
import { Button, buttonClass } from '../../ui/Button.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { Select, Toggle } from '../../ui/Fields.tsx';
import { ThemePicker } from '../../ui/ThemePreview.tsx';

const CONTEXTS = ['classroom', 'contexts'];
const TIME_UP_KEYS = { voice: 'classDisplay.timeUp.voice', clip: 'classDisplay.timeUp.clip', chime: 'classDisplay.timeUp.chime', off: 'classDisplay.timeUp.off' } as const;

export function ClassDisplaySection({ ctx, hasClip }: { ctx: School.MyContext; hasClip: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [volume, setVolume] = useState(ctx.soundVolume);
  useEffect(() => setVolume(ctx.soundVolume), [ctx.soundVolume, ctx.classId]);
  const save = async (patch: Partial<Pick<School.ClassDisplay, 'theme' | 'soundsEnabled' | 'soundVolume' | 'animationsEnabled' | 'quoteEnabled' | 'timeUpSound'>>) => {
    try {
      await call(School.setClassDisplay, { classId: ctx.classId, ...patch });
      await qc.invalidateQueries({ queryKey: CONTEXTS });
      showToast({ message: t('save.saved'), kind: 'success' });
    } catch (err) {
      showToast({ message: errorText(t, err), kind: 'error' });
    }
  };
  // "Try" plays on this computer with the chosen settings (device sound switch still applies).
  const trial = () => ({ ...getDisplay(), theme: ctx.theme, classSounds: true, soundVolume: volume, timeUpSound: ctx.timeUpSound, timeUpClip: hasClip });
  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-class-display" data-testid="class-display">
      <h2 id="cc-class-display" className="cc-h2">
        {t('classDisplay.title')}
      </h2>
      <p className="cc-muted">{t('classDisplay.hint', { cls: ctx.className })}</p>
      <ThemePicker label={t('classDisplay.theme')} value={ctx.chosenTheme} switchedOff={ctx.chosenTheme !== ctx.theme} onChange={(theme: ThemeKey) => void save({ theme })} />
      <Toggle label={t('classDisplay.sounds')} isSelected={ctx.soundsEnabled} onChange={(v) => void save({ soundsEnabled: v })} />
      <div className="cc-row" style={{ alignItems: 'flex-end' }}>
        <label className="cc-field">
          <span className="cc-field__label">{t('classDisplay.volume', { value: volume })}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={10}
            value={volume}
            disabled={!ctx.soundsEnabled}
            className="cc-range"
            onChange={(e) => setVolume(Number(e.target.value))}
            onPointerUp={() => volume !== ctx.soundVolume && void save({ soundVolume: volume })}
            onKeyUp={() => volume !== ctx.soundVolume && void save({ soundVolume: volume })}
          />
        </label>
        <Button size="small" isDisabled={!ctx.soundsEnabled} onPress={() => playThemeSound(trial(), themeOf(ctx.theme), 'pointAwarded')}>
          {t('classDisplay.try')}
        </Button>
      </div>
      <Toggle label={t('classDisplay.animations')} isSelected={ctx.animationsEnabled} onChange={(v) => void save({ animationsEnabled: v })} />
      <Toggle label={t('classDisplay.quote')} description={t('classDisplay.quoteHint')} isSelected={ctx.quoteEnabled} onChange={(v) => void save({ quoteEnabled: v })} />
      <div className="cc-row" style={{ alignItems: 'flex-end' }}>
        <Select
          label={t('classDisplay.timeUp')}
          description={ctx.timeUpSound === 'clip' && !hasClip ? t('classDisplay.timeUp.noClip') : t('classDisplay.timeUpHint')}
          value={ctx.timeUpSound}
          onChange={(v) => void save({ timeUpSound: (TIME_UP_SOUNDS as readonly string[]).includes(v) ? (v as TimeUpSound) : 'voice' })}
          items={TIME_UP_SOUNDS.map((k) => ({ id: k, label: t(TIME_UP_KEYS[k]) }))}
        />
        <Button size="small" isDisabled={!ctx.soundsEnabled || ctx.timeUpSound === 'off'} onPress={() => void announceTimeUp(trial(), themeOf(ctx.theme))}>
          {t('classDisplay.try')}
        </Button>
      </div>
    </section>
  );
}

const MAX_RECORD_MS = 5000;

function recorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
}

/** Profile: record, preview, save or delete the teacher's own time's-up clip. */
export function TimeUpClipSection({ hasClip }: { hasClip: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const canRecord = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && recorderMime() !== undefined;
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const take = (b: Blob) => {
    setBlob(b);
    setUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(b);
    });
  };
  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = recorderMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setRecording(false);
        take(new Blob(chunks, { type: (r.mimeType || mime || 'audio/webm').split(';')[0] }));
      };
      rec.current = r;
      r.start();
      setRecording(true);
      setTimeout(() => r.state === 'recording' && r.stop(), MAX_RECORD_MS);
    } catch {
      setError(t('clip.micDenied'));
    }
  };
  const done = async (msg: string) => {
    sounds.forgetClip(TIME_UP_CLIP_URL);
    await qc.invalidateQueries({ queryKey: CONTEXTS });
    showToast({ message: msg, kind: 'success' });
  };
  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-clip-title" data-testid="time-up-clip">
      <h2 id="cc-clip-title" className="cc-h2">
        {t('clip.title')}
      </h2>
      <p className="cc-muted">{t('clip.hint')}</p>
      <p>{hasClip ? t('clip.saved') : t('clip.none')}</p>
      <div className="cc-row">
        {canRecord ? (
          recording ? (
            <Button variant="danger" onPress={() => rec.current?.stop()}>
              {t('clip.stop')}
            </Button>
          ) : (
            <Button onPress={() => void start()}>{t('clip.record')}</Button>
          )
        ) : null}
        <label className={buttonClass('secondary')}>
          {t('clip.chooseFile')}
          <input
            type="file"
            className="cc-visually-hidden"
            accept={ACCEPT_HINT.teacher_sound}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) take(f);
              e.target.value = '';
            }}
          />
        </label>
        {hasClip ? (
          <Button
            variant="danger"
            isDisabled={busy}
            onPress={async () => {
              setBusy(true);
              try {
                await call(deleteTimeUpClip, {});
                await done(t('clip.deleted'));
              } catch (err) {
                setError(errorText(t, err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('clip.delete')}
          </Button>
        ) : null}
      </div>
      {recording ? <p role="status">{t('clip.recording')}</p> : null}
      {url && blob ? (
        <div className="cc-stack">
          <audio controls src={url} aria-label={t('clip.preview')} />
          <div>
            <Button
              variant="primary"
              isDisabled={busy}
              onPress={async () => {
                setBusy(true);
                setError(null);
                try {
                  await upload(uploadTimeUpClip, {}, blob, `time-up.${blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : blob.type.includes('mpeg') ? 'mp3' : 'webm'}`);
                  setBlob(null);
                  setUrl(null);
                  await done(t('clip.savedToast'));
                } catch (err) {
                  setError(errorText(t, err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('clip.save')}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
    </section>
  );
}
