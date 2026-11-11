import fs from 'node:fs';

/**
 * The e2e test clock (S12; shared by the server and the CLI since S26a, D-189): `Date.now()` plus the
 * number of milliseconds in `file`, re-read at most every 200 ms, so a test can move the server to
 * another day or week. Only ever built from `testClockFile(config)`, which is null outside NODE_ENV=test.
 */
export function offsetClock(file: string): () => number {
  let offset = 0;
  let offsetReadAt = 0;
  return () => {
    const t = Date.now();
    if (t - offsetReadAt > 200) {
      offsetReadAt = t;
      try {
        offset = Number(fs.readFileSync(file, 'utf8').trim()) || 0;
      } catch {
        offset = 0;
      }
    }
    return t + offset;
  };
}
