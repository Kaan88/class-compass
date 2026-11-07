/**
 * Personal student links in the teacher area (S10: STU-1..7; PIN-gated in classroom mode).
 * - Per class: who has a link, when it was made and last used; make, make again (the old link stops
 *   working at once) or revoke, for one student or the whole class.
 * - A new link is shown ONCE (only its hash is stored): print the cards (QR made locally on this
 *   device, no outside service) or copy the address now; to print again, make new links.
 * - STU-7: anyone who has a student's link can see that student's page and add to it.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import * as L from '../../../shared/contracts/links.ts';
import type { NewLink } from '../../../shared/contracts/links.ts';
import * as School from '../../../shared/contracts/school.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { showToast } from '../../lib/toast.ts';
import { useRun } from '../../lib/useRun.ts';
import { whenText } from '../../modules/goals/shared.tsx';
import { Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select } from '../../ui/Fields.tsx';
import { IconCopy, IconKey, IconPrint, IconUserOff, IconX } from '../../ui/icons.tsx';
import { Avatar } from '../../ui/Students.tsx';

const CONTEXTS_KEY = ['classroom', 'contexts'] as const;
const ALL = [SENSITIVE, 'teacher', 'links'] as const;

/** QR code drawn as one SVG path from the local generator (error correction M). */
export function QrCode({ text, label }: { text: string; label: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  return (
    <svg className="cc-qr" viewBox={`0 0 ${n + 8} ${n + 8}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect className="cc-qr__bg" width={n + 8} height={n + 8} />
      <path className="cc-qr__fg" d={d} />
    </svg>
  );
}

function Cards({ links, className, onClose }: { links: NewLink[]; className: string; onClose: () => void }) {
  const { t } = useI18n();
  const copy = (url: string) =>
    void navigator.clipboard?.writeText(url).then(
      () => showToast({ message: t('links.copied'), kind: 'success' }),
      () => showToast({ message: t('links.copyFailed'), kind: 'error' }),
    );
  return (
    <section className="cc-stack cc-print-sheet" aria-labelledby="links-cards" data-testid="link-cards">
      <div className="cc-row cc-noprint">
        <h2 id="links-cards" className="cc-h2">
          {t('links.newLinks', { count: links.length })}
        </h2>
        <Button variant="primary" onPress={() => window.print()}>
          <IconPrint />
          {t('links.print')}
        </Button>
        <Button onPress={onClose}>
          <IconX />
          {t('links.hideCards')}
        </Button>
      </div>
      <Alert kind="warning">{t('links.shownOnce')}</Alert>
      <ul className="cc-link-cards">
        {links.map((l) => (
          <li key={l.studentId} className="cc-link-card" data-testid="link-card">
            <strong className="cc-link-card__name">{l.fullName}</strong>
            <span className="cc-muted">{className}</span>
            <QrCode text={l.url} label={t('links.qrFor', { name: l.fullName })} />
            <code className="cc-link-card__url">{l.url}</code>
            <p className="cc-link-card__note">{t('links.cardNote')}</p>
            <Button size="small" className="cc-noprint" onPress={() => copy(l.url)}>
              <IconCopy />
              {t('links.copy')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Confirm = { kind: 'regenerate'; studentId: string; name: string } | { kind: 'revoke'; studentId: string; name: string } | { kind: 'allAgain' } | { kind: 'revokeAll' };

function ClassLinks({ classId }: { classId: string }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const q = useQuery({ queryKey: [...ALL, classId], queryFn: () => call(L.classLinks, { classId }) });
  const [fresh, setFresh] = useState<NewLink[]>([]);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const data = q.data;
  const opts = { invalidate: [ALL] };
  const add = (links: NewLink[]) => setFresh((prev) => [...prev.filter((p) => !links.some((l) => l.studentId === p.studentId)), ...links]);
  const one = (studentId: string) => void run(() => call(L.generateStudentLink, { studentId }), opts).then((r) => r && add([r]));
  const doConfirm = async () => {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    if (c.kind === 'regenerate') one(c.studentId);
    if (c.kind === 'revoke') {
      await run(() => call(L.revokeStudentLink, { studentId: c.studentId }), { ...opts, success: t('links.revoked') });
      setFresh((prev) => prev.filter((p) => p.studentId !== c.studentId));
    }
    if (c.kind === 'allAgain') {
      const r = await run(() => call(L.generateClassLinks, { classId, scope: 'all' }), opts);
      if (r) setFresh(r.links);
    }
    if (c.kind === 'revokeAll') {
      const r = await run(() => call(L.revokeClassLinks, { classId }), opts);
      if (r) {
        setFresh([]);
        showToast({ message: t('links.revokedCount', { count: r.revoked }), kind: 'success' });
      }
    }
  };
  const missing = data.students.filter((s) => !s.link).length;
  return (
    <div className="cc-stack">
      {data.archived ? <Alert kind="warning">{t('links.archived')}</Alert> : null}
      <div className="cc-row cc-noprint">
        <Button variant="primary" isDisabled={data.archived || missing === 0} onPress={() => void run(() => call(L.generateClassLinks, { classId, scope: 'missing' }), opts).then((r) => r && add(r.links))}>
          <IconKey />
          {t('links.makeMissing', { count: missing })}
        </Button>
        <Button isDisabled={data.archived || data.students.length === 0} onPress={() => setConfirm({ kind: 'allAgain' })}>
          {t('links.makeAllAgain')}
        </Button>
        <Button variant="danger" isDisabled={data.students.every((s) => !s.link)} onPress={() => setConfirm({ kind: 'revokeAll' })}>
          <IconUserOff />
          {t('links.revokeAll')}
        </Button>
      </div>
      {fresh.length ? <Cards links={fresh} className={data.className} onClose={() => setFresh([])} /> : null}
      {data.students.length === 0 ? <p className="cc-muted">{t('links.noStudents')}</p> : null}
      <ul className="cc-stack cc-noprint" data-testid="link-list">
        {data.students.map((s) => (
          <li key={s.id} className="cc-card cc-row" data-testid="link-row">
            <Avatar name={s.fullName} id={s.id} hue={s.avatarHue} initials={s.initials} size="sm" />
            <strong>{s.fullName}</strong>
            {s.link ? (
              <span className="cc-chip">
                {s.link.lastUsedAt ? t('links.lastUsed', { date: whenText(s.link.lastUsedAt, locale) }) : t('links.notUsed')} · {t('links.madeOn', { date: whenText(s.link.createdAt, locale) })}
              </span>
            ) : (
              <span className="cc-chip">{t('links.none')}</span>
            )}
            <span className="cc-push-right cc-row">
              <Button size="small" isDisabled={data.archived} onPress={() => (s.link ? setConfirm({ kind: 'regenerate', studentId: s.id, name: s.fullName }) : one(s.id))}>
                <IconKey />
                {s.link ? t('links.makeAgain') : t('links.make')}
              </Button>
              {s.link ? (
                <Button size="small" variant="ghost" onPress={() => setConfirm({ kind: 'revoke', studentId: s.id, name: s.fullName })}>
                  {t('links.revoke')}
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <Modal isOpen={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)} title={t('links.confirmTitle')} role="alertdialog">
        <p>
          {confirm?.kind === 'regenerate'
            ? t('links.confirmRegenerate', { name: confirm.name })
            : confirm?.kind === 'revoke'
              ? t('links.confirmRevoke', { name: confirm.name })
              : confirm?.kind === 'allAgain'
                ? t('links.confirmAllAgain', { className: data.className })
                : t('links.confirmRevokeAll', { className: data.className })}
        </p>
        <DialogActions>
          <Button onPress={() => setConfirm(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" onPress={() => void doConfirm()}>
            {t('links.confirm')}
          </Button>
        </DialogActions>
      </Modal>
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
