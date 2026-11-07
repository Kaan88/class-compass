import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import * as C from '../../../shared/contracts/auth.ts';
import { submitCommands } from '../../../shared/contracts/commands.ts';
import { sessions, users } from '../../db/schema.ts';
import type { AppDeps, RequestContext } from '../../lib/context.ts';
import { requireUser } from '../../lib/context.ts';
import { executeCommand } from '../../lib/commands.ts';
import { route, sessionCookieName } from '../../lib/http.ts';
import * as svc from './service.ts';

function setSessionCookie(deps: AppDeps, reply: FastifyReply, token: string, maxAgeMs: number) {
  reply.setCookie(sessionCookieName(deps), token, {
    path: '/',
    httpOnly: true,
    secure: deps.config.isProd,
    sameSite: 'lax',
    maxAge: Math.floor(maxAgeMs / 1000),
  });
}

function freshMe(ctx: RequestContext) {
  const user = ctx.db.select().from(users).where(eq(users.id, requireUser(ctx).id)).get()!;
  const session = ctx.db.select().from(sessions).where(eq(sessions.id, ctx.session!.id)).get()!;
  return svc.toMe(user, session);
}

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps) {
  route(
    app,
    deps,
    C.login,
    async (ctx, input, { reply }) => {
      const { user, session, token } = await svc.login(ctx, ctx.ip, input.login, input.password);
      setSessionCookie(deps, reply, token, svc.SESSION_ABSOLUTE_MS);
      return svc.toMe(user, session);
    },
    { rateLimit: { max: 20, timeWindow: '1 minute' } },
  );

  route(app, deps, C.logout, (ctx, _i, { reply }) => {
    svc.revokeSession(ctx.db, ctx.session!.id, ctx.now());
    reply.clearCookie(sessionCookieName(deps), { path: '/' });
    return { ok: true as const };
  });

  route(app, deps, C.me, (ctx) => svc.toMe(requireUser(ctx), ctx.session!));

  route(app, deps, C.changePassword, async (ctx, input) => {
    await svc.changePassword(ctx, requireUser(ctx), ctx.session!, input.currentPassword, input.newPassword);
    return { ok: true as const };
  });

  route(app, deps, C.setPin, async (ctx, input) => {
    await svc.setPin(ctx, requireUser(ctx), input.currentPassword, input.pin);
    return { ok: true as const };
  });

  route(app, deps, C.enterClassroom, (ctx) => {
    svc.enterClassroom(ctx, requireUser(ctx), ctx.session!);
    return { classroomMode: true as const };
  });

  route(app, deps, C.leaveClassroom, (ctx) => {
    svc.leaveClassroom(ctx, ctx.session!);
    return { ok: true as const };
  });

  route(
    app,
    deps,
    C.unlockPin,
    async (ctx, input) => ({ unlockedUntil: await svc.unlockPin(ctx, requireUser(ctx), ctx.session!, input.pin) }),
    { rateLimit: { max: 15, timeWindow: '1 minute' } },
  );

  route(app, deps, C.lockNow, (ctx) => {
    svc.lockNow(ctx, ctx.session!);
    return { ok: true as const };
  });

  route(app, deps, C.updatePreferences, (ctx, input) => {
    const user = requireUser(ctx);
    const patch: Partial<typeof users.$inferInsert> = { updatedAt: ctx.now() };
    if (input.locale) patch.locale = input.locale;
    if (input.textScale) patch.textScale = input.textScale;
    ctx.db.update(users).set(patch).where(eq(users.id, user.id)).run();
    return freshMe(ctx);
  });

  route(app, deps, submitCommands, (ctx, input) => ({
    results: input.commands.map((c) => executeCommand(ctx, c)),
  }));
}
