/**
 * A free port on 127.0.0.1 that `fetch` will connect to. Fetch (undici, the WHATWG "bad port" list)
 * refuses some ports with "fetch failed: bad port"; when the machine's dynamic port range starts low
 * (Windows can be set to 1024-15000), `listen(0)` sometimes lands on one (6000, 6665-6669, 10080, …) and
 * a test that then fetches from it fails now and then. Use it for a server a test reaches with fetch
 * (the MCP SDK's transport uses fetch too); `node:http` requests are not affected.
 */
import net from 'node:net';
import type { AddressInfo } from 'node:net';

/** The ports fetch refuses (undici `lib/web/fetch/constants.js`, from the Fetch standard). */
export const FETCH_BAD_PORTS: ReadonlySet<number> = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512,
  513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
]);

/** Asks the system for free ports until one is not on the bad list (refused ones stay held, so they are not handed out again). */
export async function fetchablePort(): Promise<number> {
  const held: net.Server[] = [];
  try {
    for (;;) {
      const probe = net.createServer();
      await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
      held.push(probe);
      const { port } = probe.address() as AddressInfo;
      if (!FETCH_BAD_PORTS.has(port)) return port;
    }
  } finally {
    await Promise.all(held.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  }
}
