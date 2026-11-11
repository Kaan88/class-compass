/**
 * The personal student page shell (STU-2, UX-2..4): mobile-first, one column, large touch targets.
 * - S14d (D-151, refines D-085): a home screen (avatar, "Hello", a subject switch remembered on this
 *   device, and big tiles: My goals · New goal · How is it going? · Show my work · My achievements ·
 *   My homework · My avatar; a tile shows only when its section exists) and one screen per tile, in
 *   short steps. Screens live in the query string (`nav.ts`), never in the fragment, which carries
 *   the link's token. Every screen change moves the focus to the screen's h1; Back goes back in the
 *   page's own history, or home.
 * - Language: English by default; the EN/TR switch is remembered on this device only (localStorage).
 * - Theme: the student's class theme.
 * - Help sits in the top bar next to the language switch and opens as its own screen.
 * - A refused or revoked link (401) shows a friendly "this link no longer works" page (STU-3). A busy
 *   server (429), a server error or no connection shows "try again" instead: the token is kept in
 *   memory (never stored) so the student can retry without the link, which has left the address bar.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { studentPage, type StudentPage } from '../../shared/contracts/goals.ts';
import { exchangeStudentLink, leaveStudentSession } from '../../shared/contracts/links.ts';
import { pickText, translate, type Locale } from '../../shared/i18n/index.ts';
import { ApiError, call } from '../lib/api.ts';
import { setDisplay } from '../lib/display.ts';
import { I18nProvider, useI18n } from '../lib/i18n.tsx';
import { Button } from '../ui/Button.tsx';
import { Toaster } from '../ui/Feedback.tsx';
import { IconAvatar, IconBack, IconBook, IconGlobe } from '../ui/icons.tsx';
import { Avatar } from '../ui/Students.tsx';
import { ThemeBackdrop, ThemeIllustration } from '../ui/Mascot.tsx';
import { STUDENT_PAGE_KEY } from './keys.ts';
import { CelebrationLayer } from '../themes/Celebration.tsx';
import { useCelebrateNewAchievements } from './AchievementsSection.tsx';
import { AvatarPanel } from './AvatarPanel.tsx';
import { navHref, useStudentNav, type NavApi, type Screen } from './nav.ts';
import { tilesOf, type Tile } from './sections.tsx';
import { displayLocale, type ClassLanguage } from '../../shared/classLanguage.ts';

const LOCALE_KEY = 'cc.studentLocale';
/** The subject chosen on the home screen, remembered on this device (S14d). */
const SUBJECT_KEY = 'cc.studentSubject';
/** The id of every screen's h1: the focus moves there on each screen change. */
export const SCREEN_TITLE_ID = 'student-screen-title';
/** The student and parent guide (docs/guides), loaded only when "Help" is pressed. */
const HelpPanel = lazy(() => import('../help/HelpPanel.tsx'));
// S24 (D-184): "Use my own picture" and its editor are lazy chunks (budget D-151).
const AvatarPictureScreen = lazy(() => import('./AvatarPictureScreen.tsx'));

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

function readSubject(): string | null {
  try {
    return localStorage.getItem(SUBJECT_KEY);
  } catch {
    return null;
  }
}

