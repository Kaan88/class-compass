/**
 * Notifications page (S14e3, D-155): what the teacher's current students did, grouped by student
 * (each name opens the statistics drawer through `StudentName`, D-154), newest first, with filters
 * (new only, kind, class), "Open" deep links (which mark the line read), mark read per student, all
 * (or, with a filter on, only the lines shown), and a Settings tab (categories, the daily email). Every query is `['sensitive', …]`.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import * as C from '../../../shared/contracts/notifications.ts';
import type { NotificationItem, NotificationSettingsView } from '../../../shared/contracts/notifications.ts';
import { formatDate, pickText, type MessageKey } from '../../../shared/i18n/index.ts';
import { categoryOn, NOTIFICATION_GROUP_KEYS, NOTIFICATION_GROUPS, type NotificationCategory, type NotificationGroup, type NotificationSettings } from '../../../shared/notifications.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { useRun } from '../../lib/useRun.ts';
import { Button, buttonClass } from '../../ui/Button.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select, Toggle } from '../../ui/Fields.tsx';
import { StudentName } from '../../ui/StudentName.tsx';
import { Tabs } from '../../ui/Tabs.tsx';
import type { TeacherPageSearch } from '../types.ts';
import { useTeacherContexts } from '../../routes/teacher/Teacher.tsx';
import { NOTIFICATIONS_KEY } from './Bell.tsx';

const SETTINGS_KEY = [...NOTIFICATIONS_KEY, 'settings'] as const;
const listKey = (unread: boolean, group: string, contextId: string) => [...NOTIFICATIONS_KEY, 'list', unread, group, contextId] as const;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The teacher page a line opens (with the class+subject and the student preselected where the page reads them). */
export function deepLink(item: NotificationItem): { page: string; search: Record<string, string> } | null {
  if (item.gone) return null;
  const base: Record<string, string> = { ...(item.context ? { contextId: item.context.id } : {}), studentId: item.student.id };
  // Class pages (avatars, student links) take the class; the student's row is marked there (S14i).
  const byClass: Record<string, string> = { ...(item.context ? { classId: item.context.classId } : {}), studentId: item.student.id };
  switch (item.category) {
    case 'achievementEarned':
      return { page: 'achievements', search: base };
    case 'avatarChanged':
      return { page: 'avatars', search: byClass };
    case 'linkNewDevice':
      return { page: 'student-links', search: byClass };
    case 'textBlocked':
      return { page: 'text-checks', search: base };
    case 'speakersPoints':
      return { page: 'reports', search: { ...base, view: 'achievementsSpeakers' } };
    default:
      return { page: 'goals', search: base };
  }
}

export function NotificationsPage({ search }: { search: TeacherPageSearch }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const tab = search.tab === 'settings' ? 'settings' : 'list';
  return (
    <main className="cc-page cc-stack" data-testid="notifications-page">
      <h1 className="cc-h1">{t('notifications.title')}</h1>
      <p className="cc-muted">{t('notifications.intro')}</p>
      <Tabs
        label={t('notifications.tabs')}
        selectedKey={tab}
        onSelectionChange={(k) => void navigate({ to: '/teacher/$page', params: { page: 'notifications' }, search: k === 'settings' ? { tab: k } : {}, replace: true })}
        items={[
          { id: 'list', label: t('notifications.tab.list'), content: <NotificationList /> },
          { id: 'settings', label: t('notifications.tab.settings'), content: <NotificationSettingsForm /> },
        ]}
      />
    </main>
  );
}

