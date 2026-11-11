import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/import.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import * as svc from './service.ts';

export function registerImportRoutes(app: FastifyInstance, deps: AppDeps) {
  // Extraction may run OCR: at most 20 new batches per minute per address.
  route(app, deps, C.createImportBatch, (ctx, input) => svc.createBatch(ctx, input), { rateLimit: { max: 20, timeWindow: '1 minute' } });
  // Several classes in one file (S20c, D-171): both read the source again, so they share the limit.
  route(app, deps, C.previewImportSplit, (ctx, input) => svc.previewSplit(ctx, input), { rateLimit: { max: 20, timeWindow: '1 minute' } });
  route(app, deps, C.createImportSplit, (ctx, input) => svc.createSplit(ctx, input), { rateLimit: { max: 20, timeWindow: '1 minute' } });
  route(app, deps, C.listImportSheets, (ctx, input) => svc.listSheets(ctx, input.fileId), { rateLimit: { max: 20, timeWindow: '1 minute' } });
  route(app, deps, C.listImportBatches, (ctx, input) => svc.listBatches(ctx, input));
  route(app, deps, C.getImportBatch, (ctx, input) => svc.getBatch(ctx, input.batchId));
  route(app, deps, C.setImportMapping, (ctx, input) => svc.setMapping(ctx, input));
  route(app, deps, C.updateImportRow, (ctx, input) => svc.updateRow(ctx, input));
  route(app, deps, C.setImportDecisions, (ctx, input) => svc.setDecisions(ctx, input));
  route(app, deps, C.commitImportBatch, (ctx, input) => svc.commitBatch(ctx, input.batchId));
  route(app, deps, C.revertImportBatch, (ctx, input) => svc.revertBatch(ctx, input.batchId));
}
