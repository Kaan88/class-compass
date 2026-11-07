import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/lessons.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import * as svc from './service.ts';

export function registerLessonRoutes(app: FastifyInstance, deps: AppDeps) {
  // classroom (polling with ETag/304, LES-2)
  route(app, deps, C.getLessonState, (ctx, input, { req, reply }) => {
    const { etag, body } = svc.lessonState(ctx, input.contextId);
    reply.header('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      reply.code(304).send();
      return body;
    }
    return body;
  });
  route(app, deps, C.activeLessons, (ctx) => svc.activeLessons(ctx));
  route(app, deps, C.lessonRoutines, (ctx, input) => svc.lessonRoutines(ctx, input.contextId));
  route(app, deps, C.lessonRoster, (ctx, input) => svc.lessonRoster(ctx, input.contextId, input.lessonId));
  route(app, deps, C.lessonSummary, (ctx, input) => svc.lessonSummary(ctx, input.lessonId));
}
