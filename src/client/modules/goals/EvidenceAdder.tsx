/**
 * Add evidence (S13b2, D-119): one shared form for the student page and the teacher Goals page.
 * Big buttons for each way: Write · Add a link · Add a picture (several) · Take a picture ·
 * Add a document (several) · Record my voice · Add a voice file. Picture and voice choices appear only
 * when the admin media flags allow them (D-014), documents only while `media.evidenceDocuments` is on;
 * the server checks every flag again.
 * Pictures are scaled down to 2048 px and re-encoded as JPEG on the device first (`lib/images.ts`).
 * A picture chosen under "Add a document" is sent as a picture, so it follows the photo flag and gets
 * the server's metadata removal. Each file becomes its own evidence item with the same caption.
 *
 * Two layouts (S14d, D-151): `form` (the teacher Goals page: everything at once) and `steps` (the
 * student's "Show my work": 1 how → 2 which goal, where "For all my learning" stands for no goal →
 * 3 the work and a few words, with sentence starters). The steps can follow the page address (`step`,
 * `onStep`); a step whose earlier choice was lost (a reload) goes back to the first step. Both use
 * the same upload pipeline. Text hints are shown when Save is pressed (`check`), never while typing.
 *
 * S20b (D-170): the teacher Goals page can control the chosen goal (`goalId`, `onGoalChange`), so
 * "Add evidence" on a goal card opens this form for that goal.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ACCEPT_HINT } from '../../../shared/contracts/files.ts';
import * as G from '../../../shared/contracts/goals.ts';
import type { EvidenceKind } from '../../../shared/contracts/goals.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { formatBytes, jpegName, looksLikeImage, prepareImage, preparePicture } from '../../lib/images.ts';
import { Button } from '../../ui/Button.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { Select, TextArea, TextField } from '../../ui/Fields.tsx';
import { IconCamera, IconFile, IconImage, IconLink, IconMic, IconNote, IconPlus, IconSound, IconTrash } from '../../ui/icons.tsx';
import { CameraCapture } from './CameraCapture.tsx';
import { FilePick } from './FilePick.tsx';
import { chosenGoalHint } from './shared.tsx';
import { VoiceRecorder } from './VoiceRecorder.tsx';

export type EvidenceMode = 'text' | 'link' | 'picture' | 'camera' | 'document' | 'voice' | 'voiceFile';
export type UploadKind = 'image' | 'document' | 'audio';
export type EvidenceMedia = { photos: boolean; audio: boolean; documents: boolean };
/** What a live hint checks: evidence words, a caption / link title, or a link's address (language check only). */
export type EvidenceHintKind = 'evidenceText' | 'linkTitle' | 'url';
export type NewEvidence = { kind: EvidenceKind; goalId?: string; body?: string; url?: string; fileId?: string };

/** Most files added in one go. */
export const MAX_FILES_AT_ONCE = 10;

/** The ways to add evidence the media flags allow, in display order. */
export function evidenceModes(media: EvidenceMedia): EvidenceMode[] {
  return [
    'text',
    'link',
    ...(media.photos ? (['picture', 'camera'] as const) : []),
    ...(media.documents ? (['document'] as const) : []),
    ...(media.audio ? (['voice', 'voiceFile'] as const) : []),
  ];
}

const MODE_ICON: Record<EvidenceMode, () => React.JSX.Element> = {
  text: IconNote,
  link: IconLink,
  picture: IconImage,
  camera: IconCamera,
  document: IconFile,
  voice: IconMic,
  voiceFile: IconSound,
};

type Pending = { key: number; blob: Blob; name: string; kind: UploadKind; preview: string | null };

/** The text check on Save: a hint to show, and whether the words may be sent anyway (a blocked word is, so it is counted). */
export type EvidenceCheck = (text: string, kind: EvidenceHintKind) => { hint?: string; send: boolean };
/** Sentence starters above the words box (student page): written evidence or a caption, for the chosen goal ('' = none). */
export type EvidenceStarters = (args: { kind: 'evidence' | 'caption'; goalId: string; value: string; onChange: (v: string) => void; target: RefObject<HTMLTextAreaElement | null> }) => ReactNode;

