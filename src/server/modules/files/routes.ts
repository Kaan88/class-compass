import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/files.ts';
import type { AppDeps } from '../../lib/context.ts';
import { AppError, invalid } from '../../lib/errors.ts';
import { rawRoute, route } from '../../lib/http.ts';
import { teacherSeesStudent } from '../students/service.ts';
import { removeStudentPhoto, serveClassroomPhoto, uploadStudentPhoto } from './photos.ts';
import { assertCanDeleteFile, assertCanReadFile, assertMediaAllowed, deleteFileRow, fileMeta, ingestUpload, sendFile } from './service.ts';

/** Uploads are expensive (sniffing, re-encoding): at most 60 per minute per address. */
const UPLOAD_RATE = { max: 60, timeWindow: '1 minute' };

export function registerFileRoutes(app: FastifyInstance, deps: AppDeps) {
  rawRoute(
    app,
    deps,
    C.uploadFile,
    async (ctx, input, { req }) => {
      if (input.kind === 'import_source') {
        if (input.ownerStudentId) throw invalid('A student list does not belong to a student', { reason: 'OWNER_NOT_ALLOWED' });
        assertMediaAllowed(ctx.db, input.kind, 'import');
        return fileMeta(await ingestUpload(ctx, req, { kind: input.kind, ownerStudentId: null }));
      }
      // Evidence files (image/document/audio) belong to a student: media flag first (D-014), then the class rule.
      assertMediaAllowed(ctx.db, input.kind, 'evidence');
      if (!input.ownerStudentId) throw invalid('Choose the student this file belongs to', { reason: 'OWNER_REQUIRED' });
      if (ctx.user?.role !== 'admin' && !teacherSeesStudent(ctx, input.ownerStudentId)) throw new AppError('FORBIDDEN', 'This student is not in a class you teach');
      return fileMeta(await ingestUpload(ctx, req, { kind: input.kind, ownerStudentId: input.ownerStudentId }));
    },
    { rateLimit: UPLOAD_RATE },
  );
  rawRoute(app, deps, C.getFile, async (ctx, input, { req, reply }) => sendFile(ctx, req, reply, assertCanReadFile(ctx, input.fileId), { thumb: input.thumb ?? false }));
  route(app, deps, C.getFileMeta, (ctx, input) => fileMeta(assertCanReadFile(ctx, input.fileId)));
  route(app, deps, C.deleteFile, async (ctx, input) => {
    await deleteFileRow(ctx, assertCanDeleteFile(ctx, input.fileId));
    return { ok: true as const };
  });

  rawRoute(app, deps, C.uploadStudentPhoto, (ctx, input, { req }) => uploadStudentPhoto(ctx, req, input), { rateLimit: UPLOAD_RATE });
  route(app, deps, C.removeStudentPhoto, async (ctx, input) => {
    await removeStudentPhoto(ctx, input.studentId);
    return { ok: true as const };
  });
  rawRoute(app, deps, C.classroomStudentPhoto, (ctx, input, { req, reply }) => serveClassroomPhoto(ctx, req, reply, input.studentId));
}