function NotificationList() {
  const { t, locale } = useI18n();
  const run = useRun();
  const qc = useQueryClient();
  const [unread, setUnread] = useState(false);
  const [group, setGroup] = useState<'' | NotificationGroup>('');
  const [contextId, setContextId] = useState('');
  const contexts = useTeacherContexts();
  const q = useQuery({
    queryKey: listKey(unread, group, contextId),
    queryFn: () => call(C.notificationsList, { unread: unread ? '1' : undefined, group: group || undefined, contextId: contextId || undefined }),
  });
  const items = q.data?.items ?? [];
  const byStudent = useMemo(() => {
    const out = new Map<string, NotificationItem[]>();
    for (const i of items) out.set(i.student.id, [...(out.get(i.student.id) ?? []), i]);
    return [...out.values()];
  }, [items]);
  const markRead = (ids: string[]) => run(() => call(C.markNotificationsRead, { ids }), { success: t('notifications.toast.read'), invalidate: [NOTIFICATIONS_KEY] });
  const filtered = unread || group !== '' || contextId !== '';
  // With a filter on, only the unread lines on screen are marked (never other classes or kinds the
  // teacher has not seen); without one, every unread line of the teacher.
  const shownUnread = items.filter((i) => !i.read).map((i) => i.id);
  return (
    <div className="cc-stack">
      <div className="cc-row cc-notifications__filters">
        <Select
          label={t('notifications.filter.show')}
          value={unread ? 'unread' : 'all'}
          onChange={(v) => setUnread(v === 'unread')}
          items={[
            { id: 'all', label: t('notifications.filter.all') },
            { id: 'unread', label: t('notifications.filter.unread') },
          ]}
        />
        <Select
          label={t('notifications.filter.kind')}
          value={group}
          onChange={(v) => setGroup(v as '' | NotificationGroup)}
          items={[{ id: '', label: t('notifications.filter.anyKind') }, ...NOTIFICATION_GROUP_KEYS.map((g) => ({ id: g, label: t(`notifications.group.${g}`) }))]}
        />
        <Select
          label={t('notifications.filter.class')}
          value={contextId}
          onChange={setContextId}
          items={[{ id: '', label: t('notifications.filter.anyClass') }, ...(contexts ?? []).map((c) => ({ id: c.id, label: `${c.className} · ${pickText(c.subjectName, locale)}` }))]}
        />
        {filtered ? (
          shownUnread.length ? (
            <Button variant="primary" onPress={() => void markRead(shownUnread)}>
              {t('notifications.markShownRead')}
            </Button>
          ) : null
        ) : q.data?.unread ? (
          <Button variant="primary" onPress={() => void run(() => call(C.markNotificationsRead, { all: true }), { success: t('notifications.toast.read'), invalidate: [NOTIFICATIONS_KEY] })}>
            {t('notifications.markAllRead')}
          </Button>
        ) : null}
      </div>
      {q.isSuccess && !items.length ? <EmptyState title={filtered ? t('notifications.emptyFiltered') : t('notifications.empty')} body={filtered ? undefined : t('notifications.emptyBody')} /> : null}
      {byStudent.map((list) => {
        const first = list[0]!;
        const unreadIds = list.filter((i) => !i.read).map((i) => i.id);
        return (
          <section key={first.student.id} className="cc-card cc-stack cc-notifications__student" data-testid="notification-student">
            <div className="cc-row cc-notifications__head">
              <h2 className="cc-h3 cc-notifications__name">
                <StudentName id={first.student.id} name={first.student.fullName} contextId={first.context?.id} />
              </h2>
              {unreadIds.length ? (
                <Button size="small" onPress={() => void markRead(unreadIds)}>
                  {t('notifications.markStudentRead')}
                  <span className="cc-visually-hidden">{t('notifications.markStudentReadFor', { name: first.student.fullName })}</span>
                </Button>
              ) : null}
            </div>
            <ul className="cc-notifications__list">
              {list.map((i) => (
                <NotificationLine key={i.id} item={i} onOpen={() => {
                    // Opening a line marks it read (the bell follows at once).
                    if (!i.read) void call(C.markNotificationsRead, { ids: [i.id] }).then(() => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }), () => undefined);
                  }} />
              ))}
            </ul>
          </section>
        );
      })}
      {q.data?.truncated ? <p className="cc-muted">{t('notifications.truncated', { count: items.length })}</p> : null}
    </div>
  );
}