function saveSubject(id: string) {
  try {
    localStorage.setItem(SUBJECT_KEY, id);
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

/** A tile is a real link to its screen (reload and long-press work); a plain tap stays in the page. */
function TileLink({ screen, subject, label, icon, isNew, go }: { screen: Screen; subject: string | null; label: string; icon: ReactNode; isNew?: boolean; go: NavApi['go'] }) {
  const { t } = useI18n();
  const target = { screen, subject, goal: null, step: 1 };
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(target);
  };
  return (
    <li>
      <a className="cc-menu-tile cc-student-tile" href={navHref(target)} onClick={onClick} data-testid={`student-tile-${screen}`}>
        {icon}
        <span className="cc-student-tile__label">{label}</span>
        {isNew ? <span className="cc-chip cc-chip--success cc-student-tile__new">{t('student.tile.new')}</span> : null}
      </a>
    </li>
  );
}

function Home({ page, subject, tiles, onSubject, go }: { page: StudentPage; subject: StudentPage['subjects'][number] | null; tiles: Tile[]; onSubject: (id: string) => void; go: NavApi['go'] }) {
  const { t, locale } = useI18n();
  const subjectId = subject?.subjectId ?? null;
  return (
    <>
      <header className="cc-row cc-student__head">
        <Avatar
          name={page.student.fullName}
          hue={page.student.avatarHue}
          initials={page.student.initials}
          size="lg"
          spec={page.avatar.spec ?? (page.avatar.fallback === 'generated' ? page.avatar.generated : null)}
          pictureUrl={page.avatar.picture.approvedUrl}
        />
        <div className="cc-stack cc-student__who">
          <h1 id={SCREEN_TITLE_ID} className="cc-h1" tabIndex={-1}>
            {t('student.hello', { name: page.student.fullName })}
          </h1>
          {page.className ? <p className="cc-muted">{t('student.className', { name: page.className })}</p> : null}
        </div>
      </header>
      {page.subjects.length > 1 ? (
        <div className="cc-student__subjects" role="group" aria-label={t('student.home.subject')} data-testid="student-subjects">
          {page.subjects.map((s) => (
            <Button key={s.subjectId} variant={s.subjectId === subjectId ? 'primary' : 'secondary'} aria-pressed={s.subjectId === subjectId} onPress={() => onSubject(s.subjectId)}>
              {pickText(s.name, locale)}
            </Button>
          ))}
        </div>
      ) : null}
      {page.subjects.length === 0 ? <p className="cc-card">{t('student.nothingYet')}</p> : null}
      <nav aria-label={t('student.home.tiles')}>
        <ul className="cc-student-tiles">
          {tiles.map((tile) => (
            <TileLink key={tile.screen} screen={tile.screen} subject={subjectId} label={t(tile.label)} icon={<tile.Icon />} isNew={tile.isNew} go={go} />
          ))}
          <TileLink screen="avatar" subject={subjectId} label={t('student.tile.avatar')} icon={<IconAvatar />} go={go} />
        </ul>
      </nav>
      <footer className="cc-row cc-muted">
        <p>{t('student.privacy')}</p>
        <Button size="small" variant="ghost" onPress={() => void call(leaveStudentSession, {}).finally(() => window.location.reload())}>
          {t('student.leave')}
        </Button>
      </footer>
    </>
  );
}

/** A screen under the home screen: Back, the subject (when there are several) and the screen's h1. */
function ScreenFrame({ title, subjectName, back, children }: { title: string; subjectName: string | null; back: () => void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <>
      <div className="cc-row cc-student__nav">
        <Button onPress={back} data-testid="student-back">
          <IconBack />
          {t('student.back')}
        </Button>
        {subjectName ? <span className="cc-chip">{subjectName}</span> : null}
      </div>
      <h1 id={SCREEN_TITLE_ID} className="cc-h1 cc-student__title" tabIndex={-1}>
        {title}
      </h1>
      {children}
    </>
  );
}

function Page({ onLanguage, nav }: { onLanguage: (l: ClassLanguage) => void; nav: NavApi }) {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: STUDENT_PAGE_KEY, queryFn: () => call(studentPage, {}) });
  useEffect(() => {
    if (q.data) setDisplay({ theme: q.data.theme });
    if (q.data) onLanguage(q.data.language);
  }, [q.data, onLanguage]);
  // New achievements are celebrated on whichever screen the page opens (D-122).
  useCelebrateNewAchievements(
    (q.data?.subjects ?? []).flatMap((s) => s.sections.flatMap((x) => (x.key === 'achievements' ? [{ subjectId: s.subjectId, data: x.data }] : []))),
  );
  // Every screen change (not the first one) starts at the top with the focus on the screen's h1.
  const { screen, step } = nav.nav;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo?.(0, 0);
    document.getElementById(SCREEN_TITLE_ID)?.focus({ preventScroll: true });
  }, [screen, step]);

  if (q.error) return q.error instanceof ApiError && q.error.status === 401 ? <LinkGone /> : <p className="cc-page">{t('common.error')}</p>;
  if (!q.data) return <p className="cc-page cc-muted">{t('common.loading')}</p>;
  const page = q.data;
  const remembered = readSubject();
  const subject = page.subjects.find((s) => s.subjectId === nav.nav.subject) ?? page.subjects.find((s) => s.subjectId === remembered) ?? page.subjects[0] ?? null;
  const tiles = subject ? tilesOf(subject.sections) : [];
  const subjectName = subject && page.subjects.length > 1 ? pickText(subject.name, locale) : null;
  const tile = tiles.find((x) => x.screen === screen);
  let content: ReactNode;
  if (screen === 'help')
    content = (
      <Suspense fallback={<p className="cc-muted">{t('common.loading')}</p>}>
        {/* The guide's h1 is this screen's title; it takes the focus when it has loaded (lazy). */}
        <HelpPanel guide="student" onClose={nav.back} titleId={SCREEN_TITLE_ID} />
      </Suspense>
    );
  else if (screen === 'avatar')
    content = (
      <ScreenFrame title={t('student.tile.avatar')} subjectName={null} back={nav.back}>
        <AvatarPanel info={page.avatar} name={page.student.fullName} titleId={SCREEN_TITLE_ID} onPicture={() => nav.go({ screen: 'avatarPicture', subject: nav.nav.subject })} />
      </ScreenFrame>
    );
  else if (screen === 'avatarPicture' && page.avatar.picture.state !== 'off')
    content = (
      <ScreenFrame title={t('avatar.picture.title')} subjectName={null} back={nav.back}>
        <Suspense fallback={<p className="cc-muted">{t('common.loading')}</p>}>
          <AvatarPictureScreen info={page.avatar.picture} name={page.student.fullName} />
        </Suspense>
      </ScreenFrame>
    );
  else if (tile && subject)
    content = (
      <ScreenFrame title={t(tile.label)} subjectName={subjectName} back={nav.back}>
        {tile.render({ subjectId: subject.subjectId, media: page.media, nav: nav.nav, go: nav.go, finish: nav.finish, titleId: SCREEN_TITLE_ID })}
      </ScreenFrame>
    );
  else
    content = (
      <Home
        page={page}
        subject={subject}
        tiles={tiles}
        go={nav.go}
        onSubject={(id) => {
          saveSubject(id);
          nav.go({ screen: 'home', subject: id }, { replace: true });
        }}
      />
    );
  return (
    <main
      className="cc-page cc-student cc-stack"
      data-testid="student-page"
      data-screen={tile || screen === 'help' || screen === 'avatar' || (screen === 'avatarPicture' && page.avatar.picture.state !== 'off') ? screen : 'home'}
    >
      {content}
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
  const nav = useStudentNav();
  const help = nav.nav.screen === 'help';
  const twoLanguages = !classLang || classLang.secondLanguageEnabled;
  const pageShown = state === 'ok' || state === 'none';
  const onLanguage = useCallback((l: ClassLanguage) => setClassLang((old) => (old && old.mainLanguage === l.mainLanguage && old.secondLanguageEnabled === l.secondLanguageEnabled ? old : l)), []);
  return (
    <I18nProvider locale={locale}>
      <ThemeBackdrop />
      {twoLanguages || (pageShown && !help) ? (
        <div className="cc-student__bar">
          {pageShown && !help ? (
            <Button size="small" onPress={() => nav.go({ screen: 'help', subject: nav.nav.subject })}>
              <IconBook />
              {translate(locale, 'help.link')}
            </Button>
          ) : null}
          {twoLanguages ? <LanguageSwitch locale={locale} onChange={change} /> : null}
        </div>
      ) : null}
      {state === 'opening' ? null : state === 'invalid' ? <LinkGone /> : state === 'retry' ? <TryAgain onRetry={retry} /> : <Page onLanguage={onLanguage} nav={nav} />}
      <Toaster />
      {/* The student's own new achievements are celebrated on their page (S13c, D-122). */}
      <CelebrationLayer />
    </I18nProvider>
  );
}
