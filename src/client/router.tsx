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
import { homeFor, requireSession, type RouterContext } from './routes/guards.ts';
import { NotFoundPage, RootLayout } from './routes/Root.tsx';
import { AttendancePage } from './routes/teacher/Attendance.tsx';
import { ClassSettingsPage, TeacherStudentsPage } from './routes/teacher/Classes.tsx';
import { RoutinesPage } from './routes/teacher/Routines.tsx';
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
const AuditPage = lazyRouteComponent(() => import('./routes/admin/Audit.tsx'), 'AuditPage');
const CatalogPage = lazyRouteComponent(() => import('./dev/Catalog.tsx'), 'CatalogPage');

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
const teacherProfile = createRoute({ getParentRoute: () => teacherRoute, path: 'profile', component: ProfilePage });
const teacherClasses = createRoute({ getParentRoute: () => teacherRoute, path: 'classes', component: ClassSettingsPage });
const teacherStudents = createRoute({ getParentRoute: () => teacherRoute, path: 'students', component: TeacherStudentsPage });
const teacherAttendance = createRoute({ getParentRoute: () => teacherRoute, path: 'attendance', component: AttendancePage });
const teacherRoutines = createRoute({ getParentRoute: () => teacherRoute, path: 'routines', component: RoutinesPage });

const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: '/admin', beforeLoad: requireSession, component: AdminLayout });
const adminIndex = createRoute({ getParentRoute: () => adminRoute, path: '/', component: AdminHome });
const adminUsers = createRoute({ getParentRoute: () => adminRoute, path: 'users', component: UsersPage });
const adminSettings = createRoute({ getParentRoute: () => adminRoute, path: 'settings', component: SettingsPage });
const adminYears = createRoute({ getParentRoute: () => adminRoute, path: 'years', component: YearsPage });
const adminSubjects = createRoute({ getParentRoute: () => adminRoute, path: 'subjects', component: SubjectsPage });
const adminClasses = createRoute({ getParentRoute: () => adminRoute, path: 'classes', component: ClassesPage });
const adminAssignments = createRoute({ getParentRoute: () => adminRoute, path: 'assignments', component: AssignmentsPage });
const adminModules = createRoute({ getParentRoute: () => adminRoute, path: 'modules', component: ModulesPage });
const adminStudents = createRoute({ getParentRoute: () => adminRoute, path: 'students', component: AdminStudentsPage });
const adminAudit = createRoute({ getParentRoute: () => adminRoute, path: 'audit', component: AuditPage });
const adminProfile = createRoute({ getParentRoute: () => adminRoute, path: 'profile', component: ProfilePage });

/** Component catalog: signed-in users only; fictional data only. */
const catalogRoute = createRoute({ getParentRoute: () => rootRoute, path: '/dev/catalog', beforeLoad: requireSession, component: CatalogPage });

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  resetRoute,
  changePasswordRoute,
  classroomRoute,
  teacherRoute.addChildren([teacherIndex, teacherProfile, teacherClasses, teacherStudents, teacherAttendance, teacherRoutines]),
  adminRoute.addChildren([adminIndex, adminUsers, adminSettings, adminYears, adminSubjects, adminClasses, adminAssignments, adminModules, adminStudents, adminAudit, adminProfile]),
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

