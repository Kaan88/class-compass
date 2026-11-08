import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/admin.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import * as svc from './service.ts';

export function registerAdminRoutes(app: FastifyInstance, deps: AppDeps) {
  route(app, deps, C.listUsers, (ctx) => ({ users: svc.listUsers(ctx) }));
  route(app, deps, C.inviteUser, (ctx, input) => svc.inviteUserByAdmin(ctx, input.userId));
  route(app, deps, C.revokeUserInvite, (ctx, input) => svc.revokeInviteByAdmin(ctx, input.userId));
  route(app, deps, C.createUserByAdmin, (ctx, input) => svc.createUserByAdmin(ctx, input));
  route(app, deps, C.updateUserByAdmin, (ctx, input) => svc.updateUserByAdmin(ctx, input));
  route(app, deps, C.deactivateUser, (ctx, input) => svc.setUserActive(ctx, input.userId, false));
  route(app, deps, C.reactivateUser, (ctx, input) => svc.setUserActive(ctx, input.userId, true));
  route(app, deps, C.resetUserPassword, (ctx, input) => svc.resetPasswordByAdmin(ctx, input.userId));
  route(app, deps, C.clearUserPin, (ctx, input) => {
    svc.clearPinByAdmin(ctx, input.userId);
    return { ok: true as const };
  });
  route(app, deps, C.queryAudit, (ctx, input) => svc.queryAudit(ctx.db, input));
}
