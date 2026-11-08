/**
 * Code-based route tree (TanStack Router). Every signed-in area runs `requireSession` in beforeLoad,
 * which fetches `me` fresh from the server on each navigation (PIN-8: no stale lock state from
 * history, refresh or the cache). Sensitive layouts render through SensitiveGate (routes/Lock.tsx).
 */
import { createRootRouteWithContext, createRoute, createRouter, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { queryClient } from './lib/queryClient.ts';
import { enterClassroom } from './lib/session.ts';
import { AdminHome, AdminLayout } from './routes/admin/Admin.tsx';
import { ChangePasswordPage, LoginPage, ResetPasswordPage } from './routes/Auth.tsx';
import { ClassroomPage } from './routes/Classroom.tsx';
import { InvitePage, SignInLinkPage } from './routes/SignIn.tsx';
import { homeFor, requireSession, type RouterContext } from './routes/guards.ts';
import { NotFoundPage, RootLayout } from './routes/Root.tsx';
import { allTeacherPages } from './modules/registry.ts';
import type { TeacherPageSearch } from './modules/types.ts';
import { ProfilePage, TeacherLayout, TeacherMenu } from './routes/teacher/Teacher.tsx';

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
const SuperSpeakersPage = lazyRouteComponent(() => import('./routes/admin/SuperSpeakers.tsx'), 'SuperSpeakersPage');
const AuditPage = lazyRouteComponent(() => import('./routes/admin/Audit.tsx'), 'AuditPage');
const MaintenancePage = lazyRouteComponent(() => import('./routes/admin/Maintenance.tsx'), 'MaintenancePage');
const AdminReportsPage = lazyRouteComponent(() => import('./routes/admin/Maintenance.tsx'), 'AdminReportsPage');
const CatalogPage = lazyRouteComponent(() => import('./dev/Catalog.tsx'), 'CatalogPage');
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
    const { me } = await requireSession({ context, location });
    throw redirect({ to: homeFor(me) });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (s: Record<string, unknown>): { next?: string | undefined } => ({ next: typeof s.next === 'string' ? s.next : undefined }),
  component: LoginPage,
});

const resetRoute = createRoute({ getParentRoute: () => rootRoute, path: '/reset-password', component: ResetPasswordPage });

const inviteRoute = createRoute({ getParentRoute: () => rootRoute, path: '/invite', component: InvitePage });
const signInLinkRoute = createRoute({ getParentRoute: () => rootRoute, path: '/signin-link', component: SignInLinkPage });

const changePasswordRoute = createRoute({ getParentRoute: () => rootRoute, path: '/change-password', beforeLoad: requireSession, component: ChangePasswordPage });

/** Entering the classroom view (re)engages classroom mode = PIN lock on this device (PIN-6). */
const classroomRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/classroom',
  beforeLoad: async ({ context, location }) => {
    const { me } = await requireSession({ context, location });
    if (me.role === 'admin') throw redirect({ to: '/admin' });
    if (me.hasPin) await enterClassroom(context.queryClient);
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
    const Page = found.Component;
    return <Page key={page} search={search} />;
  },
});

const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: '/admin', beforeLoad: requireSession, component: AdminLayout });
const adminIndex = createRoute({ getParentRoute: () => adminRoute, path: '/', component: AdminHome });
const adminUsers = createRoute({ getParentRoute: () => adminRoute, path: 'users', component: UsersPage });
const adminSettings = createRoute({ getParentRoute: () => adminRoute, path: 'settings', component: SettingsPage });
const adminYears = createRoute({ getParentRoute: () => adminRoute, path: 'years', component: YearsPage });
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
const adminSpeakers = createRoute({ getParentRoute: () => adminRoute, path: 'super-speakers', component: SuperSpeakersPage });
const adminAudit = createRoute({ getParentRoute: () => adminRoute, path: 'audit', component: AuditPage });
const adminReports = createRoute({ getParentRoute: () => adminRoute, path: 'reports', component: AdminReportsPage });
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

/** Component catalog: signed-in users only; fictional data only. */
const catalogRoute = createRoute({ getParentRoute: () => rootRoute, path: '/dev/catalog', beforeLoad: requireSession, component: CatalogPage });

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  resetRoute,
  inviteRoute,
  signInLinkRoute,
  changePasswordRoute,
  classroomRoute,
  teacherRoute.addChildren([teacherIndex, teacherPage]),
  adminRoute.addChildren([adminIndex, adminUsers, adminSettings, adminYears, adminSubjects, adminClasses, adminAssignments, adminModules, adminStudents, adminReports, adminSpeakers, adminMaintenance, adminAudit, adminProfile]),
  helpRoute,
  catalogRoute,
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

