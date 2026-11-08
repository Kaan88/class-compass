/**
 * The scorer app's own outbox (S12, SSP-5/6, D-130): the same offline-safe outbox as the classroom
 * (UX-10/11) in a separate IndexedDB database. Its owner is the scorer LINK id, so awards queued under
 * one link are never sent as another (the server refuses a mismatched `asScorer` with WRONG_ACCOUNT).
 */
import { useSyncExternalStore } from 'react';
import { submitScorerCommands } from '../../shared/contracts/superSpeakers.ts';
import { call } from '../lib/api.ts';
import { createOutbox, type Outbox, type OutboxStatus } from '../lib/outbox.ts';

export const SCORER_OUTBOX_DB = 'cc-scorer-outbox';
let instance: Outbox | null = null;

export function scorerOutbox(): Outbox {
  if (instance) return instance;
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  instance = createOutbox({
    dbName: SCORER_OUTBOX_DB,
    send: async (commands, asScorer) => (await call(submitScorerCommands, { commands, asScorer })).results,
    ...(locks ? { lock: <T,>(fn: () => Promise<T>) => locks.request('cc-scorer-outbox', () => fn()) as Promise<T> } : {}),
  });
  void instance.start();
  return instance;
}

const EMPTY: OutboxStatus = { pending: 0, sending: false, online: true, authPaused: false, rejected: [], otherAccounts: 0, lastSavedAt: null, retryAt: null, failures: 0 };

export function useScorerOutboxStatus(): OutboxStatus {
  return useSyncExternalStore(
    (fn) => scorerOutbox().subscribe(fn),
    () => scorerOutbox().getStatus(),
    () => EMPTY,
  );
}
