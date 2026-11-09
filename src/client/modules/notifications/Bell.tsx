/**
 * The notifications bell (S14e3, D-155): in the teacher navigation and on the teacher menu, both
 * inside `SensitiveGate` (the count is `teacher` access and its query is `['sensitive', …]`, so it is
 * never fetched while locked and is purged on lock). The count is polled every 60 s while the page is
 * visible with a conditional GET: the ETag is the count itself, so a 304 needs no stored body.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import * as C from '../../../shared/contracts/notifications.ts';
import { callConditional } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { IconBell } from '../../ui/icons.tsx';

/** Every notification query starts with this (invalidate it after marking something read). */
export const NOTIFICATIONS_KEY = ['sensitive', 'notifications'] as const;
export const NOTIFICATION_COUNT_KEY = [...NOTIFICATIONS_KEY, 'count'] as const;
export const POLL_MS = 60_000;

let lastEtag: string | null = null;
/** The count a `"nc-<n>"` ETag stands for (the server's validator is the count itself). */
const countOf = (etag: string | null) => Number(/^(?:W\/)?"nc-(\d+)"$/u.exec(etag ?? '')?.[1] ?? Number.NaN);

async function fetchCount(): Promise<number> {
  const r = await callConditional(C.notificationsCount, {}, Number.isFinite(countOf(lastEtag)) ? lastEtag : null);
  if (r.notModified) return countOf(lastEtag);
  lastEtag = r.etag;
  return r.data.unread;
}

/** Unread notifications (null while loading). */
export function useUnreadCount(): number | null {
  const q = useQuery({ queryKey: NOTIFICATION_COUNT_KEY, queryFn: fetchCount, refetchInterval: POLL_MS, refetchIntervalInBackground: false, staleTime: 15_000 });
  return q.data ?? null;
}

const shown = (n: number) => (n > 99 ? '99+' : String(n));

/**
 * The bell: a link to the notifications page with the unread count. `tile` draws it as a teacher menu
 * tile (the "Today" group's Notifications tile), otherwise as a compact button in the navigation.
 */
export function Bell({ tile = false }: { tile?: boolean }) {
  const { t } = useI18n();
  const n = useUnreadCount();
  const label = n ? t('notifications.bellUnread', { count: n }) : t('notifications.title');
  const count = n ? (
    <span className="cc-bell__count" aria-hidden="true">
      {shown(n)}
    </span>
  ) : null;
  if (tile) {
    return (
      // The visible words are the start of the name (the count is spoken as "3 new").
      <Link to="/teacher/$page" params={{ page: 'notifications' }} className="cc-menu-tile cc-bell-tile" data-testid="bell-tile">
        <IconBell />
        <span className="cc-bell-tile__label">{t('notifications.title')}</span>
        {count}
        {n ? <span className="cc-visually-hidden">{t('notifications.newCount', { count: n })}</span> : null}
      </Link>
    );
  }
  return (
    <Link to="/teacher/$page" params={{ page: 'notifications' }} className="cc-bell" aria-label={label} data-testid="bell">
      <IconBell />
      {count}
    </Link>
  );
}
