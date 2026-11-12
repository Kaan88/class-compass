/**
 * Uploaded class lists that never became an import batch (audit fix, D-109): the teacher cancelled at
 * the sheet picker or the split preview, or the importer refused the file (no class column, too many
 * rows, a class too big, …). No batch points at such an `import_source` file, so student erasure,
 * which finds class lists through `import_batches.file_id`, could never delete it, although it names
 * children. The sweep (start-up and every `SOURCE_SWEEP_MS`) soft-deletes each one older than
 * `UNUSED_SOURCE_MS` like `deleteFileRow`: the bytes leave the disk, the row stays with `deleted_at`,
 * and a `file.delete` audit event by the system records it (kind only, no name).
 */
import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { tx } from '../../db/client.ts';
import { files } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { AppDeps } from '../../lib/context.ts';
import { removeKey } from '../files/storage.ts';

const MINUTE_MS = 60_000;
/** How long an upload may wait for its batch (sheet picker, split preview) before the sweep takes it. */
export const UNUSED_SOURCE_MS = 60 * MINUTE_MS;
export const SOURCE_SWEEP_MS = 10 * MINUTE_MS;

/** Soft-deletes the unused class list uploads older than `UNUSED_SOURCE_MS`; returns how many. */
export async function sweepUnusedImportSources(deps: Pick<AppDeps, 'db' | 'config' | 'now'>): Promise<number> {
  const now = deps.now();
  const unused = deps.db
    .select({ id: files.id, storageKey: files.storageKey, thumbStorageKey: files.thumbStorageKey })
    .from(files)
    .where(and(eq(files.kind, 'import_source'), isNull(files.deletedAt), lte(files.createdAt, now - UNUSED_SOURCE_MS), sql`not exists (select 1 from import_batches b where b.file_id = ${files.id})`))
    .all();
  if (!unused.length) return 0;
  tx(deps.db, () => {
    for (const f of unused) {
      deps.db.update(files).set({ deletedAt: now }).where(eq(files.id, f.id)).run();
      audit(deps.db, { type: 'system', id: null }, { action: 'file.delete', entity: 'file', entityId: f.id, before: { kind: 'import_source', unused: true } }, now);
    }
  });
  for (const f of unused) {
    await removeKey(deps.config, f.storageKey);
    await removeKey(deps.config, f.thumbStorageKey);
  }
  return unused.length;
}
