import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/displayInfo.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import { listDisplayInfo, recordDisplay } from './service.ts';

export function registerDisplayInfoRoutes(app: FastifyInstance, deps: AppDeps) {
  // The board sends one sample on mount and at most one a minute on resize; 12 a minute per address
  // leaves room for a few boards behind one school address and stops a loop.
  route(app, deps, C.reportDisplay, (ctx, input) => recordDisplay(ctx, input), { rateLimit: { max: 12, timeWindow: '1 minute' } });
  route(app, deps, C.adminDisplayInfo, (ctx) => ({ teachers: listDisplayInfo(ctx) }));
}
