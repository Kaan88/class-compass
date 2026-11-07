import type { FastifyInstance } from 'fastify';
import { studentPage } from '../../../shared/contracts/goals.ts';
import * as C from '../../../shared/contracts/links.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route, STUDENT_SESSION_ABSOLUTE_MS, studentCookieName } from '../../lib/http.ts';
import { studentPage as buildStudentPage } from './page.ts';
import * as svc from './service.ts';

/** Token exchanges per minute per address (STU-4): enough for a class on one school network, too few to guess. */
const EXCHANGE_RATE = { max: 30, timeWindow: '1 minute' };

export function registerLinkRoutes(app: FastifyInstance, deps: AppDeps) {
  route(
    app,
    deps,
    C.exchangeStudentLink,
    (ctx, input, { reply }) => {
      const { token } = svc.exchangeToken(ctx, input.token);
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

  // Teacher area (PIN-gated in classroom mode).
  route(app, deps, C.classLinks, (ctx, input) => svc.classLinks(ctx, input.classId));
  route(app, deps, C.generateStudentLink, (ctx, input) => svc.generateForStudent(ctx, input.studentId));
  route(app, deps, C.generateClassLinks, (ctx, input) => svc.generateForClass(ctx, input));
  route(app, deps, C.revokeStudentLink, (ctx, input) => {
    svc.revokeForStudent(ctx, input.studentId);
    return { ok: true as const };
  });
  route(app, deps, C.revokeClassLinks, (ctx, input) => svc.revokeForClass(ctx, input.classId));
}
