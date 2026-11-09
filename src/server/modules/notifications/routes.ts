/**
 * Teacher notification endpoints (S14e3, D-155): the page, the bell count (ETag/304, polled every
 * 60 s while visible), mark read and the settings. All `teacher` access: 423 while locked.
 */
import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/notifications.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import { countWithEtag, getSettings, listNotifications, markRead, setSettings } from './service.ts';

export function registerNotificationRoutes(app: FastifyInstance, deps: AppDeps) {
  route(app, deps, C.notificationsList, (ctx, input) => listNotifications(ctx, input));
  route(app, deps, C.notificationsCount, (ctx, _input, { req, reply }) => {
    const { unread, etag } = countWithEtag(ctx);
    reply.header('ETag', etag);
    if (req.headers['if-none-match'] === etag) reply.code(304).send();
    return { unread };
  });
  route(app, deps, C.markNotificationsRead, (ctx, input) => markRead(ctx, input));
  route(app, deps, C.getNotificationSettings, (ctx) => getSettings(ctx));
  route(app, deps, C.setNotificationSettings, (ctx, input) => setSettings(ctx, input));
}
