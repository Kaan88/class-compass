/**
 * Code-based route tree (TanStack Router). Every signed-in area runs `requireSession` in beforeLoad,
 * which fetches `me` fresh from the server on each navigation (PIN-8: no stale lock state from
 * history, refresh or the cache). Sensitive layouts render through SensitiveGate (routes/Lock.tsx).
 */
import { createRootRouteWithContext, createRoute, createRouter, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { queryClient } from './lib/queryClient.ts';
import { enterClassroom } from './lib/session.ts';
import { isUnreachable, restoreOfflineClassroom } from './lib/offlineClassroom.ts';
import { AdminHome, AdminLayout } from './routes/admin/Admin.tsx';
import { ChangePasswordPage, LoginPage, ResetPasswordPage } from './routes/Auth.tsx';
import { ClassroomPage } from './routes/Classroom.tsx';
import { InvitePage, SignInLinkPage } from './routes/SignIn.tsx';
import { OAuthConsentPage, type ConsentSearch } from './routes/OAuthConsent.tsx';
import { AiConnectionReturnPage } from './routes/AiConnections.tsx';
import { homeFor, requireClassroomSession, requireSession, type RouterContext } from './routes/guards.ts';
import { NotFoundPage, RootLayout } from './routes/Root.tsx';
import { allTeacherPages } from './modules/registry.ts';
import type { TeacherPageSearch } from './modules/types.ts';
import { ProfilePage, TeacherLayout, TeacherMenu, TeacherPageView } from './routes/teacher/Teacher.tsx';

/*
 * Administration screens and the component catalogue are code-split (D-038): they are only used on
 * an office computer with a network, while the classroom and teacher area stay in the main bundle
 * so they keep working when the connection drops mid-lesson.
 */
const school = () => import('./routes/admin/School.tsx');
const UsersPage = lazyRouteComponent(() => import('./routes/admin/Users.tsx'), 'UsersPage');
const SettingsPage = lazyRouteComponent(school, 'SettingsPage');
const YearsPage = lazyRouteComponent(school, 'YearsPage');
const SubjectsPage = lazyRouteComponent(school, 'SubjectsPage');
const ClassesPage = lazyRouteComponent(school, 'ClassesPage');
const AssignmentsPage = lazyRouteComponent(school, 'AssignmentsPage');
const ModulesPage = lazyRouteComponent(school, 'ModulesPage');
const AdminStudentsPage = lazyRouteComponent(() => import('./routes/admin/StudentsAdmin.tsx'), 'AdminStudentsPage');
const AdminImportPage = lazyRouteComponent(() => import('./routes/admin/ImportAdmin.tsx'), 'AdminImportPage');
const SuperSpeakersPage = lazyRouteComponent(() => import('./routes/admin/SuperSpeakers.tsx'), 'SuperSpeakersPage');
const HolidaysPage = lazyRouteComponent(() => import('./routes/admin/Holidays.tsx'), 'HolidaysPage');
const AuditPage = lazyRouteComponent(() => import('./routes/admin/Audit.tsx'), 'AuditPage');
const ThemesPage = lazyRouteComponent(() => import('./routes/admin/Themes.tsx'), 'ThemesPage');
const AiToolsAdminPage = lazyRouteComponent(() => import('./routes/admin/AiToolsAdmin.tsx'), 'AiToolsAdminPage');
const MaintenancePage = lazyRouteComponent(() => import('./routes/admin/Maintenance.tsx'), 'MaintenancePage');
const AdminReportsPage = lazyRouteComponent(() => import('./routes/admin/Maintenance.tsx'), 'AdminReportsPage');
const CatalogPage = lazyRouteComponent(() => import('./dev/Catalog.tsx'), 'CatalogPage');
const AvatarSheetPage = lazyRouteComponent(() => import('./dev/AvatarSheet.tsx'), 'AvatarSheetPage');
// User guides (Help): bundled Markdown, loaded only when opened.
const HelpPage = lazyRouteComponent(() => import('./help/HelpPage.tsx'), 'HelpPage');

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async ({ context, location }) => {
    // Offline with this device's classroom copy (S26b, D-190): straight to the classroom.
    const { me, offline } = await requireClassroomSession({ context, location });
    throw redirect({ to: offline ? '/classroom' : homeFor(me) });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  /** `mode`: open the "forgot password" or "email me a link" form at once (from an expired link's page). */
  validateSearch: (s: Record<string, unknown>): { next?: string | undefined; mode?: 'forgot' | 'email-link' | undefined } => ({
    next: typeof s.next === 'string' ? s.next : undefined,
    mode: s.mode === 'forgot' || s.mode === 'email-link' ? s.mode : undefined,
  }),
  component: LoginPage,
});

