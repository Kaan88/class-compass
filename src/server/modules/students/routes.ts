import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/students.ts';
import { classroomStudentCard } from '../../../shared/contracts/classroomCard.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import * as svc from './service.ts';
import { erasePreview, eraseStudent } from './erase.ts';
import { classroomCard } from './card.ts';

export function registerStudentRoutes(app: FastifyInstance, deps: AppDeps) {
  // classroom & teacher
  route(app, deps, C.classroomRoster, (ctx, input) => svc.classroomRoster(ctx, input.classId));
  // S14e2 (D-154): the positive-only card a tapped name opens on the classroom screen.
  route(app, deps, classroomStudentCard, (ctx, input) => classroomCard(ctx, input.contextId, input.studentId));
  route(app, deps, C.teacherRoster, (ctx, input) => svc.teacherRoster(ctx, input.classId));
  route(app, deps, C.addStudentToClass, (ctx, input) => svc.teacherAddStudent(ctx, input));
  route(app, deps, C.updateStudent, (ctx, input) => svc.teacherUpdateStudent(ctx, input));
  route(app, deps, C.getContextLevels, (ctx, input) => svc.getContextLevels(ctx, input.contextId));
  route(app, deps, C.setContextLevels, (ctx, input) => svc.setContextLevels(ctx, input));
  route(app, deps, C.removeStudentFromClass, (ctx, input) => {
    svc.removeFromClass(ctx, input.classId, input.studentId);
    return { ok: true as const };
  });
  route(app, deps, C.erasePreview, (ctx, input) => erasePreview(ctx, input.studentId));
  route(app, deps, C.eraseStudent, async (ctx, input) => {
    const r = await eraseStudent(ctx, input.studentId, input.confirm);
    return { ok: true as const, files: r.files };
  });

  // admin
  route(app, deps, C.adminListStudents, (ctx, input) => svc.adminListStudents(ctx, input));
  route(app, deps, C.adminGetStudent, (ctx, input) => svc.adminGetStudent(ctx, input.studentId));
  route(app, deps, C.adminAddStudent, (ctx, input) => svc.adminAddStudent(ctx, input));
  route(app, deps, C.deactivateStudent, (ctx, input) => {
    svc.setStudentActive(ctx, input.studentId, false);
    return { ok: true as const };
  });
  route(app, deps, C.reactivateStudent, (ctx, input) => {
    svc.setStudentActive(ctx, input.studentId, true);
    return { ok: true as const };
  });
  route(app, deps, C.moveStudents, (ctx, input) => svc.moveStudents(ctx, input));
  route(app, deps, C.promoteClass, (ctx, input) => svc.promoteClass(ctx, input));
}
