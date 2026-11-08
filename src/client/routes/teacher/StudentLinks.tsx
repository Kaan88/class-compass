/**
 * Personal student links in the teacher area (S10: STU-1..7; permanent since S13b2: D-115, D-118,
 * D-120; PIN-gated in classroom mode).
 * - Every student of the class has a permanent link (made automatically). The page shows it, copies
 *   it and prints cards with a QR code drawn on this device (no outside service). There is no routine
 *   revoke or "make new link".
 * - Cards: A4 portrait, 3 × 5 = 15 per page (about 63 × 52 mm) or "Larger" 2 × 4 = 8, dashed cut
 *   lines, QR ≥ 28 mm with a 4-module quiet zone, error correction M, always black on white; the
 *   short line on the card is in the class's student-page language. Print all, or one card.
 * - Emergency (a leaked link): revoke it, or make a new one; typed full name + reason, audited. The
 *   row then says when the link was replaced, so the teacher prints the new card.
 * - STU-7: anyone who has a student's link can see that student's page and add to it.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import * as L from '../../../shared/contracts/links.ts';
import type { StudentLinkRow } from '../../../shared/contracts/links.ts';
import * as School from '../../../shared/contracts/school.ts';
import { translate, type Locale } from '../../../shared/i18n/index.ts';
import { lowerTr, normaliseName } from '../../../shared/text/turkish.ts';
import { call } from '../../lib/api.ts';
import { errorText } from '../../lib/errors.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { showToast } from '../../lib/toast.ts';
import { whenText } from '../../modules/goals/shared.tsx';
import { Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select, TextArea, TextField } from '../../ui/Fields.tsx';
import { IconAlert, IconCopy, IconPrint, IconX } from '../../ui/icons.tsx';
import { Avatar } from '../../ui/Students.tsx';

const CONTEXTS_KEY = ['classroom', 'contexts'] as const;
const ALL = [SENSITIVE, 'teacher', 'links'] as const;

/** Smallest printed width of the QR symbol itself (without the quiet zone), in millimetres (D-120). */
export const QR_MIN_MM = 28;
export const QR_QUIET_MODULES = 4;

/** The QR matrix for a text (error correction M, smallest version that fits). */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/**
 * QR code as one crisp SVG path with a 4-module quiet zone, always black on white (print tokens).
 * `minMm` sets the printed size so the symbol itself is at least that wide.
 */
export function QrCode({ text, label, minMm }: { text: string; label: string; minMm?: number }) {
  const m = qrMatrix(text);
  const n = m.length;
  const q = QR_QUIET_MODULES;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r]![c]) d += `M${c + q} ${r + q}h1v1h-1z`;
  const size = minMm ? { width: `${((minMm * (n + 2 * q)) / n).toFixed(2)}mm`, height: `${((minMm * (n + 2 * q)) / n).toFixed(2)}mm` } : undefined;
  return (
    <svg className="cc-qr" viewBox={`0 0 ${n + 2 * q} ${n + 2 * q}`} role="img" aria-label={label} shapeRendering="crispEdges" style={size} data-modules={n}>
      <rect className="cc-qr__bg" width={n + 2 * q} height={n + 2 * q} />
      <path className="cc-qr__fg" d={d} />
    </svg>
  );
}

export type CardSize = 'small' | 'large';
export const CARDS_PER_PAGE: Record<CardSize, number> = { small: 15, large: 8 };

export interface CardData {
  id: string;
  fullName: string;
  className: string;
  url: string;
}

/** One printable card: name, class, the short line in the student-page language and the QR code. */
function LinkCard({ card, size, cardLanguage }: { card: CardData; size: CardSize; cardLanguage: Locale }) {
  const { t } = useI18n();
  return (
    <li className="cc-link-card" data-testid="link-card" data-student={card.id}>
      <strong className="cc-link-card__name">{card.fullName}</strong>
      <span className="cc-link-card__class">{card.className}</span>
      <span className="cc-link-card__note" lang={cardLanguage}>
        {translate(cardLanguage, 'links.cardScan')}
      </span>
      <QrCode text={card.url} label={t('links.qrFor', { name: card.fullName })} minMm={size === 'small' ? QR_MIN_MM : 42} />
    </li>
  );
}

/**
 * The A4 sheets (D-120): pages of 15 (or 8) cards, each page its own grid so a page break never cuts
 * a card. The print copy is hidden on screen; the preview copy is shown in the page.
 */