export function EvidenceAdder({
  goals,
  media,
  idPrefix,
  upload,
  add,
  run,
  check,
  layout = 'form',
  step: stepProp,
  onStep,
  onDone,
  starters,
  goalId: goalIdProp,
  onGoalChange,
}: {
  goals: Array<{ id: string; label: string }>;
  media: EvidenceMedia;
  idPrefix: string;
  upload: (kind: UploadKind, file: Blob, name: string) => Promise<{ id: string }>;
  add: (input: NewEvidence) => Promise<unknown>;
  /** Runs the save with the caller's toast and refresh; resolves to a falsy value on failure. */
  run: (fn: () => Promise<unknown>, success: string) => Promise<unknown>;
  /** Text hints when Save is pressed (the student page, D-123): the words or caption, and a link's address. */
  check?: EvidenceCheck;
  layout?: 'form' | 'steps';
  /** `steps` only: the current step from the page address, and how to change it. */
  step?: number;
  onStep?: (n: number, replace?: boolean) => void;
  /** `steps` only: after a save, instead of going back to step 1 (the page leaves the step entries behind). */
  onDone?: () => void;
  starters?: EvidenceStarters;
  /** `form` only: the chosen goal ('' = none) when the page controls it, and how to change it. */
  goalId?: string;
  onGoalChange?: (goalId: string) => void;
}) {
  const { t, locale } = useI18n();
  const modes = evidenceModes(media);
  const [mode, setMode] = useState<EvidenceMode>('text');
  const [localGoalId, setLocalGoalId] = useState('');
  const goalId = goalIdProp ?? localGoalId;
  const setGoalId = (id: string) => (onGoalChange ? onGoalChange(id) : setLocalGoalId(id));
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [recording, setRecording] = useState<Blob | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hints, setHints] = useState<{ body?: string; url?: string }>({});
  const words = useRef<HTMLTextAreaElement>(null);
  const nextKey = useRef(1);
  const previews = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const u of previews.current) URL.revokeObjectURL(u);
    },
    [],
  );
  const current = modes.includes(mode) ? mode : 'text';

  // ---- steps (student page): 1 how → 2 which goal (only when there are goals) → last: the work.
  const [localStep, setLocalStep] = useState(1);
  const [picked, setPicked] = useState({ mode: false, goal: false });
  const steps = layout === 'steps';
  const goalStep = goals.length > 0;
  const workStep = goalStep ? 3 : 2;
  const asked = stepProp ?? localStep;
  // A step whose earlier choice is not known here (the page was reloaded there) starts again.
  const step = !steps ? 0 : asked >= 2 && !picked.mode ? 1 : asked >= workStep && goalStep && !picked.goal ? 2 : Math.min(asked, workStep);
  const toStep = (n: number, replace = false) => (onStep ? onStep(n, replace) : setLocalStep(n));
  useEffect(() => {
    if (steps && step !== asked) toStep(step, true);
  });

  const push = (items: Array<Omit<Pending, 'key' | 'preview'>>) =>
    setPending((p) => {
      const room = Math.max(0, MAX_FILES_AT_ONCE - p.length);
      if (items.length > room) setNotice(t('evidence.tooMany', { max: MAX_FILES_AT_ONCE }));
      return [
        ...p,
        ...items.slice(0, room).map((it) => {
          const preview = it.kind === 'image' ? URL.createObjectURL(it.blob) : null;
          if (preview) previews.current.add(preview);
          return { ...it, key: nextKey.current++, preview };
        }),
      ];
    });
  const drop = (key: number) =>
    setPending((p) =>
      p.filter((it) => {
        if (it.key !== key) return true;
        if (it.preview) {
          URL.revokeObjectURL(it.preview);
          previews.current.delete(it.preview);
        }
        return false;
      }),
    );

  /** Turn chosen files into pending uploads (pictures prepared on the device first). */
  const take = async (files: File[], as: 'picture' | 'document' | 'voiceFile') => {
    setNotice(null);
    const out: Array<Omit<Pending, 'key' | 'preview'>> = [];
    for (const f of files) {
      if (as === 'voiceFile') {
        out.push({ blob: f, name: f.name || 'voice', kind: 'audio' });
        continue;
      }
      if (as === 'picture' || looksLikeImage(f)) {
        if (!media.photos) {
          setNotice(t('evidence.photosOff'));
          continue;
        }
        // HEIC is converted to JPEG where the browser can decode it; otherwise a friendly notice.
        const blob = await preparePicture(f);
        if (!blob) {
          setNotice(t('error.IMAGE_HEIC'));
          continue;
        }
        out.push({ blob, name: jpegName(f.name, 'picture'), kind: 'image' });
        continue;
      }
      out.push({ blob: f, name: f.name || 'document', kind: 'document' });
    }
    push(out);
  };

  const urlOk = !url.trim() || G.isSafeHttpUrl(url);
  const fileMode = current === 'picture' || current === 'camera' || current === 'document' || current === 'voiceFile';
  const valid =
    current === 'text' ? Boolean(body.trim()) : current === 'link' ? Boolean(url.trim()) && urlOk : current === 'voice' ? recording !== null : pending.length > 0;

  const reset = () => {
    setBody('');
    setUrl('');
    setRecording(null);
    setNotice(null);
    setHints({});
  };
  const save = async () => {
    const common = { ...(goalId ? { goalId } : {}), ...(body.trim() ? { body: body.trim() } : {}) };
    if (check) {
      const b = body.trim() ? check(body.trim(), current === 'text' ? 'evidenceText' : 'linkTitle') : undefined;
      const u = current === 'link' && url.trim() ? check(url.trim(), 'url') : undefined;
      setHints({ body: b?.hint, url: u?.hint });
      if (b && !b.send) words.current?.focus();
      if ((b && !b.send) || (u && !u.send)) return;
    }
    setBusy(true);
    try {
      const ok = await run(async () => {
        if (current === 'text') return add({ ...common, kind: 'text' });
        if (current === 'link') return add({ ...common, kind: 'link', url: url.trim() });
        if (current === 'voice') {
          const up = await upload('audio', recording!, 'recording.webm');
          return add({ ...common, kind: 'audio', fileId: up.id });
        }
        // One evidence item per file; finished items leave the list, so a failure can be retried.
        for (const it of pending) {
          const up = await upload(it.kind, it.blob, it.name);
          await add({ ...common, kind: it.kind === 'audio' ? 'audio' : 'file', fileId: up.id });
          drop(it.key);
        }
        return true;
      }, t(steps ? 'student.work.saved' : 'student.toast.evidenceAdded'));
      if (ok) {
        reset();
        if (steps) {
          setPicked({ mode: false, goal: false });
          setGoalId('');
          if (onDone) onDone();
          else toStep(1, true);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const fileInput = (as: 'picture' | 'document' | 'voiceFile', label: string, accept: string, multiple: boolean) => {
    const Icon = MODE_ICON[as];
    return (
      <FilePick
        id={`${idPrefix}-${as}`}
        label={label}
        icon={<Icon />}
        accept={accept}
        multiple={multiple}
        status={pending.length ? t('evidence.filesChosen', { count: pending.length }) : t('evidence.noFileYet')}
        onFiles={(files) => void take(files, as)}
      />
    );
  };

  const modeButtons = (legend: string) => (
    <fieldset className="cc-field">
      <legend className={steps ? 'cc-h2 cc-evidence-steps__question' : 'cc-field__label'}>{legend}</legend>
      <div className="cc-evidence-modes">
        {modes.map((m) => {
          const Icon = MODE_ICON[m];
          return (
            <Button
              key={m}
              size="big"
              variant={current === m && (!steps || picked.mode) ? 'primary' : 'secondary'}
              aria-pressed={current === m && (!steps || picked.mode)}
              className="cc-evidence-mode"
              onPress={() => {
                setMode(m);
                setNotice(null);
                setHints({});
                if (steps) {
                  setPicked((p) => ({ ...p, mode: true }));
                  toStep(2);
                }
              }}
            >
              <Icon />
              <span className="cc-evidence-mode__label">{t(`evidence.mode.${m}`)}</span>
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
  const stepCount = (n: number) => <p className="cc-student__step">{t('student.step', { n, total: workStep })}</p>;

  if (steps && step === 1)
    return (
      <div className="cc-card cc-stack cc-evidence-steps" data-testid="evidence-form" data-step="how">
        {stepCount(1)}
        {modeButtons(t('student.work.how'))}
      </div>
    );
  if (steps && step === 2 && goalStep)
    return (
      <div className="cc-card cc-stack cc-evidence-steps" data-testid="evidence-form" data-step="goal">
        {stepCount(2)}
        <fieldset className="cc-field">
          <legend className="cc-h2 cc-evidence-steps__question">{t('student.work.which')}</legend>
          <div className="cc-student-choices cc-student-choices--list">
            {[{ id: '', label: t('student.work.all') }, ...goals].map((g) => (
              <Button
                key={g.id || 'all'}
                className="cc-student-choice cc-student-choice--wide"
                variant={picked.goal && goalId === g.id ? 'primary' : 'secondary'}
                aria-pressed={picked.goal && goalId === g.id}
                onPress={() => {
                  setGoalId(g.id);
                  setPicked((p) => ({ ...p, goal: true }));
                  toStep(3);
                }}
              >
                <span className="cc-student-choice__label">{g.label}</span>
              </Button>
            ))}
          </div>
        </fieldset>
      </div>
    );

  const wordsKind = current === 'text' ? 'evidence' : 'caption';
  return (
    <div className={steps ? 'cc-card cc-stack cc-evidence-steps' : 'cc-card cc-stack'} data-testid="evidence-form" data-step={steps ? 'work' : undefined}>
      {steps ? (
        <>
          {stepCount(workStep)}
          <h2 className="cc-h2 cc-evidence-steps__question">{t(`evidence.mode.${current}`)}</h2>
          {goalStep ? <p className="cc-muted">{goalId ? t('student.forGoal', { goal: goals.find((g) => g.id === goalId)?.label ?? '' }) : t('student.work.all')}</p> : null}
        </>
      ) : (
        <>
          {modeButtons(t('student.evidenceKind'))}
          <Select label={t('student.evidenceGoal')} items={[{ id: '', label: t('student.noGoalLink') }, ...goals]} value={goalId} onChange={setGoalId} description={chosenGoalHint(goals, goalId)} descriptionWhenCut />
        </>
      )}
      {current === 'link' ? (
        <TextField
          label={t('student.linkUrl')}
          description={t('student.linkHint')}
          type="url"
          value={url}
          onChange={(v) => {
            setUrl(v);
            setHints((h) => ({ ...h, url: undefined }));
          }}
          errorMessage={urlOk ? (hints.url ?? null) : t('student.linkInvalid')}
        />
      ) : null}
      {current === 'picture' ? fileInput('picture', t('evidence.choosePictures'), `${ACCEPT_HINT.image},image/heic,image/heif,.heic,.heif`, true) : null}
      {current === 'camera' ? <CameraCapture idPrefix={idPrefix} onPhoto={(b) => void prepareImage(b).then((blob) => push([{ blob, name: 'photo.jpg', kind: 'image' }]))} /> : null}
      {current === 'document' ? fileInput('document', t('evidence.chooseDocuments'), media.photos ? `${ACCEPT_HINT.document},${ACCEPT_HINT.image}` : ACCEPT_HINT.document, true) : null}
      {current === 'document' ? <p className="cc-muted">{t('evidence.documentsHint')}</p> : null}
      {current === 'voiceFile' ? fileInput('voiceFile', t('evidence.chooseVoiceFile'), ACCEPT_HINT.audio, false) : null}
      {current === 'voice' ? <VoiceRecorder value={recording} onChange={setRecording} /> : null}
      {notice ? <Alert kind="warning">{notice}</Alert> : null}
      {fileMode && pending.length ? (
        <ul className="cc-evidence-pending" aria-label={t('evidence.ready')} data-testid="evidence-pending">
          {pending.map((it) => (
            <li key={it.key} className="cc-evidence-pending__item">
              {it.preview ? <img src={it.preview} alt={t('goals.photoOf', { name: it.name })} className="cc-evidence__thumb" /> : it.kind === 'audio' ? <IconSound /> : <IconFile />}
              <span className="cc-evidence-pending__name">{it.name}</span>
              <span className="cc-muted">{formatBytes(it.blob.size, locale)}</span>
              <Button size="small" variant="ghost" aria-label={t('evidence.remove', { name: it.name })} onPress={() => drop(it.key)}>
                <IconTrash />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {starters
        ? starters({
            kind: wordsKind,
            goalId,
            value: body,
            onChange: (v) => {
              setBody(v);
              setHints((h) => ({ ...h, body: undefined }));
            },
            target: words,
          })
        : null}
      <TextArea
        // The steps are for 7–10-year-olds: simpler words than the teacher's form (D-151).
        label={current === 'text' ? t(steps ? 'student.work.words' : 'student.evidenceWords') : t(steps ? 'student.work.caption' : 'student.evidenceCaption')}
        rows={3}
        value={body}
        onChange={(v) => {
          setBody(v);
          setHints((h) => ({ ...h, body: undefined }));
        }}
        maxLength={2000}
        errorMessage={hints.body}
        inputRef={words}
      />
      <div>
        <Button variant="primary" size={steps ? 'big' : 'md'} isDisabled={!valid || busy} onPress={() => void save()}>
          <IconPlus />
          {fileMode && pending.length > 1 ? t('evidence.addMany', { count: pending.length }) : steps ? t('student.work.save') : t('student.addEvidence')}
        </Button>
      </div>
    </div>
  );
}