function NotificationLine({ item, onOpen }: { item: NotificationItem; onOpen: () => void }) {
  const { t, locale } = useI18n();
  const link = deepLink(item);
  const when = formatDate(item.updatedAt, locale, browserZone(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const where = item.context ? `${item.context.className} · ${pickText(item.context.subjectName, locale)}` : null;
  return (
    <li className="cc-notifications__item" data-read={item.read ? 'true' : 'false'} data-testid="notification-item">
      <div className="cc-notifications__what">
        {!item.read ? <span className="cc-notifications__new">{t('notifications.new')}</span> : null}
        <strong>{t(`notifications.item.${item.category}` as MessageKey)}</strong>
        {item.count > 1 ? <span className="cc-muted">{t('notifications.times', { count: item.count })}</span> : null}
      </div>
      {item.snippet ? <p className="cc-notifications__snippet">{item.snippet}</p> : null}
      {item.label ? <p className="cc-notifications__snippet">{pickText(item.label, locale)}</p> : null}
      {item.gone ? <p className="cc-muted">{t('notifications.gone')}</p> : null}
      <div className="cc-row cc-notifications__meta">
        <span className="cc-muted">{[where, when].filter(Boolean).join(' · ')}</span>
        {link ? (
          <Link to="/teacher/$page" params={{ page: link.page }} search={link.search} className={buttonClass('secondary', 'small')} onClick={onOpen}>
            {t('notifications.open')}
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function NotificationSettingsForm() {
  const q = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => call(C.getNotificationSettings, {}) });
  return q.data ? <SettingsEditor key={JSON.stringify(q.data)} initial={q.data} /> : null;
}

function SettingsEditor({ initial }: { initial: NotificationSettingsView }) {
  const { t } = useI18n();
  const run = useRun();
  const [draft, setDraft] = useState<NotificationSettings>({ categories: initial.categories, digest: initial.digest });
  useEffect(() => setDraft({ categories: initial.categories, digest: initial.digest }), [initial]);
  const setCat = (c: NotificationCategory, on: boolean) => setDraft((d) => ({ ...d, categories: { ...d.categories, [c]: on } }));
  const setDigest = (patch: Partial<NotificationSettings['digest']>) => setDraft((d) => ({ ...d, digest: { ...d.digest, ...patch } }));
  return (
    <form
      className="cc-stack"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => call(C.setNotificationSettings, draft), { success: t('notifications.toast.saved'), invalidate: [NOTIFICATIONS_KEY] });
      }}
    >
      <section className="cc-card cc-stack">
        <h2 className="cc-h2">{t('notifications.settings.title')}</h2>
        <p className="cc-muted">{t('notifications.settings.hint')}</p>
        {NOTIFICATION_GROUP_KEYS.map((g) => (
          <fieldset key={g} className="cc-fieldset cc-stack">
            <legend className="cc-h3">{t(`notifications.group.${g}`)}</legend>
            {(NOTIFICATION_GROUPS[g] as readonly NotificationCategory[]).map((c) => (
              <Toggle key={c} label={t(`notifications.category.${c}` as MessageKey)} isSelected={categoryOn(draft, c)} onChange={(v) => setCat(c, v)} />
            ))}
          </fieldset>
        ))}
      </section>
      <section className="cc-card cc-stack">
        <h2 className="cc-h2">{t('notifications.settings.digest')}</h2>
        <p className="cc-muted">{t('notifications.settings.digestHint')}</p>
        {!initial.hasEmail ? <Alert kind="warning">{t('notifications.settings.noEmail')}</Alert> : !initial.emailReady ? <Alert kind="warning">{t('notifications.settings.noMail')}</Alert> : null}
        <Toggle label={t('notifications.settings.digestOn')} isSelected={draft.digest.enabled} onChange={(v) => setDigest({ enabled: v })} />
        <Select
          label={t('notifications.settings.hour')}
          value={String(draft.digest.hour)}
          onChange={(v) => setDigest({ hour: Number(v) })}
          disabled={!draft.digest.enabled}
          items={HOURS.map((h) => ({ id: String(h), label: `${String(h).padStart(2, '0')}:00` }))}
        />
        <Toggle
          label={t('notifications.settings.includeNames')}
          description={t('notifications.settings.includeNamesHint')}
          isSelected={draft.digest.includeNames}
          isDisabled={!draft.digest.enabled}
          onChange={(v) => setDigest({ includeNames: v })}
        />
      </section>
      <div>
        <Button type="submit" variant="primary">
          {t('notifications.settings.save')}
        </Button>
      </div>
    </form>
  );
}
