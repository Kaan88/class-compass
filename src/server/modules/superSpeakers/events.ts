/**
 * Board change signal (S12, SSP-8, D-134). Awards, voids and settings changes call `notifyBoardChange()`
 * inside their write transaction; listeners (the open SSE streams) run on the next turn of the event
 * loop, after the transaction has committed, and each stream then sends the board's new version if it
 * differs. A spurious signal (a rolled-back write) only costs one version check.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let scheduled = false;

export function onBoardChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyBoardChange(): void {
  if (scheduled) return;
  scheduled = true;
  setImmediate(() => {
    scheduled = false;
    for (const l of [...listeners]) {
      try {
        l();
      } catch {
        /* a broken stream must not stop the others */
      }
    }
  });
}

export const boardListenerCount = () => listeners.size;
