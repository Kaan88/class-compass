/**
 * Long server work in small steps (S15a, D-162): the server runs on one Node thread, so a job that
 * reads or writes many rows (the full export, the notifications purge, the digests) awaits this
 * between steps, and the requests waiting meanwhile (the classroom screens' polls) run first.
 */
export const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
