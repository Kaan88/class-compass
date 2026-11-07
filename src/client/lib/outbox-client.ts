import { useSyncExternalStore } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { submitCommands } from '../../shared/contracts/commands.ts';
import { call } from './api.ts';
import { createOutbox, type Outbox, type OutboxOp, type OutboxStatus } from './outbox.ts';
import { queryClient } from './queryClient.ts';

/**
 * The app's single outbox instance (lazily created in the browser) plus React bindings.
 * Modules register which queries to refresh after their commands succeed:
 *   registerInvalidation('counter.', (op) => [['classroom', 'lesson', op.lessonId]])
 */
let instance: Outbox | null = null;
const invalidations: Array<{ prefix: string; keys: (op: OutboxOp) => QueryKey[] }> = [];

export function registerInvalidation(prefix: string, keys: (op: OutboxOp) => QueryKey[]) {
  invalidations.push({ prefix, keys });
}

export function getOutbox(): Outbox {
  if (instance) return instance;
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  instance = createOutbox({
    dbName: 'cc-outbox',
    send: async (commands) => (await call(submitCommands, { commands })).results,
    ...(locks ? { lock: <T,>(fn: () => Promise<T>) => locks.request('cc-outbox', () => fn()) as Promise<T> } : {}),
  });
  instance.onSuccess((op) => {
    for (const inv of invalidations) {
      if (op.type.startsWith(inv.prefix)) for (const key of inv.keys(op)) void queryClient.invalidateQueries({ queryKey: key });
    }
  });
  void instance.start();
  return instance;
}

const EMPTY: OutboxStatus = { pending: 0, sending: false, online: true, authPaused: false, rejected: [], lastSavedAt: null, retryAt: null, failures: 0 };

export function useOutboxStatus(): OutboxStatus {
  return useSyncExternalStore(
    (fn) => getOutbox().subscribe(fn),
    () => getOutbox().getStatus(),
    () => EMPTY,
  );
}
