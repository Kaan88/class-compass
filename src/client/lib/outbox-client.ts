import { useSyncExternalStore } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { submitCommands } from '../../shared/contracts/commands.ts';
import { ApiError, call } from './api.ts';
import { createOutbox, type Outbox, type OutboxOp, type OutboxStatus } from './outbox.ts';
import { queryClient } from './queryClient.ts';
import { ME_KEY, type Me } from './session.ts';

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
    send: async (commands, asUser) => {
      try {
        return (await call(submitCommands, { commands, asUser })).results;
      } catch (err) {
        // Another account is signed in on this device now (e.g. in another tab): learn who it is, so
        // the outbox switches owner and parks the previous account's commands.
        if (err instanceof ApiError && (err.details as { reason?: string } | undefined)?.reason === 'WRONG_ACCOUNT') {
          void queryClient.invalidateQueries({ queryKey: ME_KEY });
        }
        throw err;
      }
    },
    ...(locks ? { lock: <T,>(fn: () => Promise<T>) => locks.request('cc-outbox', () => fn()) as Promise<T> } : {}),
  });
  instance.onSuccess((op) => {
    for (const inv of invalidations) {
      if (op.type.startsWith(inv.prefix)) for (const key of inv.keys(op)) void queryClient.invalidateQueries({ queryKey: key });
    }
  });
  // The owner follows the signed-in account in the `me` query: sign-in, sign-out, a 401 (cache
  // cleared) and switching accounts all update it, so commands are only ever sent by their owner.
  const box = instance;
  const syncOwner = () => {
    const me = queryClient.getQueryData<Me | null>(ME_KEY);
    void box.setOwner(me?.id ?? null);
  };
  queryClient.getQueryCache().subscribe((e) => {
    if (e.query.queryKey[0] === ME_KEY[0]) syncOwner();
  });
  syncOwner();
  void instance.start();
  return instance;
}

const EMPTY: OutboxStatus = { pending: 0, sending: false, online: true, authPaused: false, rejected: [], otherAccounts: 0, lastSavedAt: null, retryAt: null, failures: 0 };

export function useOutboxStatus(): OutboxStatus {
  return useSyncExternalStore(
    (fn) => getOutbox().subscribe(fn),
    () => getOutbox().getStatus(),
    () => EMPTY,
  );
}
