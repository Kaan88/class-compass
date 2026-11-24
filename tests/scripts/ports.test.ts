/**
 * The test helper for servers a test reaches with fetch (tests/ports.ts): fetch really refuses the
 * ports on its list ("bad port", the flaky Super Speakers SSE test), and the helper never picks one.
 */
import { describe, expect, it } from 'vitest';
import { FETCH_BAD_PORTS, fetchablePort } from '../ports.ts';

describe('fetchablePort', () => {
  it('fetch refuses a port on the list before connecting; the helper picks free ports off the list', async () => {
    for (const port of [6000, 6666, 10080]) {
      expect(FETCH_BAD_PORTS.has(port)).toBe(true);
      await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toMatchObject({ cause: { message: 'bad port' } });
    }
    for (let i = 0; i < 20; i++) expect(FETCH_BAD_PORTS.has(await fetchablePort())).toBe(false);
  });
});
