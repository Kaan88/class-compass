/** Teacher area (PIN-gated in classroom mode): menu first (PIN-4), profile, class settings, roster. */
import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Auth from '../../../shared/contracts/auth.ts';
import { call } from '../../lib/api.ts';
import { useAreaDensity } from '../../lib/areaDensity.ts';
import { errorText } from '../../lib/errors.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { setMenuFirst } from '../../lib/menuFirst.ts';
import { freshMe, ME_KEY, signOut, useMe, type Me } from '../../lib/session.ts';
import { Button, BigButton, buttonClass } from '../../ui/Button.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select, TextField } from '../../ui/Fields.tsx';
import { pageAvailable, setupPages, todayPages } from '../../modules/registry.ts';
import type { TeacherPage, TeacherPageSearch } from '../../modules/types.ts';
import { Bell } from '../../modules/notifications/Bell.tsx';
import { IconBoard, IconSliders } from '../../ui/icons.tsx';
import { Mascot } from '../../ui/Mascot.tsx';
import { ChangePasswordForm } from '../Auth.tsx';
import { SignInMethodSection } from '../SignIn.tsx';
import { TimeUpClipSection } from './ClassDisplay.tsx';
import { FullscreenButton, LessonPrefsSection } from '../../modules/lessons/fullscreen.tsx';
import * as School from '../../../shared/contracts/school.ts';
import { SensitiveGate } from '../Lock.tsx';
import { StudentStatsProvider } from '../../ui/StudentName.tsx';
import { AiToolsSection } from '../AiTools.tsx';
import { OwnAiConnectionsSection } from '../AiConnections.tsx';

/** The notifications page key: the bell stands for it in the navigation and on the menu (S14e3). */
const NOTIFICATIONS_PAGE = 'notifications';

export function TeacherLayout() {
  const { t } = useI18n();
  const me = useMe();
  // Compact / Normal / Large of this account (S22d, D-178).
  useAreaDensity(me?.density);
  return (
    <SensitiveGate>
      {me && me.role !== 'teacher' ? (
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
        // Every student name below opens the statistics drawer, behind the PIN gate (S14e2, D-154).
        <StudentStatsProvider>
          <TeacherNav />
          <Outlet />
        </StudentStatsProvider>
      )}
    </SensitiveGate>
  );
}

const useContextsQuery = () => useQuery({ queryKey: ['classroom', 'contexts'], queryFn: () => call(School.myContexts, {}) });

/** The teacher's class+subjects (classroom-safe list, shared query); undefined while loading. */
export function useTeacherContexts(): School.MyContext[] | undefined {
  return useContextsQuery().data?.contexts;
}
/** What the menu needs to hide the pages of modules that are off everywhere (S14e3, D-156). */
export const useMenuContexts = useTeacherContexts;

/**
 * A teacher page from a manifest (the `/teacher/$page` route). A page whose module is off in every
 * class+subject of the teacher shows an empty state (S14e3, D-156); its address keeps working. When
 * the teacher switched it off, the empty state points to Class settings; when the administrator made
 * the module unavailable school-wide, it says so and offers no switch the teacher cannot use.
 */
export function TeacherPageView({ page, search }: { page: TeacherPage; search: TeacherPageSearch }) {
  const { t } = useI18n();
  const q = useContextsQuery();
  if (!pageAvailable(page, q.data?.contexts)) {
    const byAdmin = page.module ? q.data?.available[page.module] === false : false;
    return (
      <main className="cc-page cc-stack" data-testid="module-off-page">
        <h1 className="cc-h1">{t(page.labelKey)}</h1>
        {byAdmin ? (
          <EmptyState title={t('teacher.moduleOff.adminTitle', { page: t(page.labelKey) })} body={t('teacher.moduleOff.adminBody')} />
        ) : (
          <EmptyState
            title={t('teacher.moduleOff.title', { page: t(page.labelKey) })}
            body={t('teacher.moduleOff.body')}
            action={
              <Link to="/teacher/$page" params={{ page: 'classes' }} className={buttonClass('primary')}>
                {t('teacher.moduleOff.action')}
              </Link>
            }
          />
        )}
      </main>
    );
  }
  const Page = page.Component;
  return <Page search={search} />;
}

