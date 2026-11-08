/**
 * Student avatars (S13c items 9 and 11, D-124, D-125): a core module (always on). The student's own
 * avatar rides on `/api/student/page` (links module); this module serves the student's save, the
 * classroom directory (every card, list and reveal) and the teacher's lock, fallback and reset.
 */
import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/avatars.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import { defineServerModule } from '../manifest.ts';
import * as svc from './service.ts';

function registerAvatarRoutes(app: FastifyInstance, deps: AppDeps) {
  route(app, deps, C.classroomAvatars, (ctx) => svc.classroomAvatars(ctx));
  route(app, deps, C.studentSetAvatar, (ctx, input) => svc.setOwnAvatar(ctx, input));
  route(app, deps, C.resetStudentAvatar, (ctx, input) => svc.resetAvatar(ctx, input.studentId));
  route(app, deps, C.getAvatarSettings, (ctx, input) => svc.getSettings(ctx, input.classId));
  route(app, deps, C.setAvatarSettings, (ctx, input) => svc.setSettings(ctx, input));
}

export const avatarsManifest = defineServerModule({ key: 'avatars', policyKey: null, routes: registerAvatarRoutes });
