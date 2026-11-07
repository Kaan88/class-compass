/** Teacher area (PIN-gated in classroom mode): menu first (PIN-4), profile, class settings, roster. */
import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Auth from '../../../shared/contracts/auth.ts';
import { call } from '../../lib/api.ts';
import { errorText } from '../../lib/errors.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { setMenuFirst } from '../../lib/menuFirst.ts';
import { freshMe, ME_KEY, signOut, useMe, type Me } from '../../lib/session.ts';
import { Button, BigButton } from '../../ui/Button.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select, TextField } from '../../ui/Fields.tsx';
import { IconBoard, IconCalendar, IconList, IconPlus, IconSettings, IconUser, IconUsers } from '../../ui/icons.tsx';
import { Mascot } from '../../ui/Mascot.tsx';
import { ChangePasswordForm } from '../Auth.tsx';
import { SensitiveGate } from '../Lock.tsx';

export function TeacherLayout() {
  const { t } = useI18n();
  const me = useMe();
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
        <>
          <nav className="cc-topbar" aria-label={t('teacher.nav')}>
            <span className="cc-topbar__title">{t('app.name')}</span>
            <div className="cc-nav">
              <Link to="/teacher" activeOptions={{ exact: true }}>
                {t('teacher.menu')}
              </Link>
              <Link to="/teacher/profile">{t('teacher.profile')}</Link>
              <Link to="/teacher/classes">{t('teacher.classSettings')}</Link>
              <Link to="/teacher/students">{t('teacher.students')}</Link>
              <Link to="/teacher/attendance">{t('teacher.attendance')}</Link>
              <Link to="/teacher/routines">{t('teacher.routines')}</Link>
              <Link to="/teacher/counters">{t('teacher.counters')}</Link>
            </div>
          </nav>
          <Outlet />
        </>
      )}
    </SensitiveGate>
  );
}

/** The first thing shown after unlocking (PIN-4). Nothing sensitive is displayed here. */
export function TeacherMenu() {
  const { t } = useI18n();
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
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
      <div className="cc-menu-grid">
        <Link to="/teacher/profile" className="cc-menu-tile">
          <IconUser />
          {t('teacher.profile')}
        </Link>
        <Link to="/teacher/classes" className="cc-menu-tile">
          <IconSettings />
          {t('teacher.classSettings')}
        </Link>
        <Link to="/teacher/students" className="cc-menu-tile">
          <IconUsers />
          {t('teacher.students')}
        </Link>
        <Link to="/teacher/attendance" className="cc-menu-tile">
          <IconCalendar />
          {t('teacher.attendance')}
        </Link>
        <Link to="/teacher/routines" className="cc-menu-tile">
          <IconList />
          {t('teacher.routines')}
        </Link>
        <Link to="/teacher/counters" className="cc-menu-tile">
          <IconPlus />
          {t('teacher.counters')}
        </Link>
      </div>
      <div className="cc-row">
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

/** Language, text size, PIN and password — each affects only this account (UX-4, THM-6, PIN-9). */
export function ProfilePage() {
  const { t } = useI18n();
  const me = useMe();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const update = async (patch: { locale?: 'en' | 'tr'; textScale?: number }) => {
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
        </div>
        {error ? <Alert>{error}</Alert> : null}
      </section>
      {me.role === 'teacher' ? <PinSection hasPin={me.hasPin} /> : null}
      <section className="cc-card cc-stack">
        <h2 className="cc-h2">{t('password.changeTitle')}</h2>
        <ChangePasswordForm />
      </section>
    </main>
  );
}

function PinSection({ hasPin }: { hasPin: boolean }) {
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
      <p className="cc-muted">{t('profile.pinHint')}</p>
      <form
        className="cc-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setOk(false);
          if (!/^\d{4,8}$/.test(pin)) return setError(t('profile.pinRules'));
          if (pin !== pin2) return setError(t('profile.pinMismatch'));
          try {
            await call(Auth.setPin, { currentPassword: password, pin });
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
        <TextField label={t('password.current')} type="password" autoComplete="current-password" isRequired value={password} onChange={setPassword} />
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
