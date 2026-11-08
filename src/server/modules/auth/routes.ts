import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import * as C from '../../../shared/contracts/auth.ts';
import { submitCommands } from '../../../shared/contracts/commands.ts';
import { sessions, users } from '../../db/schema.ts';
import type { AppDeps, RequestContext } from '../../lib/context.ts';
import { requireUser } from '../../lib/context.ts';
import { executeCommand } from '../../lib/commands.ts';
import { AppError } from '../../lib/errors.ts';
import { route, sessionCookieName } from '../../lib/http.ts';
import { emailResetEnabled } from '../../lib/mailer.ts';
import * as svc from './service.ts';
import * as email from './emailSignIn.ts';

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
  return svc.toMe(user, session, ctx.now());
}

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps) {
  route(
    app,
    deps,
    C.login,
    async (ctx, input, { reply }) => {
      const { user, session, token } = await svc.login(ctx, ctx.ip, input.login, input.password);
      setSessionCookie(deps, reply, token, svc.SESSION_ABSOLUTE_MS);
      return svc.toMe(user, session, ctx.now());
    },
    { rateLimit: { max: deps.config.loginRateLimit, timeWindow: '1 minute' } },
  );

  route(app, deps, C.logout, (ctx, _i, { reply }) => {
    svc.revokeSession(ctx.db, ctx.session!.id, ctx.now());
    reply.clearCookie(sessionCookieName(deps), { path: '/' });
    return { ok: true as const };
  });

  route(app, deps, C.me, (ctx) => svc.toMe(requireUser(ctx), ctx.session!, ctx.now()));

  route(app, deps, C.changePassword, async (ctx, input) => {
    await svc.changePassword(ctx, requireUser(ctx), ctx.session!, input.currentPassword, input.newPassword);
    return { ok: true as const };
  });

  route(app, deps, C.setPin, async (ctx, input) => {
    await svc.setPin(ctx, requireUser(ctx), ctx.session!, input.currentPassword, input.pin);
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

  route(app, deps, C.passwordResetAvailable, (ctx) => ({ emailResetEnabled: emailResetEnabled(ctx), emailLinkEnabled: emailResetEnabled(ctx) }));
  route(
    app,
    deps,
    C.requestPasswordReset,
    (ctx, input) => {
      svc.requestPasswordReset(ctx, input.email);
      return { ok: true as const };
    },
    { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  );
  route(
    app,
    deps,
    C.completePasswordReset,
    async (ctx, input) => {
      await svc.completePasswordReset(ctx, input.token, input.newPassword);
      return { ok: true as const };
    },
    { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  );

  // ---------------------------------------------------------------- invites and email-link sign-in (S13b, D-108)
  const signedIn = (ctx: RequestContext, reply: FastifyReply, r: { user: Parameters<typeof svc.toMe>[0]; session: Parameters<typeof svc.toMe>[1]; token: string }) => {
    setSessionCookie(deps, reply, r.token, svc.SESSION_ABSOLUTE_MS);
    return svc.toMe(r.user, r.session, ctx.now());
  };
  route(app, deps, C.inspectInvite, (ctx, input) => email.inspectInvite(ctx, input.token), { rateLimit: { max: 30, timeWindow: '15 minutes' } });
  route(
    app,
    deps,
    C.acceptInvite,
    async (ctx, input, { reply }) => {
      const r = await email.acceptInvite(ctx, ctx.ip, input);
      if (r.status === 'check_email') return { status: r.status, me: null, requestId: r.requestId };
      return { status: r.status, me: signedIn(ctx, reply, r), requestId: null };
    },
    { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  );
  route(app, deps, C.requestEmailLink, (ctx, input) => ({ ok: true as const, requestId: email.requestEmailLink(ctx, input.email).requestId }), {
    rateLimit: { max: 10, timeWindow: '15 minutes' },
  });
  route(app, deps, C.completeEmailLink, (ctx, input, { reply }) => signedIn(ctx, reply, email.completeEmailLink(ctx, input.token)), { rateLimit: { max: 20, timeWindow: '15 minutes' } });
  route(app, deps, C.completeEmailCode, (ctx, input, { reply }) => signedIn(ctx, reply, email.completeEmailCode(ctx, input.requestId, input.code)), {
    rateLimit: { max: 20, timeWindow: '15 minutes' },
  });
  route(
    app,
    deps,
    C.startEmailLinkMethod,
    async (ctx, input) => {
      const user = requireUser(ctx);
      await svc.assertReauth(ctx, user, ctx.session!, input.currentPassword);
      email.startEmailLinkMethod(ctx, user, ctx.session!);
      return { ok: true as const };
    },
    { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  );
  route(app, deps, C.confirmEmailLinkMethod, (ctx, input) => email.confirmEmailLinkMethod(ctx, requireUser(ctx), ctx.session!, input.code), { rateLimit: { max: 10, timeWindow: '15 minutes' } });
  route(app, deps, C.switchToPassword, (ctx, input) =>
    email.switchToPassword(ctx, requireUser(ctx), ctx.session!, input.newPassword, svc.isFreshEmailSession(ctx.session!, ctx.now())),
  );

  route(app, deps, submitCommands, (ctx, input) => {
    if (input.asUser !== undefined && input.asUser !== requireUser(ctx).id) {
      throw new AppError('CONFLICT', 'These commands were queued by another account', { reason: 'WRONG_ACCOUNT' });
    }
    return { results: input.commands.map((c) => executeCommand(ctx, c)) };
  });
}
