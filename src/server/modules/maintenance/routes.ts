/** Maintenance, exports and rollover endpoints (admin only, S11). */
import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/maintenance.ts';
import type { AppDeps } from '../../lib/context.ts';
import { rawRoute, route } from '../../lib/http.ts';
import { fullExport, sendExport, studentExport } from './exports.ts';
import { rolloverApply, rolloverPreview } from './rollover.ts';
import { maintenanceStatus, runBackup, verifyLatest } from './service.ts';

/** Backups and exports read the whole database: a few per minute is plenty. */
const HEAVY = { max: 6, timeWindow: '1 minute' };

export function registerMaintenanceRoutes(app: FastifyInstance, deps: AppDeps) {
  route(app, deps, C.maintenanceStatus, (ctx) => maintenanceStatus(ctx));
  route(app, deps, C.runBackupNow, (ctx, input) => runBackup(ctx, input.pin), { rateLimit: HEAVY });
  route(app, deps, C.verifyLatestBackup, (ctx, input) => verifyLatest(ctx, input.pin), { rateLimit: HEAVY });
  route(app, deps, C.createFullExport, (ctx, input) => fullExport(ctx, input), { rateLimit: HEAVY });
  route(app, deps, C.createStudentExport, (ctx, input) => studentExport(ctx, input.studentId), { rateLimit: HEAVY });
  rawRoute(app, deps, C.downloadExport, (ctx, input, { reply }) => sendExport(ctx, reply, input.token));
  route(app, deps, C.rolloverPreview, (ctx, input) => rolloverPreview(ctx, input));
  route(app, deps, C.rolloverApply, (ctx, input) => rolloverApply(ctx, input));
}
