import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/counters.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import { getClass } from '../school/policy.ts';
import { registerLessonStateContributor } from '../lessons/service.ts';
import { isModuleEnabled } from '../school/modules.ts';
import './commands.ts';
import * as svc from './service.ts';

// Counter bars and weekly counts ride on the polled lesson state (D-045, CNT-2/3).
registerLessonStateContributor({
  key: 'counters',
  stamp: (ctx, context) => {
    if (!isModuleEnabled(ctx.db, context.id, 'counters')) return 'off';
    // First use in an English class+subject creates the English preset (CNT-1).
    svc.ensureDefaultCounters(ctx, context, getClass(ctx.db, context.classId));
    return svc.countersStamp(ctx.db, context.id);
  },
  body: (ctx, context, lesson) => {
    if (!lesson || !isModuleEnabled(ctx.db, context.id, 'counters')) return null;
    return svc.countersLessonState(ctx, context, getClass(ctx.db, context.classId), lesson);
  },
});

export function registerCounterRoutes(app: FastifyInstance, deps: AppDeps) {
  route(app, deps, C.listCounters, (ctx, input) => svc.listCounters(ctx, input.contextId));
  route(app, deps, C.createCounter, (ctx, input) => svc.createCounter(ctx, input));
  route(app, deps, C.createEnglishPreset, (ctx, input) => svc.createEnglishPreset(ctx, input.contextId));
  route(app, deps, C.updateCounter, (ctx, input) => svc.updateCounter(ctx, input));
  route(app, deps, C.archiveCounter, (ctx, input) => svc.setCounterArchived(ctx, input.counterId, true));
  route(app, deps, C.unarchiveCounter, (ctx, input) => svc.setCounterArchived(ctx, input.counterId, false));
  route(app, deps, C.counterHistory, (ctx, input) => svc.counterHistory(ctx, input));
}