/**
 * Teacher navigation (usability audit 2026-11; S14e3, D-156): on wide screens a row of links (Menu,
 * the "Today" pages, Class setup, Profile, Help) and the notifications bell; below 52rem one "Page"
 * list (which also lists the setup pages) and the bell. The menu page shows only the title bar and the
 * bell, because its tiles are the navigation. Pages of modules that are off everywhere are left out.
 */
function TeacherNav() {
  const { t } = useI18n();
  const me = useMe();
  const navigate = useNavigate();
  const contexts = useMenuContexts();
  const path = useRouterState({ select: (s) => s.location.pathname }).replace(/\/+$/u, '');
  const today = todayPages(contexts);
  const setup = setupPages(contexts);
  const onMenu = path === '/teacher';
  const current = path.startsWith('/teacher/') ? path.slice('/teacher/'.length).split('/')[0]! : '';
  const inSetup = current === 'setup' || setup.some((p) => p.path === current);
  const items = [
    { id: '', label: t('teacher.menu') },
    ...today.map((p) => ({ id: p.path, label: t(p.labelKey) })),
    { id: 'setup', label: t('teacher.setup') },
    ...setup.map((p) => ({ id: p.path, label: `${t('teacher.setup')}: ${t(p.labelKey)}` })),
    { id: 'profile', label: t('teacher.profile') },
    { id: '#help', label: t('help.link') },
  ];
  return (
    <nav className="cc-topbar cc-teacher-nav" aria-label={t('teacher.nav')}>
      <span className="cc-topbar__title">{t('app.name')}</span>
      {onMenu ? null : (
        <>
          <div className="cc-nav cc-teacher-nav__links">
            <Link to="/teacher" activeOptions={{ exact: true }}>
              {t('teacher.menu')}
            </Link>
            {/* The bell stands for the notifications page. */}
            {today
              .filter((p) => p.key !== NOTIFICATIONS_PAGE)
              .map((p) => (
                <Link key={p.key} to="/teacher/$page" params={{ page: p.path }}>
                  {t(p.labelKey)}
                </Link>
              ))}
            {/* On a setup page the Class setup link is the current section: said by aria-current, shown by more than colour. */}
            <Link to="/teacher/$page" params={{ page: 'setup' }} data-section={inSetup ? 'current' : undefined} aria-current={inSetup ? 'location' : undefined}>
              {t('teacher.setup')}
            </Link>
            <Link to="/teacher/$page" params={{ page: 'profile' }}>
              {t('teacher.profile')}
            </Link>
            <Link to="/help" search={{ guide: 'teacher', lang: me?.locale }} data-testid="help-link">
              {t('help.link')}
            </Link>
          </div>
          <div className="cc-teacher-nav__select">
            <Select
              label={t('teacher.page')}
              value={items.some((i) => i.id === current) ? current : ''}
              onChange={(id) => {
                if (id === '#help') void navigate({ to: '/help', search: { guide: 'teacher', lang: me?.locale } });
                else if (id === '') void navigate({ to: '/teacher' });
                else void navigate({ to: '/teacher/$page', params: { page: id } });
              }}
              items={items}
            />
          </div>
        </>
      )}
      {/* Leave full screen only (S18, D-167): reached from a lesson in full screen, the page may still be in it. */}
      <FullscreenButton canEnter={false} />
      <Bell />
    </nav>
  );
}

/**
 * The first thing shown after unlocking (PIN-4; S14e3, D-156): Open classroom, the "Today" tiles
 * (the notifications tile carries the unread count), one Class setup tile, then a small row with
 * Profile, Help, Leave classroom mode and Sign out. Nothing sensitive is displayed here besides the
 * count, which is behind the PIN gate like the menu itself.
 */
