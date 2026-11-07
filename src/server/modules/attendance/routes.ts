import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/lessons.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import './commands.ts';
import * as svc from './service.ts';

export function registerAttendanceRoutes(app: FastifyInstance, deps: AppDeps) {
  route(app, deps, C.getClassAttendance, (ctx, input) => svc.getClassAttendance(ctx, input));
  route(app, deps, C.setClassAttendance, (ctx, input) => svc.setClassAttendance(ctx, input));
  route(app, deps, C.setLessonExceptionTeacher, (ctx, input) => svc.setLessonExceptionTeacher(ctx, input));
  route(app, deps, C.attendanceHistory, (ctx, input) => svc.attendanceHistory(ctx, input));
}
