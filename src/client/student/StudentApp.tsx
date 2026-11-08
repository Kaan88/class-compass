/**
 * The personal student page shell (STU-2, UX-2..4): mobile-first, one column, large touch targets.
 * - Language: English by default; the EN/TR switch is remembered on this device only (localStorage).
 * - Theme: the student's class theme.
 * - Each subject shows the sections its modules contribute (server `studentPage` manifests), in the
 *   server's order; a key without a screen here is skipped.
 * - A refused or revoked link (401) shows a friendly "this link no longer works" page (STU-3). A busy
 *   server (429), a server error or no connection shows "try again" instead: the token is kept in
 *   memory (never stored) so the student can retry without the link, which has left the address bar.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { studentPage } from '../../shared/contracts/goals.ts';
import { exchangeStudentLink, leaveStudentSession } from '../../shared/contracts/links.ts';
import { pickText, translate, type Locale } from '../../shared/i18n/index.ts';
import { ApiError, call } from '../lib/api.ts';
import { setDisplay } from '../lib/display.ts';
import { I18nProvider, useI18n } from '../lib/i18n.tsx';
import { Button } from '../ui/Button.tsx';
import { Toaster } from '../ui/Feedback.tsx';
import { IconGlobe } from '../ui/icons.tsx';
import { Avatar } from '../ui/Students.tsx';
import { ThemeBackdrop, ThemeIllustration } from '../ui/Mascot.tsx';
import { STUDENT_PAGE_KEY } from './keys.ts';
import { CelebrationLayer } from '../themes/Celebration.tsx';
import { AvatarPanel } from './AvatarPanel.tsx';
import { STUDENT_SECTIONS } from './sections.tsx';
import { displayLocale, type ClassLanguage } from '../../shared/classLanguage.ts';

const LOCALE_KEY = 'cc.studentLocale';
/** The student and parent guide (docs/guides), loaded only when "Help" is pressed. */
const HelpPanel = lazy(() => import('../help/HelpPanel.tsx'));


export function readStudentLocale(): Locale {
  try {
    return localStorage.getItem(LOCALE_KEY) === 'tr' ? 'tr' : 'en';
  } catch {
    return 'en';
  }
}

function saveLocale(l: Locale) {
  try {
    localStorage.setItem(LOCALE_KEY, l);
  } catch {
    /* private mode: this visit only */
  }
}

function LanguageSwitch({ locale, onChange }: { locale: Locale; onChange: (l: Locale) => void }) {
  const { t } = useI18n();
  return (
    <div className="cc-row cc-lang" role="group" aria-label={t('student.language')}>
      <IconGlobe />
      {(['en', 'tr'] as const).map((l) => (
        <Button key={l} size="small" variant={l === locale ? 'primary' : 'secondary'} aria-pressed={l === locale} onPress={() => onChange(l)}>
          {translate(l, `student.languageName.${l}`)}
        </Button>
      ))}
    </div>
  );
}

function LinkGone() {
  const { t } = useI18n();
  return (
    <main className="cc-page cc-student" data-testid="student-link-gone">
      <section className="cc-card cc-stack cc-student__gone">
        <ThemeIllustration name="emptyState" width={160} />
        <h1 className="cc-h1">{t('student.gone.title')}</h1>
        <p>{t('student.gone.body')}</p>
      </section>
    </main>
  );
}

