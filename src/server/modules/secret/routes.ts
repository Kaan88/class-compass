import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/secret.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import { registerAttendanceListener } from '../attendance/service.ts';
import { registerLessonCloseHook, registerLessonStateContributor } from '../lessons/service.ts';
import { isModuleEnabled } from '../school/modules.ts';
import './commands.ts';
import * as svc from './service.ts';

// Counts only (SEC-3): roundExists / requested / selected / shortfall / revealed.
registerLessonStateContributor({
  key: 'secret',
  stamp: (ctx, context, lesson) => (isModuleEnabled(ctx.db, context.id, 'secretStudents') ? svc.secretStamp(ctx.db, context.id, lesson) : 'off'),
  body: (ctx, context, lesson) => (lesson && isModuleEnabled(ctx.db, context.id, 'secretStudents') ? svc.secretLessonState(ctx.db, context.id, lesson) : null),
});
registerAttendanceListener(svc.onAttendanceChange);
registerLessonCloseHook(svc.onLessonClose);

export function registerSecretRoutes(app: FastifyInstance, deps: AppDeps) {
  route(app, deps, C.lessonSecret, (ctx, input) => svc.lessonSecret(ctx, input.lessonId));
  route(app, deps, C.getSecretSettings, (ctx, input) => svc.getSettings(ctx, input.contextId));
  route(app, deps, C.setSecretSettings, (ctx, input) => svc.setSettings(ctx, input.contextId, input.count));
  route(app, deps, C.secretHistory, (ctx, input) => svc.history(ctx, input.contextId));
}
