import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/classroomLayout.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import { readLayout, resetLayout, saveLayout } from './service.ts';

export function registerClassroomLayoutRoutes(app: FastifyInstance, deps: AppDeps) {
  // Read by the classroom display while locked (conditional GET, D-045).
  route(app, deps, C.classroomLayout, (ctx, input, { req, reply }) => {
    const { etag, body } = readLayout(ctx, input.contextId);
    reply.header('ETag', etag);
    if (req.headers['if-none-match'] === etag) reply.code(304).send();
    return body;
  });
  route(app, deps, C.saveClassroomLayout, (ctx, input) => saveLayout(ctx, input));
  route(app, deps, C.resetClassroomLayout, (ctx, input) => resetLayout(ctx, input));
}
