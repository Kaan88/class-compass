/** Student link helpers (S10): a "phone" that opened a personal link. Fictional data only. */
import { Client, type TestEnv } from './helpers.ts';
import { ok } from './school-fixture.ts';

export const tokenOf = (url: string) => url.slice(url.indexOf('#') + 1);

/** Posts the fragment token once (as the student page does) and keeps the student cookie. */
export async function openLink(env: TestEnv, url: string): Promise<Client> {
  const c = new Client(env);
  await ok(c.post('/api/student/session', { token: tokenOf(url) }));
  return c;
}