export function LinkCardSheets({ cards, size, cardLanguage, mode }: { cards: CardData[]; size: CardSize; cardLanguage: Locale; mode: 'print' | 'preview' }) {
  const { t } = useI18n();
  const per = CARDS_PER_PAGE[size];
  const pages: CardData[][] = [];
  for (let i = 0; i < cards.length; i += per) pages.push(cards.slice(i, i + per));
  const sheets = (
    <section className={`cc-link-sheets cc-link-sheets--${mode}`} data-size={size} aria-label={t('links.cardsPreview')} data-testid={`link-sheets-${mode}`}>
      {pages.map((page, i) => (
        <ul key={i} className="cc-link-page" data-testid="link-page">
          {page.map((c) => (
            <LinkCard key={c.id} card={c} size={size} cardLanguage={cardLanguage} />
          ))}
        </ul>
      ))}
    </section>
  );
  // The print copy lives directly in <body>, so the print style can hide everything else.
  return mode === 'print' ? createPortal(sheets, document.body) : sheets;
}

/** Print only these cards: the sheets are filled, the print dialog opens, and the page restores after printing. */
function usePrint() {
  const [only, setOnly] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (only === undefined) return;
    const done = () => setOnly(undefined);
    window.addEventListener('afterprint', done, { once: true });
    const timer = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', done);
    };
  }, [only]);
  return { printing: only, print: (studentId: string | null) => setOnly(studentId) };
}

const nameKey = (n: string) => lowerTr(normaliseName(n));

/**
 * Emergency revoke / replace (D-118) for admins and the student's current teachers: clearly an
 * emergency, the student's full name typed, a reason required. Calls the endpoint for the area.
 */
export function EmergencyLinkDialog({
  student,
  onClose,
  endpoint,
  onDone,
}: {
  student: { id: string; fullName: string; hasLink: boolean } | null;
  onClose: () => void;
  endpoint: typeof L.teacherEmergencyLink | typeof L.adminEmergencyLink;
  onDone: (state: L.StudentLinkState) => void;
}) {
  const { t } = useI18n();
  const [action, setAction] = useState<'replace' | 'revoke'>('replace');
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAction('replace');
    setTyped('');
    setReason('');
    setError(null);
  }, [student?.id]);
  if (!student) return null;
  const valid = nameKey(typed) === nameKey(student.fullName) && reason.trim().length >= 3;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call(endpoint, { studentId: student.id, action, confirmName: typed, reason: reason.trim() });
      showToast({ message: action === 'revoke' ? t('links.emergency.revokedToast', { name: student.fullName }) : t('links.emergency.replacedToast', { name: student.fullName }), kind: 'success' });
      onDone(r);
      onClose();
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen onOpenChange={(o) => !o && onClose()} title={t('links.emergency.title', { name: student.fullName })} role="alertdialog">
      <div className="cc-alert cc-alert--warning">
        <IconAlert />
        <div>{t('links.emergency.explain')}</div>
      </div>
      <Select
        label={t('links.emergency.action')}
        value={action}
        onChange={(v) => setAction(v as 'replace' | 'revoke')}
        items={[
          { id: 'replace', label: t('links.emergency.replace') },
          ...(student.hasLink ? [{ id: 'revoke', label: t('links.emergency.revoke') }] : []),
        ]}
      />
      <p className="cc-muted">{action === 'revoke' ? t('links.emergency.revokeHint') : t('links.emergency.replaceHint')}</p>
      <TextArea label={t('links.emergency.reason')} rows={2} value={reason} onChange={setReason} maxLength={500} isRequired />
      <TextField label={t('confirm.typeToConfirm', { text: student.fullName })} value={typed} onChange={setTyped} autoComplete="off" />
      {error ? (
        <p role="alert" className="cc-field__error">
          {error}
        </p>
      ) : null}
      <DialogActions>
        <Button onPress={onClose}>{t('common.cancel')}</Button>
        <Button variant="danger" isDisabled={!valid || busy} onPress={() => void submit()}>
          {action === 'revoke' ? t('links.emergency.revokeButton') : t('links.emergency.replaceButton')}
        </Button>
      </DialogActions>
    </Modal>
  );
}

export function copyLink(t: ReturnType<typeof useI18n>['t'], url: string) {
  void navigator.clipboard?.writeText(url).then(
    () => showToast({ message: t('links.copied'), kind: 'success' }),
    () => showToast({ message: t('links.copyFailed'), kind: 'error' }),
  );
}

function LinkStatusLine({ s }: { s: StudentLinkRow }) {
  const { t, locale } = useI18n();
  if (!s.link) return <span className="cc-chip" data-testid="link-status">{s.revokedAt ? t('links.revokedOn', { date: whenText(s.revokedAt, locale) }) : t('links.none')}</span>;
  return (
    <span className="cc-chip" data-testid="link-status">
      {s.link.lastUsedAt ? t('links.lastUsed', { date: whenText(s.link.lastUsedAt, locale) }) : t('links.notUsed')}
    </span>
  );
}