export function TeacherMenu() {
  const { t } = useI18n();
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const contexts = useMenuContexts();
  useEffect(() => setMenuFirst(false), []);
  if (!me) return null;
  return (
    <main className="cc-page cc-stack" data-testid="teacher-menu">
      <div className="cc-row">
        <Mascot size={80} />
        <div>
          <h1 className="cc-h1">{t('teacher.menuTitle')}</h1>
          <p className="cc-muted" style={{ margin: 0 }}>
            {t('home.welcome', { name: me.displayName })}
          </p>
        </div>
      </div>
      <BigButton variant="primary" onPress={() => void navigate({ to: '/classroom' })}>
        <IconBoard />
        {me.classroomMode ? t('teacher.backToClassroom') : t('teacher.openClassroom')}
      </BigButton>
      <section className="cc-stack" aria-labelledby="menu-today">
        <h2 id="menu-today" className="cc-h2">
          {t('teacher.today')}
        </h2>
        <div className="cc-menu-grid" data-testid="menu-today">
          {todayPages(contexts).map((p) =>
            p.key === NOTIFICATIONS_PAGE ? (
              <Bell key={p.key} tile />
            ) : (
              <Link key={p.key} to="/teacher/$page" params={{ page: p.path }} className="cc-menu-tile">
                <p.Icon />
                {t(p.labelKey)}
              </Link>
            ),
          )}
        </div>
      </section>
      <div className="cc-menu-grid" data-testid="menu-setup">
        <Link to="/teacher/$page" params={{ page: 'setup' }} className="cc-menu-tile">
          <IconSliders />
          {t('teacher.setup')}
        </Link>
      </div>
      <div className="cc-row">
        <Link to="/teacher/$page" params={{ page: 'profile' }} className={buttonClass('secondary')}>
          {t('teacher.profile')}
        </Link>
        <Link to="/help" search={{ guide: 'quick-start-teacher', lang: me.locale }} className={buttonClass('secondary')}>
          {t('help.link')}
        </Link>
        {me.classroomMode ? (
          <Button
            onPress={async () => {
              await call(Auth.leaveClassroom, {});
              await freshMe(qc);
            }}
          >
            {t('teacher.leaveClassroomMode')}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          onPress={async () => {
            await signOut(qc);
            await navigate({ to: '/login', search: { next: undefined } });
          }}
        >
          {t('auth.signOut')}
        </Button>
      </div>
    </main>
  );
}

export const TEXT_SCALES = [80, 90, 100, 115, 130, 150, 175, 200];

/** Language, text size, PIN, password and AI tools tokens — each affects only this account (UX-4, THM-6, PIN-9, D-160). */
export function ProfilePage() {
  const { t } = useI18n();
  const me = useMe();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const signInInfo = useQuery({ queryKey: ['public', 'reset-available'], queryFn: () => call(Auth.passwordResetAvailable, {}), staleTime: 60_000 });
  if (!me) return null;
  const update = async (patch: { locale?: 'en' | 'tr'; textScale?: number; density?: Auth.AreaDensity }) => {
    setError(null);
    try {
      const fresh = await call(Auth.updatePreferences, patch);
      qc.setQueryData<Me | null>(ME_KEY, fresh);
    } catch (err) {
      setError(errorText(t, err));
    }
  };
  return (
    <main className="cc-page cc-stack" data-testid="profile-page">
      <h1 className="cc-h1">{t('profile.title')}</h1>
      <section className="cc-card cc-stack">
        <h2 className="cc-h2">{t('profile.display')}</h2>
        <p className="cc-muted">{t('profile.displayHint')}</p>
        <div className="cc-row" style={{ alignItems: 'flex-start' }}>
          <Select
            label={t('language.label')}
            name="locale"
            value={me.locale}
            onChange={(v) => void update({ locale: v === 'tr' ? 'tr' : 'en' })}
            items={[
              { id: 'en', label: t('language.en') },
              { id: 'tr', label: t('language.tr') },
            ]}
          />
          <Select
            label={t('profile.textSize')}
            name="textScale"
            value={String(me.textScale)}
            onChange={(v) => void update({ textScale: Number(v) })}
            items={TEXT_SCALES.map((s) => ({ id: String(s), label: `${s}%` }))}
          />
          {/* Compact / Normal / Large for the teacher and admin areas (S22d, D-178). */}
          <Select
            label={t('profile.density')}
            name="density"
            value={me.density}
            description={t('profile.densityHint')}
            onChange={(v) => {
              const density = Auth.AREA_DENSITIES.find((d) => d === v);
              if (density) void update({ density });
            }}
            items={Auth.AREA_DENSITIES.map((d) => ({ id: d, label: t(`profile.density.${d}`) }))}
          />
        </div>
        {error ? <Alert>{error}</Alert> : null}
      </section>
      {/* Teachers: the classroom PIN. Administrators: the PIN that confirms Maintenance actions (D-138). */}
      <PinSection me={me} />
      {/* "Full screen during lessons" (S18, D-167): follows the account to every classroom computer. */}
      {me.role === 'teacher' ? <LessonPrefsSection /> : null}
      {me.role === 'teacher' ? <ClipSection /> : null}
      {me.signInMethod === 'password' ? (
        <section className="cc-card cc-stack">
          <h2 className="cc-h2">{t('password.changeTitle')}</h2>
          <ChangePasswordForm />
        </section>
      ) : null}
      <SignInMethodSection me={me} emailLinkEnabled={signInInfo.data?.emailLinkEnabled ?? false} />
      {/* Personal tokens for AI tools (S14h1, D-160): behind the PIN gate, with re-authentication. */}
      <AiToolsSection me={me} />
      {/* The assistant's connections: the school default and, when allowed, the teacher's own (S19a, D-179). */}
      {me.role === 'teacher' ? <OwnAiConnectionsSection /> : null}
    </main>
  );
}

/** The time's-up clip needs to know whether one is saved (from the classroom contexts). */
function ClipSection() {
  const contexts = useQuery({ queryKey: ['classroom', 'contexts'], queryFn: () => call(School.myContexts, {}) });
  return <TimeUpClipSection hasClip={contexts.data?.timeUpClip ?? false} />;
}

function PinSection({ me }: { me: Me }) {
  const hasPin = me.hasPin;
  // Email-link accounts have no password: a fresh email sign-in (15 minutes) is the re-authentication (D-108).
  const byEmail = me.signInMethod === 'email_link';
  const { t } = useI18n();
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  return (
    <section className="cc-card cc-stack" aria-labelledby="pin-title">
      <h2 id="pin-title" className="cc-h2">
        {hasPin ? t('profile.pinChange') : t('profile.pinSet')}
      </h2>
      <p className="cc-muted">{t(me.role === 'admin' ? 'profile.pinHintAdmin' : 'profile.pinHint')}</p>
      <form
        className="cc-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setOk(false);
          if (!/^\d{4,8}$/.test(pin)) return setError(t('profile.pinRules'));
          if (pin !== pin2) return setError(t('profile.pinMismatch'));
          try {
            await call(Auth.setPin, byEmail ? { pin } : { currentPassword: password, pin });
            setPassword('');
            setPin('');
            setPin2('');
            setOk(true);
            await freshMe(qc);
          } catch (err) {
            setError(errorText(t, err));
          }
        }}
      >
        {byEmail ? (
          me.reauthFresh ? null : <Alert kind="warning">{t('error.REAUTH_REQUIRED')}</Alert>
        ) : (
          <TextField label={t('password.current')} type="password" autoComplete="current-password" isRequired value={password} onChange={setPassword} />
        )}
        <div className="cc-row" style={{ alignItems: 'flex-start' }}>
          <TextField label={t('profile.newPin')} description={t('profile.pinRules')} type="password" inputMode="numeric" autoComplete="off" isRequired value={pin} onChange={setPin} />
          <TextField label={t('profile.repeatPin')} type="password" inputMode="numeric" autoComplete="off" isRequired value={pin2} onChange={setPin2} />
        </div>
        {error ? <Alert>{error}</Alert> : null}
        {ok ? <Alert kind="success">{t('profile.pinSaved')}</Alert> : null}
        <div>
          <Button type="submit" variant="primary">
            {t('profile.savePin')}
          </Button>
        </div>
      </form>
    </section>
  );
}
