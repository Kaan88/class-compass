import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/textChecks.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import * as svc from './service.ts';

export function registerTextCheckRoutes(app: FastifyInstance, deps: AppDeps) {
  route(app, deps, C.adminTextChecks, (ctx) => svc.adminView(ctx.db));
  route(app, deps, C.setAdminTextChecks, (ctx, input) => svc.adminSet(ctx, input));
  route(app, deps, C.teacherTextWords, (ctx) => svc.teacherWords(ctx));
  route(app, deps, C.setTeacherTextWords, (ctx, input) => svc.setTeacherWords(ctx, input));
  route(app, deps, C.blockedTextNotice, (ctx, input) => svc.notice(ctx, input.contextId));
  route(app, deps, C.setBlockedTextNotice, (ctx, input) => svc.setNotice(ctx, input));
  route(app, deps, C.hideStudentText, (ctx, input) => svc.hide(ctx, input));
}
