/**
 * Student avatars (S13c items 9 and 11, D-124, D-125): a core module (always on). The student's own
 * avatar rides on `/api/student/page` (links module); this module serves the student's save, the
 * classroom directory (every card, list and reveal) and the teacher's lock, fallback and reset.
 */
import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/avatars.ts';
import type { AppDeps } from '../../lib/context.ts';
import { rawRoute, route } from '../../lib/http.ts';
import { defineServerModule } from '../manifest.ts';
import * as svc from './service.ts';
import * as pic from './pictures.ts';

/** Picture uploads are decoded and re-encoded: at most 20 per minute per address (and 10 per hour per student in the service). */
const PICTURE_RATE = { max: 20, timeWindow: '1 minute' };
const ok = { ok: true as const };

function registerAvatarRoutes(app: FastifyInstance, deps: AppDeps) {
  route(app, deps, C.classroomAvatars, (ctx) => svc.classroomAvatars(ctx));
  route(app, deps, C.studentSetAvatar, (ctx, input) => svc.setOwnAvatar(ctx, input));
  route(app, deps, C.resetStudentAvatar, (ctx, input) => svc.resetAvatar(ctx, input.studentId));
  route(app, deps, C.getAvatarSettings, (ctx, input) => svc.getSettings(ctx, input.classId));
  route(app, deps, C.setAvatarSettings, (ctx, input) => svc.setSettings(ctx, input));
  // S24 (D-184): students' own pictures.
  rawRoute(app, deps, C.studentUploadPicture, (ctx, _input, { req }) => pic.uploadPicture(ctx, req), { rateLimit: PICTURE_RATE });
  route(app, deps, C.studentRemovePicture, (ctx, input) => pic.removeOwnPicture(ctx, input.which));
  rawRoute(app, deps, C.studentPictureImage, (ctx, input, { reply }) => pic.serveStudentPicture(ctx, reply, input.pictureId));
  rawRoute(app, deps, C.classroomPictureImage, (ctx, input, { reply }) => pic.serveClassroomPicture(ctx, reply, input.studentId));
  // Teachers decide for students in their classes, administrators for every student (the same service).
  for (const side of [
    { list: C.teacherPictures, approve: C.teacherApprovePicture, refuse: C.teacherRefusePicture, remove: C.teacherRemovePicture, image: C.teacherPictureImage },
    { list: C.adminPictures, approve: C.adminApprovePicture, refuse: C.adminRefusePicture, remove: C.adminRemovePicture, image: C.adminPictureImage },
  ]) {
    route(app, deps, side.list, (ctx) => pic.listPictures(ctx));
    route(app, deps, side.approve, async (ctx, input) => (await pic.approvePicture(ctx, input.pictureId, input.confirm), ok));
    route(app, deps, side.refuse, async (ctx, input) => (await pic.refusePicture(ctx, input.pictureId, input.reason), ok));
    route(app, deps, side.remove, async (ctx, input) => (await pic.removePicture(ctx, input.pictureId), ok));
    rawRoute(app, deps, side.image, (ctx, input, { reply }) => pic.serveDeciderPicture(ctx, reply, input.pictureId));
  }
  route(app, deps, C.teacherPictureCount, (ctx) => pic.pictureCount(ctx));
  route(app, deps, C.adminDeleteAllPictures, (ctx, input) => pic.deleteAllPictures(ctx, input.confirm));
}

export const avatarsManifest = defineServerModule({ key: 'avatars', policyKey: null, routes: registerAvatarRoutes });
