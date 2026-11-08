import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/achievements.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import { ensureAchievementDefaults } from './defaults.ts';
import * as svc from './service.ts';

export function registerAchievementRoutes(app: FastifyInstance, deps: AppDeps) {
  ensureAchievementDefaults(deps.db, deps.now());
  route(app, deps, C.achievementsOverview, (ctx, input) => svc.overview(ctx, input.contextId));
  route(app, deps, C.studentAchievements, (ctx, input) => svc.studentAwards(ctx, input.contextId, input.studentId));
  route(app, deps, C.createAchievement, (ctx, input) => svc.createDef(ctx, input));
  route(app, deps, C.updateAchievement, (ctx, input) => svc.updateDef(ctx, input));
  route(app, deps, C.setAchievementSettings, (ctx, input) => svc.setSettings(ctx, input));
  route(app, deps, C.startAchievements, (ctx, input) => svc.start(ctx, input));
  route(app, deps, C.teacherAward, (ctx, input) => svc.teacherAward(ctx, input));
  route(app, deps, C.revokeAward, (ctx, input) => svc.revoke(ctx, input));
  route(app, deps, C.adminAchievementDefaults, (ctx) => svc.adminDefaults(ctx));
  route(app, deps, C.adminArchiveAchievementDefault, (ctx, input) => svc.adminArchive(ctx, input));
  route(app, deps, C.classroomAchievements, (ctx, input) => svc.classroomView(ctx, input));
  route(app, deps, C.studentSeenAchievements, (ctx) => svc.markSeen(ctx));
}
