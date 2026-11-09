/** Administration area (ACC-1/2, ACC-12). PIN-gated like the teacher area on a classroom device. */
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../lib/i18n.tsx';
import { signOut, useMe } from '../../lib/session.ts';
import { Button, buttonClass } from '../../ui/Button.tsx';
import { EmptyState } from '../../ui/Feedback.tsx';
import { Select } from '../../ui/Fields.tsx';
import { IconArchive, IconBook, IconCalendar, IconChart, IconDatabase, IconImage, IconKey, IconList, IconSettings, IconShield, IconStar, IconSwap, IconUser, IconUsers } from '../../ui/icons.tsx';
import { SensitiveGate } from '../Lock.tsx';

export const ADMIN = ['sensitive', 'admin'] as const;

const SECTIONS = [
  { to: '/admin/users', key: 'admin.users', icon: <IconKey /> },
  { to: '/admin/settings', key: 'admin.settings', icon: <IconSettings /> },
  { to: '/admin/years', key: 'admin.years', icon: <IconCalendar /> },
  { to: '/admin/subjects', key: 'admin.subjects', icon: <IconBook /> },
  { to: '/admin/classes', key: 'admin.classes', icon: <IconArchive /> },
  { to: '/admin/assignments', key: 'admin.assignments', icon: <IconSwap /> },
  { to: '/admin/modules', key: 'admin.modules', icon: <IconShield /> },
  { to: '/admin/students', key: 'admin.students', icon: <IconUsers /> },
  { to: '/admin/reports', key: 'admin.reports', icon: <IconChart /> },
  { to: '/admin/super-speakers', key: 'module.superSpeakers', icon: <IconStar /> },
  { to: '/admin/themes', key: 'admin.themes', icon: <IconImage /> },
  { to: '/admin/maintenance', key: 'admin.maintenance', icon: <IconDatabase /> },
  { to: '/admin/audit', key: 'admin.audit', icon: <IconList /> },
  { to: '/admin/profile', key: 'teacher.profile', icon: <IconUser /> },
] as const;

export function AdminLayout() {
  const { t } = useI18n();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (
    <SensitiveGate>
      {me && me.role !== 'admin' ? (
        <main className="cc-page">
          <EmptyState
            title={t('error.FORBIDDEN')}
            action={
              <Link to="/" className="cc-btn cc-btn--primary">
                {t('notFound.home')}
              </Link>
            }
          />
        </main>
      ) : (
        <>
          <nav className="cc-topbar cc-topbar--compact" aria-label={t('admin.nav')}>
            <Link to="/admin" className="cc-topbar__title" style={{ textDecoration: 'none', color: 'inherit' }}>
              {t('admin.title')}
            </Link>
            <Link to="/help" search={{ guide: 'admin', lang: me?.locale }} className={buttonClass('ghost')} data-testid="help-link">
              {t('help.link')}
            </Link>
            <Button
              variant="ghost"
              onPress={async () => {
                await signOut(qc);
                await navigate({ to: '/login', search: { next: undefined } });
              }}
            >
              {t('auth.signOut')}
            </Button>
          </nav>
          <AdminSectionNav />
          <Outlet />
        </>
      )}
    </SensitiveGate>
  );
}

/**
 * Section navigation: a row of pills on wide screens, one "Section" select below 52rem (phones and
 * tablets, where 15 pills took more than a screen). Not shown on the admin home, whose tiles are the
 * navigation.
 */
function AdminSectionNav() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname }).replace(/\/+$/u, '');
  if (path === '/admin' || path === '') return null;
  const current = SECTIONS.find((s) => path === s.to || path.startsWith(`${s.to}/`));
  return (
    <div className="cc-page cc-admin-nav">
      <nav className="cc-nav cc-admin-nav__pills" aria-label={t('admin.sections')}>
        {SECTIONS.map((s) => (
          <Link key={s.to} to={s.to}>
            {t(s.key)}
          </Link>
        ))}
      </nav>
      <nav className="cc-admin-nav__select" aria-label={t('admin.sections')}>
        <Select
          label={t('admin.section')}
          value={current?.to ?? ''}
          placeholder={t('admin.title')}
          onChange={(to) => void navigate({ to })}
          items={SECTIONS.map((s) => ({ id: s.to, label: t(s.key) }))}
        />
      </nav>
    </div>
  );
}

export function AdminHome() {
  const { t } = useI18n();
  return (
    <main className="cc-page cc-stack" data-testid="admin-home">
      <h1 className="cc-h1">{t('admin.title')}</h1>
      <p className="cc-muted">{t('admin.intro')}</p>
      <div className="cc-row" data-testid="admin-quick-actions">
        <Link to="/admin/classes" search={{ new: 1 }} className={buttonClass('primary', 'big')}>
          <IconArchive />
          {t('admin.addClassroom')}
        </Link>
        <Link to="/admin/users" className={buttonClass('secondary', 'big')}>
          <IconKey />
          {t('admin.addAccount')}
        </Link>
      </div>
      <div className="cc-menu-grid cc-menu-grid--compact">
        {SECTIONS.map((s) => (
          <Link key={s.to} to={s.to} className="cc-menu-tile">
            {s.icon}
            {t(s.key)}
          </Link>
        ))}
      </div>
    </main>
  );
}
