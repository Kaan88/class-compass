import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/homework.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import * as svc from './service.ts';

export function registerHomeworkRoutes(app: FastifyInstance, deps: AppDeps) {
  // Teacher area (PIN-gated in classroom mode).
  route(app, deps, C.listHomework, (ctx, input) => svc.listHomework(ctx, input));
  route(app, deps, C.createHomework, (ctx, input) => svc.createHomework(ctx, input));
  route(app, deps, C.updateHomework, (ctx, input) => svc.updateHomework(ctx, input));
  route(app, deps, C.archiveHomework, (ctx, input) => svc.archiveHomework(ctx, input));
  route(app, deps, C.homeworkCheck, (ctx, input) => svc.teacherCheck(ctx, input.assignmentId));
  route(app, deps, C.setHomeworkMarks, (ctx, input) => svc.setMarks(ctx, input));
  route(app, deps, C.markRemainingHomework, (ctx, input) => svc.markRemaining(ctx, input));
  route(app, deps, C.undoHomeworkMarks, (ctx, input) => svc.undoMarks(ctx, input));
  route(app, deps, C.outstandingHomework, (ctx, input) => svc.outstanding(ctx, input.contextId));
  route(app, deps, C.getHomeworkSettings, (ctx, input) => svc.getSettings(ctx, input.contextId));
  route(app, deps, C.setHomeworkSettings, (ctx, input) => svc.setSettings(ctx, input));
  // Classroom: the homework panel, and checking only when the class allows it (D-075).
  route(app, deps, C.classroomHomework, (ctx, input) => svc.classroomCurrent(ctx, input.contextId));
  route(app, deps, C.classroomHomeworkCheck, (ctx, input) => svc.classroomCheck(ctx, input.assignmentId));
  route(app, deps, C.classroomSetHomeworkMarks, (ctx, input) => svc.setMarks(ctx, input, true));
  route(app, deps, C.classroomMarkRemainingHomework, (ctx, input) => svc.markRemaining(ctx, input, true));
  route(app, deps, C.classroomUndoHomeworkMarks, (ctx, input) => svc.undoMarks(ctx, input, true));
}
