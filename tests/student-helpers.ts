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

/** The student's permanent link as the teacher's links page shows it (S13b2, D-115). */
export async function linkUrl(teacher: Client, classId: string, studentId: string): Promise<string> {
  const page = await ok(teacher.get(`/api/teacher/classes/${classId}/student-links`));
  const row = (page.students as Array<{ id: string; link: { url: string | null } | null }>).find((x) => x.id === studentId);
  if (!row?.link?.url) throw new Error(`no link for ${studentId}`);
  return row.link.url;
}
