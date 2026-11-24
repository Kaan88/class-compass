import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import * as C from '../../../shared/contracts/auth.ts';
import { submitCommands } from '../../../shared/contracts/commands.ts';
import { sessions, users } from '../../db/schema.ts';
import type { AppDeps, RequestContext } from '../../lib/context.ts';
import { requireUser } from '../../lib/context.ts';
import { executeCommand } from '../../lib/commands.ts';
import { AppError } from '../../lib/errors.ts';
import { rawRoute, route, sessionCookieName } from '../../lib/http.ts';
import { emailResetEnabled } from '../../lib/mailer.ts';
import { setUserSetting } from '../../lib/userSettings.ts';
import { getSchoolSettings } from '../school/policy.ts';
import { notFound } from '../../lib/errors.ts';
import * as svc from './service.ts';
import * as email from './emailSignIn.ts';
import * as google from './google.ts';
import * as passkey from './passkeys.ts';
import * as sso from './sso.ts';

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
  return svc.toMe(ctx.db, user, session, ctx.now());
}

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps) {
  route(
    app,
    deps,
    C.login,
    async (ctx, input, { reply }) => {
      const { user, session, token } = await svc.login(ctx, ctx.ip, input.login, input.password);
      setSessionCookie(deps, reply, token, svc.SESSION_ABSOLUTE_MS);
      return svc.toMe(ctx.db, user, session, ctx.now());
    },
    { rateLimit: { max: deps.config.loginRateLimit, timeWindow: '1 minute' } },
  );

  route(app, deps, C.logout, (ctx, _i, { reply }) => {
    svc.revokeSession(ctx.db, ctx.session!.id, ctx.now());
    reply.clearCookie(sessionCookieName(deps), { path: '/' });
    return { ok: true as const };
  });

  route(app, deps, C.me, (ctx) => svc.toMe(ctx.db, requireUser(ctx), ctx.session!, ctx.now()));

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
    { rateLimit: { max: deps.config.pinUnlockRateLimit, timeWindow: '1 minute' } },
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
    // S22d (D-178): a preference of this account only (no audit row), kept as a user setting.
    if (input.density) setUserSetting(ctx.db, user.id, 'area.density', input.density, ctx.now());
    return freshMe(ctx);
  });

  route(app, deps, C.passwordResetAvailable, (ctx) => ({ emailResetEnabled: emailResetEnabled(ctx), emailLinkEnabled: emailResetEnabled(ctx), passwordsOff: getSchoolSettings(ctx.db).passwordsOff, googleSignInEnabled: google.googleSignInEnabled(ctx), passkeysEnabled: passkey.passkeysEnabled(ctx), sso: sso.ssoPublicInfo(ctx), defaultLocale: getSchoolSettings(ctx.db).defaultLocale }));
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
  const signedIn = (ctx: RequestContext, reply: FastifyReply, r: { user: Parameters<typeof svc.toMe>[1]; session: Parameters<typeof svc.toMe>[2]; token: string }) => {
    setSessionCookie(deps, reply, r.token, svc.SESSION_ABSOLUTE_MS);
    return svc.toMe(ctx.db, r.user, r.session, ctx.now());
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
  // Changing the own address (S35, D-214): the pending address lives in a sealed cookie of this browser.
  const emailChangeCookie = { path: email.EMAIL_CHANGE_COOKIE_PATH, httpOnly: true, secure: deps.config.isProd, sameSite: 'strict' as const };
  route(
    app,
    deps,
    C.startEmailChange,
    async (ctx, input, { reply }) => {
      const user = requireUser(ctx);
      email.assertEmailChangeAllowed(ctx);
      await svc.assertReauth(ctx, user, ctx.session!, input.currentPassword);
      const started = email.startEmailChange(ctx, user, ctx.session!, input.email);
      reply.setCookie(email.EMAIL_CHANGE_COOKIE, started.cookie, { ...emailChangeCookie, maxAge: Math.floor(email.EMAIL_LINK_MS / 1000) });
      return { ok: true as const };
    },
    { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  );
  route(
    app,
    deps,
    C.confirmEmailChange,
    (ctx, input, { req, reply }) => {
      const me = email.confirmEmailChange(ctx, requireUser(ctx), ctx.session!, req.cookies?.[email.EMAIL_CHANGE_COOKIE], input.code);
      reply.clearCookie(email.EMAIL_CHANGE_COOKIE, emailChangeCookie);
      return me;
    },
    { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  );
  // Sign in with Google (S31, D-208): the cookie binds Google's answer to the browser that asked.
  const googleCookie = { path: google.GOOGLE_COOKIE_PATH, httpOnly: true, secure: deps.config.isProd, sameSite: 'lax' as const };
  route(
    app,
    deps,
    C.startGoogleSignIn,
    (ctx, _i, { reply }) => {
      const started = google.startGoogleSignIn(ctx);
      reply.setCookie(google.GOOGLE_COOKIE, started.cookie, { ...googleCookie, maxAge: Math.floor(google.GOOGLE_STATE_TTL_MS / 1000) });
      return { authorizeUrl: started.authorizeUrl };
    },
    { rateLimit: { max: 20, timeWindow: '15 minutes' } },
  );
  route(
    app,
    deps,
    C.completeGoogleSignIn,
    async (ctx, input, { req, reply }) => {
      // One try per start: the cookie goes whether or not the sign-in works.
      reply.clearCookie(google.GOOGLE_COOKIE, googleCookie);
      return signedIn(ctx, reply, await google.completeGoogleSignIn(ctx, req.cookies?.[google.GOOGLE_COOKIE], input));
    },
    { rateLimit: { max: 20, timeWindow: '15 minutes' } },
  );
  // The operator's own sign-in server (S34, D-213): the same shape as Google's two steps.
  const ssoCookie = { path: sso.SSO_COOKIE_PATH, httpOnly: true, secure: deps.config.isProd, sameSite: 'lax' as const };
  route(
    app,
    deps,
    C.startSsoSignIn,
    async (ctx, _i, { reply }) => {
      const started = await sso.startSsoSignIn(ctx);
      reply.setCookie(sso.SSO_COOKIE, started.cookie, { ...ssoCookie, maxAge: Math.floor(sso.SSO_STATE_TTL_MS / 1000) });
      return { authorizeUrl: started.authorizeUrl };
    },
    { rateLimit: { max: 20, timeWindow: '15 minutes' } },
  );
  route(
    app,
    deps,
    C.completeSsoSignIn,
    async (ctx, input, { req, reply }) => {
      reply.clearCookie(sso.SSO_COOKIE, ssoCookie);
      return signedIn(ctx, reply, await sso.completeSsoSignIn(ctx, req.cookies?.[sso.SSO_COOKIE], input));
    },
    { rateLimit: { max: 20, timeWindow: '15 minutes' } },
  );
  // An image only: never run as a page, never guessed to be another type, and cached for a short time.
  rawRoute(app, deps, C.ssoIcon, (ctx, _i, { reply }) => {
    const icon = sso.ssoIcon(ctx);
    if (!icon) throw notFound('Icon');
    return reply
      .header('Content-Type', icon.type)
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'public, max-age=3600')
      .send(icon.body);
  });
  // Passkeys (S33, D-210): the challenge of each step lives in a sealed cookie, for one try.
  const passkeyCookie = { path: passkey.PASSKEY_COOKIE_PATH, httpOnly: true, secure: deps.config.isProd, sameSite: 'strict' as const };
  const passkeyMaxAge = Math.floor(passkey.PASSKEY_CHALLENGE_TTL_MS / 1000);
  const passkeyLimit = { rateLimit: { max: 30, timeWindow: '15 minutes' } };
  route(app, deps, C.passkeyOffer, (ctx) => ({ offer: passkey.shouldOfferPasskey(ctx, requireUser(ctx), ctx.session!) }));
  route(app, deps, C.dismissPasskeyOffer, (ctx) => {
    passkey.dismissPasskeyOffer(ctx, requireUser(ctx));
    return { ok: true as const };
  });
  route(app, deps, C.listPasskeys, (ctx) => ({ passkeys: passkey.listPasskeys(ctx.db, requireUser(ctx).id) }));
  route(
    app,
    deps,
    C.startPasskeyRegistration,
    async (ctx, input, { reply }) => {
      const user = requireUser(ctx);
      await svc.assertReauth(ctx, user, ctx.session!, input.currentPassword);
      const started = await passkey.startRegistration(ctx, user);
      reply.setCookie(passkey.PASSKEY_COOKIE, started.cookie, { ...passkeyCookie, maxAge: passkeyMaxAge });
      return { options: started.options as unknown as Record<string, unknown> };
    },
    passkeyLimit,
  );
  route(
    app,
    deps,
    C.finishPasskeyRegistration,
    async (ctx, input, { req, reply }) => {
      reply.clearCookie(passkey.PASSKEY_COOKIE, passkeyCookie);
      return passkey.finishRegistration(ctx, requireUser(ctx), req.cookies?.[passkey.PASSKEY_COOKIE], input.response, input.name);
    },
    passkeyLimit,
  );
  route(app, deps, C.removePasskey, (ctx, input) => {
    passkey.removePasskey(ctx, requireUser(ctx), input.passkeyId);
    return { ok: true as const };
  });
  route(
    app,
    deps,
    C.startPasskeySignIn,
    async (ctx, _i, { reply }) => {
      const started = await passkey.startSignIn(ctx);
      reply.setCookie(passkey.PASSKEY_COOKIE, started.cookie, { ...passkeyCookie, maxAge: passkeyMaxAge });
      return { options: started.options as unknown as Record<string, unknown> };
    },
    passkeyLimit,
  );
  route(
    app,
    deps,
    C.finishPasskeySignIn,
    async (ctx, input, { req, reply }) => {
      reply.clearCookie(passkey.PASSKEY_COOKIE, passkeyCookie);
      return signedIn(ctx, reply, await passkey.finishSignIn(ctx, req.cookies?.[passkey.PASSKEY_COOKIE], input.response));
    },
    passkeyLimit,
  );
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