function Page({ onLanguage }: { onLanguage: (l: ClassLanguage) => void }) {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: STUDENT_PAGE_KEY, queryFn: () => call(studentPage, {}) });
  const [help, setHelp] = useState(false);
  useEffect(() => {
    if (q.data) setDisplay({ theme: q.data.theme });
    if (q.data) onLanguage(q.data.language);
  }, [q.data, onLanguage]);
  if (q.error) return q.error instanceof ApiError && q.error.status === 401 ? <LinkGone /> : <p className="cc-page">{t('common.error')}</p>;
  if (!q.data) return <p className="cc-page cc-muted">{t('common.loading')}</p>;
  const page = q.data;
  if (help)
    return (
      <main className="cc-page cc-student cc-stack">
        <Suspense fallback={<p className="cc-muted">{t('common.loading')}</p>}>
          <HelpPanel guide="student" onClose={() => setHelp(false)} />
        </Suspense>
      </main>
    );
  return (
    <main className="cc-page cc-student cc-stack" data-testid="student-page">
      <header className="cc-row cc-student__head">
        <Avatar name={page.student.fullName} hue={page.student.avatarHue} initials={page.student.initials} size="lg" spec={page.avatar.spec ?? (page.avatar.fallback === 'generated' ? page.avatar.generated : null)} />
        <div className="cc-stack cc-student__who">
          <h1 className="cc-h1">{t('student.hello', { name: page.student.fullName })}</h1>
          {page.className ? <p className="cc-muted">{t('student.className', { name: page.className })}</p> : null}
        </div>
      </header>
      <AvatarPanel info={page.avatar} name={page.student.fullName} />
      {page.subjects.length === 0 ? <p className="cc-card">{t('student.nothingYet')}</p> : null}
      {page.subjects.map((subject) => (
        <section key={subject.subjectId} className="cc-stack" aria-labelledby={`subject-${subject.subjectId}`}>
          <h2 id={`subject-${subject.subjectId}`} className="cc-h1 cc-student__subject">
            {pickText(subject.name, locale)}
          </h2>
          {subject.sections.map((section) => {
            const Section = STUDENT_SECTIONS[section.key] as ((p: { data: typeof section.data; subjectId: string; media: typeof page.media }) => ReactNode) | undefined;
            return Section ? <Section key={section.key} data={section.data} subjectId={subject.subjectId} media={page.media} /> : null;
          })}
        </section>
      ))}
      <footer className="cc-row cc-muted">
        <p>{t('student.privacy')}</p>
        <Button size="small" variant="ghost" onPress={() => setHelp(true)}>
          {t('help.link')}
        </Button>
        <Button size="small" variant="ghost" onPress={() => void call(leaveStudentSession, {}).finally(() => window.location.reload())}>
          {t('student.leave')}
        </Button>
      </footer>
    </main>
  );
}

/** Outcome of posting the link's token: only a 401 means the link itself is refused. */
export type OpenResult = 'ok' | 'invalid' | 'retry';

export async function openLink(token: string): Promise<OpenResult> {
  try {
    await call(exchangeStudentLink, { token });
    return 'ok';
  } catch (e) {
    return e instanceof ApiError && e.status === 401 ? 'invalid' : 'retry';
  }
}

function TryAgain({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <main className="cc-page cc-student" data-testid="student-link-retry">
      <section className="cc-card cc-stack cc-student__gone" role="alert">
        <h1 className="cc-h1">{t('student.retry.title')}</h1>
        <p>{t('student.retry.body')}</p>
        <div>
          <Button variant="primary" onPress={onRetry}>
            {t('student.retry.button')}
          </Button>
        </div>
      </section>
    </main>
  );
}

type OpenState = OpenResult | 'opening' | 'none';

export function StudentApp({ token, open = openLink }: { token: string | null; open?: (token: string) => Promise<OpenResult> }) {
  const [state, setState] = useState<OpenState>(token ? 'opening' : 'none');
  const [attempt, setAttempt] = useState(0);
  // One exchange per attempt, also under StrictMode's double effects.
  const started = useRef(-1);
  useEffect(() => {
    if (!token || started.current === attempt) return;
    started.current = attempt;
    void open(token).then(setState);
  }, [token, attempt, open]);
  const retry = useCallback(() => {
    setState('opening');
    setAttempt((a) => a + 1);
  }, []);
  const [chosen, setChosen] = useState<Locale>(readStudentLocale);
  // The class language decides (S13a, D-099): its main language, or the student's pick when the class has two.
  const [classLang, setClassLang] = useState<ClassLanguage | null>(null);
  const locale = classLang ? displayLocale(classLang, chosen) : chosen;
  useEffect(() => setDisplay({ locale }), [locale]);
  const change = (l: Locale) => {
    setChosen(l);
    saveLocale(l);
  };
  const onLanguage = useCallback((l: ClassLanguage) => setClassLang((old) => (old && old.mainLanguage === l.mainLanguage && old.secondLanguageEnabled === l.secondLanguageEnabled ? old : l)), []);
  return (
    <I18nProvider locale={locale}>
      <ThemeBackdrop />
      {!classLang || classLang.secondLanguageEnabled ? (
        <div className="cc-student__bar">
          <LanguageSwitch locale={locale} onChange={change} />
        </div>
      ) : null}
      {state === 'opening' ? null : state === 'invalid' ? <LinkGone /> : state === 'retry' ? <TryAgain onRetry={retry} /> : <Page onLanguage={onLanguage} />}
      <Toaster />
      {/* The student's own new badges are celebrated on their page (S13c, D-122). */}
      <CelebrationLayer />
    </I18nProvider>
  );
}
