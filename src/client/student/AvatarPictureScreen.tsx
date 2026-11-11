/**
 * "Use my own picture" on the student page (S24, D-184; mockups approved 2026-11-11): a lazy chunk of
 * the student page, reached from "My avatar". What is fine and what is not (icons and words, never
 * colour alone), one big "Choose a picture" button (FilePick), the note about deletion and 14 days,
 * then the editor (its own lazy chunk) and the status: waiting for the teacher (the class keeps seeing
 * the old avatar; "Take my picture back"), the teacher's reason after "Not this one" with "Choose
 * another picture", the picture in use ("Stop using my picture"), or why sending is paused.
 */
import { lazy, Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AVATAR_PICTURE_ACCEPT } from '../../shared/avatarPictures.ts';
import { studentRemovePicture, studentUploadPicture, type StudentPictureInfo } from '../../shared/contracts/avatars.ts';
import { formatDate } from '../../shared/i18n/index.ts';
import { call, upload } from '../lib/api.ts';
import { errorText } from '../lib/errors.ts';
import { isHeic } from '../lib/images.ts';
import { showToast } from '../lib/toast.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from '../ui/Button.tsx';
import { FilePick } from '../ui/FilePick.tsx';
import { IconCheck, IconClock, IconImage, IconX } from '../ui/icons.tsx';
import { InlineConfirm } from '../ui/InlineConfirm.tsx';
import { Avatar } from '../ui/Students.tsx';
import { STUDENT_PAGE_KEY } from './keys.ts';
import type { PictureSource } from './PictureEditor.tsx';
import './avatarPicture.css';

const PictureEditor = lazy(() => import('./PictureEditor.tsx'));

const FINE = ['avatar.picture.fine.drawing', 'avatar.picture.fine.character', 'avatar.picture.fine.famous', 'avatar.picture.fine.thing'] as const;
const NOT = ['avatar.picture.not.self', 'avatar.picture.not.others', 'avatar.picture.not.names', 'avatar.picture.not.unkind'] as const;
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Opens a chosen file as something the editor can draw (null when this browser cannot decode it, e.g. HEIC outside Safari). */
async function openPicture(file: File): Promise<PictureSource | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { width: bmp.width, height: bmp.height, draw: bmp };
  } catch {
    return null;
  }
}