const resetRoute = createRoute({ getParentRoute: () => rootRoute, path: '/reset-password', component: ResetPasswordPage });

const inviteRoute = createRoute({ getParentRoute: () => rootRoute, path: '/invite', component: InvitePage });
const signInLinkRoute = createRoute({ getParentRoute: () => rootRoute, path: '/signin-link', component: SignInLinkPage });

const changePasswordRoute = createRoute({ getParentRoute: () => rootRoute, path: '/change-password', beforeLoad: requireSession, component: ChangePasswordPage });

/**
 * Entering the classroom view (re)engages classroom mode = PIN lock on this device (PIN-6). With no
 * connection it opens from this device's last classroom data (S26b, D-190), always PIN-locked.
 */
const classroomRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/classroom',
  beforeLoad: async ({ context, location }) => {
    const { me, offline } = await requireClassroomSession({ context, location });
    if (me.role === 'admin') throw redirect({ to: '/admin' });
    if (offline) return { me };
    if (me.hasPin) {
      try {
        await enterClassroom(context.queryClient);
      } catch (err) {
        // The connection dropped between the two calls: the copy is PIN-locked anyway.
        if (!isUnreachable(err) || !(await restoreOfflineClassroom(context.queryClient))) throw err;
      }
    }
    return { me };
  },
  component: ClassroomPage,
});

const teacherRoute = createRoute({ getParentRoute: () => rootRoute, path: '/teacher', beforeLoad: requireSession, component: TeacherLayout });
const teacherIndex = createRoute({ getParentRoute: () => teacherRoute, path: '/', component: TeacherMenu });
/**
 * Teacher-area pages come from the client module manifests (D-069): `/teacher/$page` renders the
 * manifest page with that path (inside TeacherLayout, so behind the PIN gate) or "not found".
 * Link to one with `<Link to="/teacher/$page" params={{ page: 'counters' }}>`.
 */
const teacherPage = createRoute({
  getParentRoute: () => teacherRoute,
  path: '$page',
  // Pages read their (string) search parameters as `search` (e.g. a preselected item id).
  validateSearch: (s: Record<string, unknown>): TeacherPageSearch => Object.fromEntries(Object.entries(s).filter((e): e is [string, string] => typeof e[1] === 'string')),
  component: function TeacherPageRoute() {
    const { page } = teacherPage.useParams();
    const search = teacherPage.useSearch();
    const found = allTeacherPages().find((p) => p.path === page);
    if (!found) return <NotFoundPage />;
    // A page whose module is off in all the teacher's classes shows an empty state (S14e3, D-156).
    return <TeacherPageView key={page} page={found} search={search} />;
  },
});

const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: '/admin', beforeLoad: requireSession, component: AdminLayout });
const adminIndex = createRoute({ getParentRoute: () => adminRoute, path: '/', component: AdminHome });
const adminUsers = createRoute({ getParentRoute: () => adminRoute, path: 'users', component: UsersPage });
const adminSettings = createRoute({ getParentRoute: () => adminRoute, path: 'settings', component: SettingsPage });
const adminYears = createRoute({ getParentRoute: () => adminRoute, path: 'years', component: YearsPage });
const adminHolidays = createRoute({ getParentRoute: () => adminRoute, path: 'holidays', component: HolidaysPage });
const adminSubjects = createRoute({ getParentRoute: () => adminRoute, path: 'subjects', component: SubjectsPage });
const adminClasses = createRoute({
  getParentRoute: () => adminRoute,
  path: 'classes',
  // `?new=1` opens "New class" straight away (admin home quick action, S13b).
  validateSearch: (s: Record<string, unknown>): { new?: 1 | undefined } => ({ new: s.new === 1 || s.new === '1' ? 1 : undefined }),
  component: ClassesPage,
});
const adminAssignments = createRoute({ getParentRoute: () => adminRoute, path: 'assignments', component: AssignmentsPage });
const adminModules = createRoute({ getParentRoute: () => adminRoute, path: 'modules', component: ModulesPage });
const adminStudents = createRoute({ getParentRoute: () => adminRoute, path: 'students', component: AdminStudentsPage });
const adminImport = createRoute({ getParentRoute: () => adminRoute, path: 'import', component: AdminImportPage });
const adminSpeakers = createRoute({ getParentRoute: () => adminRoute, path: 'super-speakers', component: SuperSpeakersPage });
const adminAudit = createRoute({ getParentRoute: () => adminRoute, path: 'audit', component: AuditPage });
const adminThemes = createRoute({ getParentRoute: () => adminRoute, path: 'themes', component: ThemesPage });
const adminAiTools = createRoute({ getParentRoute: () => adminRoute, path: 'ai-tools', component: AiToolsAdminPage });
const adminReports = createRoute({
  getParentRoute: () => adminRoute,
  path: 'reports',
  // The tab and the report's deep link (S14e1, D-153): string parameters only.
  validateSearch: (s: Record<string, unknown>): Readonly<Record<string, string>> => Object.fromEntries(Object.entries(s).filter((e): e is [string, string] => typeof e[1] === 'string')),
  component: AdminReportsPage,
});
const adminMaintenance = createRoute({ getParentRoute: () => adminRoute, path: 'maintenance', component: MaintenancePage });
const adminProfile = createRoute({ getParentRoute: () => adminRoute, path: 'profile', component: ProfilePage });

