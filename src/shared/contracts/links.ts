/**
 * Personal student links (S10: STU-1..7; permanent since S13b2, D-115). A link is
 * `https://<host>/s#<token>`: the 256-bit token is in the URL fragment, which browsers never send to
 * the server, put in a Referer header or show to proxies. The `/s` page posts it once to
 * `exchangeStudentLink`, which sets a separate strict student session cookie; the page then removes
 * the fragment.
 *
 * Every active student has exactly one link, made automatically; the token is stored encrypted, so the
 * teacher can show and print the SAME link at any time. There is no routine revoke or regenerate. A
 * link works while the student is active. In an emergency (a leaked link) an administrator or one of
 * the student's current teachers can revoke it or make a new one: the student's full name must be
 * typed, a reason given, and the action is audited.
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

/** Student-page language of the class (S13b2, D-117), for the "Scan to open your page" line on the cards. */
export const CardLanguage = z.enum(['en', 'tr']);

export const LinkStatus = z.object({
  /** The link to show, copy and print; null only when it cannot be decrypted (the server pepper changed). */
  url: z.string().nullable(),
  generation: z.number().int(),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable(),
  /** When this link replaced an earlier one in an emergency ("print the new card"); null otherwise. */
  replacedAt: z.number().nullable(),
});
export type LinkStatus = z.infer<typeof LinkStatus>;

export const StudentLinkRow = z.object({
  id: z.string(),
  fullName: z.string(),
  initials: z.string(),
  avatarHue: z.number().int(),
  /** null = no link: revoked in an emergency (`revokedAt`) or the student is not active. */
  link: LinkStatus.nullable(),
  /** The link was revoked in an emergency and no new one was made yet. */
  revokedAt: z.number().nullable(),
});
export type StudentLinkRow = z.infer<typeof StudentLinkRow>;

export const classLinks = endpoint({
  method: 'GET',
  path: '/api/teacher/classes/:classId/student-links',
  access: 'teacher',
  input: z.object({ classId: Id }),
  output: z.object({
    classId: z.string(),
    className: z.string(),
    archived: z.boolean(),
    cardLanguage: CardLanguage,
    students: z.array(StudentLinkRow),
  }),
});

// ---------------------------------------------------------------- emergency actions (D-118)
export const EMERGENCY_LINK_ACTIONS = ['revoke', 'replace'] as const;
export const EmergencyLinkInput = z.object({
  studentId: Id,
  action: z.enum(EMERGENCY_LINK_ACTIONS),
  /** The student's full name, typed (checked on the server). */
  confirmName: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(3).max(500),
});
export const StudentLinkState = z.object({ studentId: z.string(), fullName: z.string(), className: z.string().nullable(), cardLanguage: CardLanguage, link: LinkStatus.nullable(), revokedAt: z.number().nullable() });
export type StudentLinkState = z.infer<typeof StudentLinkState>;

/** A current teacher of the student (teacher area, PIN-gated): revoke the link or make a new one. */
export const teacherEmergencyLink = endpoint({
  method: 'POST',
  path: '/api/teacher/students/:studentId/link/emergency',
  access: 'teacher',
  input: EmergencyLinkInput,
  output: StudentLinkState,
});
/** An administrator: the student's link (admin student page) and the same emergency actions. */
export const adminStudentLink = endpoint({ method: 'GET', path: '/api/admin/students/:studentId/link', access: 'admin', input: z.object({ studentId: Id }), output: StudentLinkState });
export const adminEmergencyLink = endpoint({
  method: 'POST',
  path: '/api/admin/students/:studentId/link/emergency',
  access: 'admin',
  input: EmergencyLinkInput,
  output: StudentLinkState,
});
