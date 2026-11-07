import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../lib/context.ts';
import { registerAdminRoutes } from './admin/routes.ts';
import { registerAuthRoutes } from './auth/routes.ts';
import { registerSchoolRoutes } from './school/routes.ts';
import { registerStudentRoutes } from './students/routes.ts';

/**
 * Module registry. Each module exposes `register<Module>Routes(app, deps)` and may define commands
 * (via defineCommand) at import time. Add new modules here.
 */
export function registerModules(app: FastifyInstance, deps: AppDeps) {
  registerAuthRoutes(app, deps);
  registerAdminRoutes(app, deps);
  registerSchoolRoutes(app, deps);
  registerStudentRoutes(app, deps);
}
