import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/school.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import * as svc from './service.ts';

export function registerSchoolRoutes(app: FastifyInstance, deps: AppDeps) {
  // settings
  route(app, deps, C.getSettings, (ctx) => svc.settingsDto(ctx));
  route(app, deps, C.updateSettings, (ctx, input) => svc.updateSettings(ctx, input));

  // years & terms
  route(app, deps, C.listYears, (ctx) => ({ years: svc.listYears(ctx.db) }));
  route(app, deps, C.createYear, (ctx, input) => svc.createYear(ctx, input));
  route(app, deps, C.updateYear, (ctx, input) => svc.updateYear(ctx, input));
  route(app, deps, C.archiveYear, (ctx, input) => svc.setYearArchived(ctx, input.yearId, true));
  route(app, deps, C.unarchiveYear, (ctx, input) => svc.setYearArchived(ctx, input.yearId, false));
  route(app, deps, C.createTerm, (ctx, input) => svc.createTerm(ctx, input));
  route(app, deps, C.updateTerm, (ctx, input) => svc.updateTerm(ctx, input));
  route(app, deps, C.deleteTerm, (ctx, input) => {
    svc.deleteTerm(ctx, input.termId);
    return { ok: true as const };
  });

  // subjects
  route(app, deps, C.listSubjects, (ctx, input) => ({ subjects: svc.listSubjects(ctx.db, input.includeArchived ?? false) }));
  route(app, deps, C.createSubject, (ctx, input) => svc.createSubject(ctx, input.name));
  route(app, deps, C.updateSubject, (ctx, input) => svc.updateSubject(ctx, input.subjectId, input.name));
  route(app, deps, C.archiveSubject, (ctx, input) => svc.setSubjectArchived(ctx, input.subjectId, true));
  route(app, deps, C.unarchiveSubject, (ctx, input) => svc.setSubjectArchived(ctx, input.subjectId, false));

  // classes
  route(app, deps, C.listClasses, (ctx, input) => ({ classes: svc.listClasses(ctx.db, input) }));
  route(app, deps, C.createClass, (ctx, input) => svc.createClass(ctx, input));
  route(app, deps, C.updateClass, (ctx, input) => svc.updateClass(ctx, input));
  route(app, deps, C.archiveClass, (ctx, input) => svc.setClassArchived(ctx, input.classId, true));
  route(app, deps, C.unarchiveClass, (ctx, input) => svc.setClassArchived(ctx, input.classId, false));

  // teaching contexts
  route(app, deps, C.listTeachingContexts, (ctx, input) => ({ contexts: svc.listTeachingContexts(ctx.db, input) }));
  route(app, deps, C.assignTeachingContext, (ctx, input) => svc.assignTeachingContext(ctx, input));
  route(app, deps, C.endTeachingContext, (ctx, input) => svc.endTeachingContext(ctx, input.contextId));

  // module policies
  route(app, deps, C.getModulePolicies, (ctx) => ({ policies: svc.listModulePolicies(ctx.db) }));
  route(app, deps, C.setModulePolicy, (ctx, input) => svc.setModulePolicy(ctx, input.module, input.availability));

  // teacher
  route(app, deps, C.myContexts, (ctx) => svc.myContexts(ctx));
  route(app, deps, C.getContextModules, (ctx, input) => ({ modules: svc.getContextModules(ctx, input.contextId) }));
  route(app, deps, C.setContextModule, (ctx, input) => svc.setContextModule(ctx, input));
}
