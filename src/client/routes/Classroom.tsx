/**
 * Classroom shell (UX-1, DSH-1/2, LES-4). Entering it engages classroom mode and the PIN lock on this
 * device (PIN-6). Only classroom-safe data is loaded here. S5 fills the dashboard slots (lesson
 * lifecycle, counters, attendance…); this stage provides the real shell: class picker, quick class
 * switching, banner with the local date in the class timezone, save state and needs-attention tray.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import * as School from '../../shared/contracts/school.ts';
import { formatDate } from '../../shared/i18n/index.ts';
import { call } from '../lib/api.ts';
import { setDisplay, useDisplay } from '../lib/display.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useMe } from '../lib/session.ts';
import { Button, buttonClass } from '../ui/Button.tsx';
import { EmptyState, OutboxAttentionTray, OutboxSaveBadge } from '../ui/Feedback.tsx';
import { Toggle } from '../ui/Fields.tsx';
import { IconLock } from '../ui/icons.tsx';
import { ClassBanner, ClassSwitcher } from '../ui/Layout.tsx';

const ACTIVE_KEY = 'cc.activeContext';
const readActive = () => {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
};

/** Re-render every 30 s so the date/day roll over at local midnight without a reload (DSH-2). */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(h);
  }, [intervalMs]);
  return now;
}

export const classroomContextsKey = ['classroom', 'contexts'] as const;

export function ClassroomPage() {
  const { t, locale } = useI18n();
  const me = useMe();
  const navigate = useNavigate();
  const display = useDisplay();
  const now = useNow();
  const contexts = useQuery({ queryKey: classroomContextsKey, queryFn: () => call(School.myContexts, {}), enabled: Boolean(me?.hasPin) });
  const [activeId, setActiveId] = useState<string | null>(readActive);
  const list = useMemo(() => contexts.data?.contexts ?? [], [contexts.data]);
  const active = list.find((c) => c.id === activeId) ?? list[0] ?? null;

  useEffect(() => {
    if (!active) return;
    setDisplay({ theme: active.theme, classAnimations: active.animationsEnabled, classSounds: active.soundsEnabled });
  }, [active]);
  useEffect(() => () => setDisplay({ theme: 'classroom', classAnimations: true, classSounds: true }), []);

  const switchTo = (id: string) => {
    setActiveId(id);
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      /* per-tab only */
    }
  };

  if (!me) return null;
  if (!me.hasPin) {
    return (
      <main className="cc-page">
        <EmptyState
          title={t('classroom.needPin.title')}
          body={t('classroom.needPin.body')}
          action={
            <Link to="/teacher/profile" className={buttonClass('primary', 'big')}>
              {t('classroom.needPin.action')}
            </Link>
          }
        />
      </main>
    );
  }

  return (
    <div data-testid="classroom-shell">
      <div className="cc-topbar">
        <span className="cc-topbar__title">{t('app.name')}</span>
        <OutboxSaveBadge />
        <Toggle label={t('classroom.sounds')} isSelected={display.deviceSounds} onChange={(v) => setDisplay({ deviceSounds: v })} />
        <Button onPress={() => void navigate({ to: '/teacher' })}>
          <IconLock />
          {t('classroom.teacherArea')}
        </Button>
      </div>
      <main className="cc-page cc-stack">
        {contexts.isLoading ? <p>{t('common.loading')}</p> : null}
        {contexts.isSuccess && list.length === 0 ? <EmptyState title={t('classroom.noClasses.title')} body={t('classroom.noClasses.body')} /> : null}
        {active ? (
          <>
            {list.length > 1 ? <ClassSwitcher contexts={list} activeId={active.id} onSwitch={switchTo} /> : null}
            <ClassBanner
              className={active.className}
              subjectName={active.subjectName}
              dayLabel={formatDate(now, locale, active.timezone, { weekday: 'long' })}
              dateLabel={formatDate(now, locale, active.timezone, { day: 'numeric', month: 'long', year: 'numeric' })}
            />
            <OutboxAttentionTray />
            <section className="cc-dashboard" aria-label={t('classroom.dashboard')}>
              {(['lesson', 'routine', 'counter', 'assistant', 'students'] as const).map((slot) => (
                <div key={slot} className="cc-slot" data-slot={slot}>
                  {t(`classroom.slot.${slot}`)}
                </div>
              ))}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
