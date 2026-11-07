/**
 * Routine templates (RTN-2, teacher area). The routine service lives next to the lesson lifecycle
 * (`lessons/routines.ts`) because a lesson snapshots its routine when it starts (D-047); this module
 * owns the template endpoints and the `routines` policy key.
 */
import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/lessons.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import * as routines from '../lessons/routines.ts';

export function registerRoutineRoutes(app: FastifyInstance, deps: AppDeps) {
  route(app, deps, C.listRoutineTemplates, (ctx) => routines.listTemplates(ctx));
  route(app, deps, C.createRoutineTemplate, (ctx, input) => routines.createTemplate(ctx, input));
  route(app, deps, C.updateRoutineTemplate, (ctx, input) => routines.updateTemplate(ctx, input));
  route(app, deps, C.archiveRoutineTemplate, (ctx, input) => routines.archiveTemplate(ctx, input.templateId));
  route(app, deps, C.setContextRoutine, (ctx, input) => routines.setContextRoutine(ctx, input.contextId, input.templateId));
}
