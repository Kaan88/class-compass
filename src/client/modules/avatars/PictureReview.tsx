/**
 * Checking students' own avatar pictures (S24, D-184; mockups approved 2026-11-11), shared by the
 * teacher's "Avatar pictures" page and the administrator's section on Modules → Photos and media.
 *
 * "To check": the picture, the student, the class, when it was sent and, close to the 14 days, when it
 * is deleted; "Yes, use it" stays disabled until the teacher ticks "Not a photo of the student or anyone
 * they know …" (the server refuses without it too); "Not this one" asks for the reason the student sees,
 * then deletes the picture. "In use": the approved pictures with Remove (deleted at once).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import '../../../shared/i18n/areas/avatarPictures.ts';
import { daysLeft, EXPIRY_WARNING_DAYS, REFUSAL_REASONS, type RefusalReason } from '../../../shared/avatarPictures.ts';
import * as Av from '../../../shared/contracts/avatars.ts';
import { formatDate } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { useRun } from '../../lib/useRun.ts';
import { AVATARS_KEY } from '../../avatars/AvatarDirectory.tsx';
import { Button } from '../../ui/Button.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { IconCheck, IconClock, IconTrash, IconX } from '../../ui/icons.tsx';
import { InlineConfirm } from '../../ui/InlineConfirm.tsx';
import { StudentName } from '../../ui/StudentName.tsx';
import { Tabs } from '../../ui/Tabs.tsx';
import './avatarPictures.css';

export type ReviewScope = 'teacher' | 'admin';
export const picturesKey = (scope: ReviewScope) => [SENSITIVE, scope, 'avatarPictures'] as const;
export const PICTURE_COUNT_KEY = [SENSITIVE, 'teacher', 'avatarPictures', 'count'] as const;

const EP = {
  teacher: { list: Av.teacherPictures, approve: Av.teacherApprovePicture, refuse: Av.teacherRefusePicture, remove: Av.teacherRemovePicture },
  admin: { list: Av.adminPictures, approve: Av.adminApprovePicture, refuse: Av.adminRefusePicture, remove: Av.adminRemovePicture },
} as const;

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function useWhen() {
  const { locale } = useI18n();
  return (ms: number) => formatDate(ms, locale, browserZone(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function Who({ item, scope }: { item: Av.PictureListItem; scope: ReviewScope }) {
  return (
    <div className="cc-stack cc-picture-review__who">
      <strong>{scope === 'teacher' ? <StudentName id={item.studentId} name={item.studentName} classId={item.classId} /> : item.studentName}</strong>
      <span className="cc-muted">{item.className}</span>
    </div>
  );
}

function ToCheck({ item, scope, invalidate }: { item: Av.PictureListItem; scope: ReviewScope; invalidate: readonly (readonly unknown[])[] }) {
  const { t } = useI18n();
  const run = useRun();
  const when = useWhen();
  const [ticked, setTicked] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState<RefusalReason | null>(null);
  const days = item.deleteAt ? daysLeft(item.deleteAt, Date.now()) : null;
  const inv = invalidate.map((k) => [...k]);
  return (
    <li className="cc-card cc-picture-review__item" data-testid="picture-to-check">
      <img className="cc-picture-review__img" src={item.url} alt={t('avatarPictures.alt', { name: item.studentName })} />
      <div className="cc-stack cc-picture-review__body">
        <Who item={item} scope={scope} />
        <span className="cc-muted">{t('avatarPictures.sent', { when: when(item.sentAt) })}</span>
        {days !== null && days <= EXPIRY_WARNING_DAYS ? (
          <Alert kind="warning">
            <IconClock /> {days === 0 ? t('avatarPictures.deleteToday') : t('avatarPictures.deleteIn', { days, count: days })}
          </Alert>
        ) : null}
        {refusing ? (
          <fieldset className="cc-stack cc-picture-review__reasons">
            <legend className="cc-field__label">{t('avatarPictures.reasonQuestion')}</legend>
            {REFUSAL_REASONS.map((r) => (
              <label key={r} className="cc-tick cc-tick--choice">
                <input type="radio" name={`reason-${item.id}`} value={r} checked={reason === r} onChange={() => setReason(r)} data-testid={`picture-reason-${r}`} />
                <span>{t(`avatarPictures.reason.${r}`)}</span>
              </label>
            ))}
            <div className="cc-row">
              <Button
                variant="danger"
                isDisabled={!reason}
                onPress={() => void run(() => call(EP[scope].refuse, { pictureId: item.id, reason: reason! }), { success: t('avatarPictures.refused'), invalidate: inv })}
                data-testid="picture-refuse-send"
              >
                <IconTrash />
                {t('avatarPictures.refuseSend')}
              </Button>
              <Button onPress={() => setRefusing(false)}>{t('avatarPictures.cancel')}</Button>
            </div>
          </fieldset>
        ) : (
          <>
            <label className="cc-tick cc-tick--choice">
              <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} data-testid="picture-confirm" />
              <span>{t('avatarPictures.confirm')}</span>
            </label>
            <div className="cc-row">
              <Button
                variant="primary"
                isDisabled={!ticked}
                onPress={() => void run(() => call(EP[scope].approve, { pictureId: item.id, confirm: true }), { success: t('avatarPictures.approved'), invalidate: [...inv, [...AVATARS_KEY]] })}
                data-testid="picture-approve"
              >
                <IconCheck />
                {t('avatarPictures.approve')}
              </Button>
              <Button variant="danger-outline" onPress={() => setRefusing(true)} data-testid="picture-refuse">
                <IconX />
                {t('avatarPictures.refuse')}
              </Button>
            </div>
          </>
        )}
      </div>
    </li>
  );
}

function InUse({ item, scope, invalidate }: { item: Av.PictureListItem; scope: ReviewScope; invalidate: readonly (readonly unknown[])[] }) {
  const { t } = useI18n();
  const run = useRun();
  const when = useWhen();
  const [asking, setAsking] = useState(false);
  return (
    <li className="cc-card cc-picture-review__item" data-testid="picture-in-use-item">
      <img className="cc-picture-review__img" src={item.url} alt={t('avatarPictures.alt', { name: item.studentName })} />
      <div className="cc-stack cc-picture-review__body">
        <Who item={item} scope={scope} />
        {item.decidedAt ? <span className="cc-muted">{t('avatarPictures.approvedOn', { when: when(item.decidedAt) })}</span> : null}
        {asking ? (
          <InlineConfirm
            message={t('avatarPictures.removeConfirm', { name: item.studentName })}
            confirmLabel={t('avatarPictures.remove')}
            cancelLabel={t('avatarPictures.cancel')}
            destructive
            onConfirm={() => void run(() => call(EP[scope].remove, { pictureId: item.id }), { success: t('avatarPictures.removed'), invalidate: [...invalidate.map((k) => [...k]), [...AVATARS_KEY]] })}
            onCancel={() => setAsking(false)}
          />
        ) : (
          <div>
            <Button variant="danger-outline" onPress={() => setAsking(true)} data-testid="picture-remove">
              <IconTrash />
              {t('avatarPictures.remove')}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

export function PictureReview({ scope }: { scope: ReviewScope }) {
  const { t } = useI18n();
  const [tab, setTab] = useState('toCheck');
  const q = useQuery({ queryKey: picturesKey(scope), queryFn: () => call(EP[scope].list, {}) });
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const invalidate = [picturesKey(scope), PICTURE_COUNT_KEY];
  const { toCheck, inUse } = q.data;
  return (
    <div className="cc-stack" data-testid={`picture-review-${scope}`}>
      {!q.data.enabled ? <Alert kind="warning">{t('avatarPictures.off')}</Alert> : null}
      <Tabs
        label={t('avatarPictures.tabs')}
        selectedKey={tab}
        onSelectionChange={setTab}
        items={[
          {
            id: 'toCheck',
            label: t('avatarPictures.tab.toCheck', { count: toCheck.length }),
            content: toCheck.length ? (
              <ul className="cc-picture-review">
                {toCheck.map((i) => (
                  <ToCheck key={i.id} item={i} scope={scope} invalidate={invalidate} />
                ))}
              </ul>
            ) : (
              <EmptyState title={t('avatarPictures.emptyToCheck')} />
            ),
          },
          {
            id: 'inUse',
            label: t('avatarPictures.tab.inUse', { count: inUse.length }),
            content: inUse.length ? (
              <ul className="cc-picture-review">
                {inUse.map((i) => (
                  <InUse key={i.id} item={i} scope={scope} invalidate={invalidate} />
                ))}
              </ul>
            ) : (
              <EmptyState title={t('avatarPictures.emptyInUse')} />
            ),
          },
        ]}
      />
    </div>
  );
}
