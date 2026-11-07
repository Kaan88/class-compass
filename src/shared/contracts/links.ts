/**
 * Personal student links (S10: STU-1..7). A link is `https://<host>/s#<token>`: the 256-bit token is in
 * the URL fragment, which browsers never send to the server, put in a Referer header or show to
 * proxies. The `/s` page posts it once to `exchangeStudentLink`, which sets a separate strict student
 * session cookie; the page then removes the fragment. Only an HMAC of the token is stored, so a link
 * can be shown only when it is made: to print it again the teacher makes a new one (the old one stops
 * working at once).
 */
import { z } from 'zod';
import { Ok, endpoint } from './define.ts';
import { Id } from './school.ts';

/** The path of the student page; the token follows in the fragment (`/s#<token>`). */
export const STUDENT_PAGE_PATH = '/s';
export const studentLinkUrl = (origin: string, token: string) => `${new URL(origin).origin}${STUDENT_PAGE_PATH}#${token}`;

/** Public: exchange the token from the fragment for a student session cookie (rate-limited). */
export const exchangeStudentLink = endpoint({
  method: 'POST',
  path: '/api/student/session',
  access: 'public',
  input: z.object({ token: z.string().min(20).max(200) }),
  output: Ok,
});
/** Forget the link on this device (clears the student session cookie). */
export const leaveStudentSession = endpoint({ method: 'POST', path: '/api/student/session/end', access: 'student', input: z.object({}), output: Ok });

export const LinkStatus = z.object({ generation: z.number().int(), createdAt: z.number(), lastUsedAt: z.number().nullable() });
export const classLinks = endpoint({
  method: 'GET',
  path: '/api/teacher/classes/:classId/student-links',
  access: 'teacher',
  input: z.object({ classId: Id }),
  output: z.object({
    classId: z.string(),
    className: z.string(),
    archived: z.boolean(),
    students: z.array(z.object({ id: z.string(), fullName: z.string(), initials: z.string(), avatarHue: z.number().int(), link: LinkStatus.nullable() })),
  }),
});

/** A freshly made link: shown once (only its hash is stored). */
export const NewLink = z.object({ studentId: z.string(), fullName: z.string(), url: z.string(), generation: z.number().int() });
export type NewLink = z.infer<typeof NewLink>;

/** Make a link for one student; an existing link is revoked first (regenerate, STU-3). */
export const generateStudentLink = endpoint({
  method: 'POST',
  path: '/api/teacher/students/:studentId/link',
  access: 'teacher',
  input: z.object({ studentId: Id }),
  output: NewLink,
});
/** Make links for a whole class: only students without one (`missing`) or everyone again (`all`). */
export const generateClassLinks = endpoint({
  method: 'POST',
  path: '/api/teacher/classes/:classId/student-links',
  access: 'teacher',
  input: z.object({ classId: Id, scope: z.enum(['missing', 'all']) }),
  output: z.object({ links: z.array(NewLink) }),
});
export const revokeStudentLink = endpoint({ method: 'DELETE', path: '/api/teacher/students/:studentId/link', access: 'teacher', input: z.object({ studentId: Id }), output: Ok });
export const revokeClassLinks = endpoint({
  method: 'POST',
  path: '/api/teacher/classes/:classId/student-links/revoke',
  access: 'teacher',
  input: z.object({ classId: Id }),
  output: z.object({ revoked: z.number().int() }),
});
