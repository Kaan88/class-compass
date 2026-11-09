import type { FastifyInstance } from 'fastify';
import { studentPage } from '../../../shared/contracts/goals.ts';
import * as C from '../../../shared/contracts/links.ts';
import type { AppDeps } from '../../lib/context.ts';
import { currentStudentLinkId, route, STUDENT_SESSION_ABSOLUTE_MS, studentCookieName } from '../../lib/http.ts';
import { onStudentCreated } from '../students/service.ts';
import { studentPage as buildStudentPage } from './page.ts';
import * as svc from './service.ts';

/**
 * Outer bound on exchange requests per minute per address (STU-4): several classes behind one school
 * network can open their links in the same minute. Refused tokens are limited much more tightly in the
 * service (`EXCHANGE_FREE_FAILURES`), and valid ones never count towards that.
 */
const EXCHANGE_RATE = { max: 300, timeWindow: '1 minute' };

export function registerLinkRoutes(app: FastifyInstance, deps: AppDeps) {
  // Permanent links (D-115): every new student gets one at once; active students without one get it now.
  onStudentCreated(svc.linkForNewStudent);
  svc.backfillLinks(deps);

  route(
    app,
    deps,
    C.exchangeStudentLink,
    (ctx, input, { req, reply }) => {
      // A device that already holds a live session for this link is not a new device (D-155).
      const { token } = svc.exchangeToken(ctx, ctx.ip, input.token, currentStudentLinkId(deps, req));
      // A separate, strict cookie (STU-4): never sent on cross-site requests, not readable by scripts.
      reply.setCookie(studentCookieName(deps), token, {
        path: '/',
        httpOnly: true,
        secure: deps.config.isProd,
        sameSite: 'strict',
        maxAge: Math.floor(STUDENT_SESSION_ABSOLUTE_MS / 1000),
      });
      return { ok: true as const };
    },
    { rateLimit: EXCHANGE_RATE },
  );
  route(app, deps, C.leaveStudentSession, (ctx, _i, { reply }) => {
    svc.endStudentSession(ctx);
    reply.clearCookie(studentCookieName(deps), { path: '/' });
    return { ok: true as const };
  });
  route(app, deps, studentPage, (ctx) => buildStudentPage(ctx));

  // Teacher area (PIN-gated in classroom mode): show and print; emergency actions only (D-118).
  route(app, deps, C.classLinks, (ctx, input) => svc.classLinks(ctx, input.classId));
  route(app, deps, C.teacherEmergencyLink, (ctx, input) => svc.emergencyLink(ctx, input));
  // Administrators: the student's link on the admin student page, and the same emergency actions.
  route(app, deps, C.adminStudentLink, (ctx, input) => svc.adminLink(ctx, input.studentId));
  route(app, deps, C.adminEmergencyLink, (ctx, input) => svc.emergencyLink(ctx, input));
}