function Rules() {
  const { t } = useI18n();
  return (
    <div className="cc-picture-rules">
      <section className="cc-card cc-stack cc-picture-rules__list" data-kind="fine" aria-labelledby="picture-fine">
        <h2 id="picture-fine" className="cc-h2 cc-picture-rules__title">
          <IconCheck />
          {t('avatar.picture.fineTitle')}
        </h2>
        <ul className="cc-stack">
          {FINE.map((k) => (
            <li key={k} className="cc-picture-rules__item">
              <IconCheck />
              {t(k)}
            </li>
          ))}
        </ul>
      </section>
      <section className="cc-card cc-stack cc-picture-rules__list" data-kind="not" aria-labelledby="picture-not">
        <h2 id="picture-not" className="cc-h2 cc-picture-rules__title">
          <IconX />
          {t('avatar.picture.notTitle')}
        </h2>
        <ul className="cc-stack">
          {NOT.map((k) => (
            <li key={k} className="cc-picture-rules__item">
              <IconX />
              {t(k)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function AvatarPictureScreen({ info, name }: { info: StudentPictureInfo; name: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [source, setSource] = useState<PictureSource | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<'pending' | 'approved' | null>(null);
  const [picking, setPicking] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: STUDENT_PAGE_KEY });

  const remove = async (which: 'pending' | 'refused' | 'approved', message: string | null) => {
    setAsking(null);
    try {
      await call(studentRemovePicture, { which });
      if (message) showToast({ message, kind: 'success' });
      await refresh();
    } catch (e) {
      showToast({ message: errorText(t, e), kind: 'error' });
    }
  };
  const choose = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setProblem(null);
    const src = await openPicture(file);
    if (!src) {
      setProblem(isHeic(file) ? t('error.IMAGE_HEIC') : t('avatar.picture.cannotOpen'));
      return;
    }
    setSource(src);
  };
  const send = async (blob: Blob) => {
    setBusy(true);
    try {
      await upload(studentUploadPicture, {}, blob, 'picture.png');
      setSource(null);
      setPicking(false);
      showToast({ message: t('avatar.picture.sent'), kind: 'success' });
      await refresh();
    } catch (e) {
      setProblem(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  if (source)
    return (
      <div className="cc-stack" data-testid="avatar-picture-screen">
        {problem ? (
          <p className="cc-card" role="alert">
            {problem}
          </p>
        ) : null}
        <Suspense fallback={<p className="cc-muted">{t('common.loading')}</p>}>
          <PictureEditor source={source} busy={busy} onSend={(b) => void send(b)} onCancel={() => setSource(null)} />
        </Suspense>
      </div>
    );

  const canSend = info.state === 'open';
  const showPicker = canSend && (picking || (!info.pending && !info.refused));
  return (
    <div className="cc-stack" data-testid="avatar-picture-screen">
      <p>{t('avatar.picture.intro')}</p>
      {info.approvedUrl ? (
        <section className="cc-card cc-stack" data-testid="picture-in-use">
          <div className="cc-row">
            <Avatar name={name} size="lg" pictureUrl={info.approvedUrl} />
            <p>
              <IconCheck /> {t('avatar.picture.inUse')}
            </p>
          </div>
          {asking === 'approved' ? (
            <InlineConfirm
              message={t('avatar.picture.stopUsing')}
              confirmLabel={t('avatar.picture.stopUsing')}
              cancelLabel={t('common.cancel')}
              destructive
              onConfirm={() => void remove('approved', t('avatar.picture.stopped'))}
              onCancel={() => setAsking(null)}
            />
          ) : (
            <div>
              <Button onPress={() => setAsking('approved')} data-testid="picture-stop-using">
                {t('avatar.picture.stopUsing')}
              </Button>
            </div>
          )}
        </section>
      ) : null}
      {info.pending ? (
        <section className="cc-card cc-stack" aria-labelledby="picture-waiting" data-testid="picture-waiting">
          <h2 id="picture-waiting" className="cc-h2">
            <IconClock /> {t('avatar.picture.waiting')}
          </h2>
          <div className="cc-row">
            <span className="cc-avatar cc-avatar--lg cc-avatar--picture" aria-hidden="true">
              <img src={info.pending.url} alt="" />
            </span>
            <p>{t('avatar.picture.waitingBody', { date: formatDate(info.pending.deleteAt, locale, browserZone(), { day: 'numeric', month: 'long' }) })}</p>
          </div>
          {asking === 'pending' ? (
            <InlineConfirm
              message={t('avatar.picture.takeBack')}
              confirmLabel={t('avatar.picture.takeBack')}
              cancelLabel={t('common.cancel')}
              destructive
              onConfirm={() => void remove('pending', t('avatar.picture.takenBack'))}
              onCancel={() => setAsking(null)}
            />
          ) : (
            <div className="cc-row">
              <Button onPress={() => setAsking('pending')} data-testid="picture-take-back">
                {t('avatar.picture.takeBack')}
              </Button>
              {canSend && !picking ? (
                <Button onPress={() => setPicking(true)} data-testid="picture-replace">
                  {t('avatar.picture.chooseAnother')}
                </Button>
              ) : null}
            </div>
          )}
        </section>
      ) : null}
      {info.refused && !picking ? (
        <section className="cc-card cc-stack" role="status" aria-labelledby="picture-refused" data-testid="picture-refused">
          <h2 id="picture-refused" className="cc-h2">
            <IconX /> {t('avatar.picture.refusedTitle')}
          </h2>
          <p data-testid="picture-refused-reason">{t(`avatar.picture.reason.${info.refused.reason}`)}</p>
          <p>{t('avatar.picture.deleted')}</p>
          {canSend ? (
            <div>
              <Button
                variant="primary"
                onPress={() => {
                  setPicking(true);
                  void remove('refused', null);
                }}
                data-testid="picture-choose-another-after-refusal"
              >
                {t('avatar.picture.chooseAnother')}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
      {info.state === 'locked' ? (
        <p className="cc-card" role="status" data-testid="picture-paused">
          {t('avatar.picture.locked')}
        </p>
      ) : null}
      {info.state === 'classOff' || info.state === 'off' ? (
        <p className="cc-card" role="status" data-testid="picture-paused">
          {t('avatar.picture.classOff')}
        </p>
      ) : null}
      {showPicker ? (
        <>
          <Rules />
          <section className="cc-card cc-stack">
            <FilePick
              id="avatar-picture-file"
              label={t('avatar.picture.choose')}
              icon={<IconImage />}
              accept={AVATAR_PICTURE_ACCEPT}
              status={t('avatar.picture.chooseHint')}
              testId="picture-file"
              onFiles={(f) => void choose(f)}
            />
            {problem ? (
              <p role="alert" className="cc-picture-problem">
                {problem}
              </p>
            ) : null}
            <p className="cc-muted">{t('avatar.picture.deleteNote')}</p>
          </section>
        </>
      ) : null}
    </div>
  );
}