function ClassLinks({ classId }: { classId: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...ALL, classId], queryFn: () => call(L.classLinks, { classId }) });
  const [size, setSize] = useState<CardSize>('small');
  const [preview, setPreview] = useState(false);
  const [emergency, setEmergency] = useState<{ id: string; fullName: string; hasLink: boolean } | null>(null);
  const { printing, print } = usePrint();
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const data = q.data;
  const cards: CardData[] = data.students.flatMap((s) => (s.link?.url ? [{ id: s.id, fullName: s.fullName, className: data.className, url: s.link.url }] : []));
  const printed = printing ? cards.filter((c) => c.id === printing) : cards;
  return (
    <div className="cc-stack">
      <div className="cc-row cc-noprint">
        <Select label={t('links.cardSize')} value={size} onChange={(v) => setSize(v as CardSize)} items={[{ id: 'small', label: t('links.size.small') }, { id: 'large', label: t('links.size.large') }]} />
        <Button variant="primary" isDisabled={cards.length === 0} onPress={() => print(null)}>
          <IconPrint />
          {t('links.printAll', { count: cards.length })}
        </Button>
        <Button isDisabled={cards.length === 0} aria-pressed={preview} onPress={() => setPreview((p) => !p)}>
          {preview ? <IconX /> : <IconPrint />}
          {preview ? t('links.hidePreview') : t('links.preview')}
        </Button>
      </div>
      {data.students.length === 0 ? <p className="cc-muted">{t('links.noStudents')}</p> : null}
      <ul className="cc-stack cc-noprint" data-testid="link-list">
        {data.students.map((s) => (
          <li key={s.id} className="cc-card cc-stack" data-testid="link-row">
            <div className="cc-row">
              <Avatar name={s.fullName} id={s.id} hue={s.avatarHue} initials={s.initials} size="sm" />
              <strong>{s.fullName}</strong>
              <LinkStatusLine s={s} />
              <span className="cc-push-right cc-row">
                {s.link?.url ? (
                  <>
                    <Button size="small" onPress={() => copyLink(t, s.link!.url!)}>
                      <IconCopy />
                      {t('links.copy')}
                    </Button>
                    <Button size="small" onPress={() => print(s.id)}>
                      <IconPrint />
                      {t('links.printOne')}
                    </Button>
                  </>
                ) : null}
                <Button size="small" variant="ghost" onPress={() => setEmergency({ id: s.id, fullName: s.fullName, hasLink: Boolean(s.link) })}>
                  <IconAlert />
                  {t('links.emergency.open')}
                </Button>
              </span>
            </div>
            {s.link?.replacedAt ? <Alert kind="warning">{t('links.replacedOn', { date: whenText(s.link.replacedAt, locale) })}</Alert> : null}
          </li>
        ))}
      </ul>
      {preview ? <LinkCardSheets cards={cards} size={size} cardLanguage={data.cardLanguage} mode="preview" /> : null}
      <LinkCardSheets cards={printed} size={size} cardLanguage={data.cardLanguage} mode="print" />
      <EmergencyLinkDialog
        student={emergency}
        onClose={() => setEmergency(null)}
        endpoint={L.teacherEmergencyLink}
        onDone={() => void qc.invalidateQueries({ queryKey: ALL })}
      />
    </div>
  );
}

export function StudentLinksPage() {
  const { t } = useI18n();
  const contexts = useQuery({ queryKey: CONTEXTS_KEY, queryFn: () => call(School.myContexts, {}) });
  const classes = [...new Map((contexts.data?.contexts ?? []).map((c) => [c.classId, { id: c.classId, label: c.className }])).values()];
  const [picked, setPicked] = useState('');
  const cls = classes.find((c) => c.id === picked) ?? classes[0];
  return (
    <main className="cc-page cc-stack" data-testid="links-page">
      <h1 className="cc-h1 cc-noprint">{t('teacher.studentLinks')}</h1>
      <div className="cc-noprint cc-stack">
        <p className="cc-muted">{t('links.intro')}</p>
        <Alert kind="warning">
          <strong>{t('links.warningTitle')}</strong> {t('links.warning')}
        </Alert>
      </div>
      {contexts.isSuccess && !cls ? <EmptyState title={t('classroom.noClasses.title')} /> : null}
      {cls ? (
        <>
          <div className="cc-noprint">
            <Select label={t('links.chooseClass')} items={classes} value={cls.id} onChange={setPicked} />
          </div>
          <ClassLinks key={cls.id} classId={cls.id} />
        </>
      ) : null}
    </main>
  );
}