/**
 * Help: the bundled user guides (docs/guides), read-only, `?guide=<id>&lang=<en|tr>`. Signed-in
 * accounts only; the guides hold nothing sensitive, so it is outside the PIN gate.
 */
const helpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/help',
  validateSearch: (s: Record<string, unknown>): { guide?: string | undefined; lang?: 'en' | 'tr' | undefined } => ({
    guide: typeof s.guide === 'string' ? s.guide : undefined,
    lang: s.lang === 'en' || s.lang === 'tr' ? s.lang : undefined,
  }),
  beforeLoad: requireSession,
  component: HelpPage,
});

/**
 * OAuth consent for AI apps (S14h2, D-160): `?request=<id>` needs a session (sign-in first, then back
 * here through `next`) and the PIN unlock in classroom mode (ConsentGate); `?error=<code>` is the page
 * the authorize step shows instead of redirecting anywhere.
 */
const oauthConsentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/oauth/consent',
  validateSearch: (s: Record<string, unknown>): ConsentSearch => ({
    request: typeof s.request === 'string' ? s.request : undefined,
    error: typeof s.error === 'string' ? s.error : undefined,
  }),
  beforeLoad: async ({ context, location, search }) => {
    if (!search.error) await requireSession({ context, location });
  },
  component: function OAuthConsentRoute() {
    return <OAuthConsentPage search={oauthConsentRoute.useSearch()} />;
  },
});

/**
 * Where a provider's sign-in returns (S19a, D-179): `?state=…&code=…`, used only by a POST after a
 * button press; behind the PIN lock in classroom mode.
 */
const aiConnectionReturnRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ai-connections/return',
  validateSearch: (s: Record<string, unknown>): { state?: string | undefined; code?: string | undefined } => ({
    state: typeof s.state === 'string' ? s.state : undefined,
    code: typeof s.code === 'string' ? s.code : undefined,
  }),
  beforeLoad: requireSession,
  component: function AiConnectionReturnRoute() {
    const search = aiConnectionReturnRoute.useSearch();
    return <AiConnectionReturnPage state={search.state} code={search.code} />;
  },
});

/** Component catalog: signed-in users only; fictional data only. */
const catalogRoute = createRoute({ getParentRoute: () => rootRoute, path: '/dev/catalog', beforeLoad: requireSession, component: CatalogPage });
/** Avatar review sheets (S17c, D-169): signed-in users only; catalogue keys only. */
const avatarSheetRoute = createRoute({ getParentRoute: () => rootRoute, path: '/dev/avatars', beforeLoad: requireSession, component: AvatarSheetPage });

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  resetRoute,
  inviteRoute,
  signInLinkRoute,
  changePasswordRoute,
  classroomRoute,
  teacherRoute.addChildren([teacherIndex, teacherPage]),
  adminRoute.addChildren([adminIndex, adminUsers, adminSettings, adminYears, adminHolidays, adminSubjects, adminClasses, adminAssignments, adminModules, adminStudents, adminImport, adminReports, adminSpeakers, adminThemes, adminAiTools, adminMaintenance, adminAudit, adminProfile]),
  helpRoute,
  oauthConsentRoute,
  aiConnectionReturnRoute,
  catalogRoute,
  avatarSheetRoute,
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: false,
  // Route data is never cached by the router: guards must run against the server every time.
  defaultStaleTime: 0,
  defaultGcTime: 0,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

