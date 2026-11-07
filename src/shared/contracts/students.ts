/**
 * Student contracts (ACC-4/7, DAT-2/3, UX-5, GRP-7).
 * - Classroom roster: minimal display fields only (no numbers, no levels, no consent flags).
 * - Teacher roster: full details for classes the teacher teaches.
 * - Admin: school-wide list, deactivate/reactivate, move/promote with enrolment history.
 */
import { z } from 'zod';
import { Ok, endpoint } from './define.ts';
import { Id, IsoDate, QueryBool } from './school.ts';

const Name = z.string().trim().min(1).max(160);
const StudentNumber = z
  .string()
  .trim()
  .max(32)
  .regex(/^[\p{L}\p{N}-]*$/u, 'Student number: letters, digits and - only');

/** Classroom-safe card data (CRD-1). */
export const RosterEntry = z.object({ id: z.string(), fullName: z.string(), initials: z.string(), avatarHue: z.number().int() });
export const classroomRoster = endpoint({
  method: 'GET',
  path: '/api/classroom/classes/:classId/roster',
  access: 'classroom',
  input: z.object({ classId: Id }),
  output: z.object({ classId: z.string(), className: z.string(), students: z.array(RosterEntry) }),
});

export const Enrolment = z.object({
  id: z.string(),
  classId: z.string(),
  className: z.string(),
  schoolYearId: z.string(),
  fromDate: z.string(),
  toDate: z.string().nullable(),
  reason: z.enum(['added', 'import', 'move', 'promotion']),
});

export const StudentDetail = z.object({
  id: z.string(),
  fullName: z.string(),
  givenNames: z.string().nullable(),
  familyName: z.string().nullable(),
  studentNumber: z.string().nullable(),
  initials: z.string(),
  avatarHue: z.number().int(),
  photoConsent: z.boolean(),
  active: z.boolean(),
  enrolledFrom: z.string().nullable(),
});

export const teacherRoster = endpoint({
  method: 'GET',
  path: '/api/teacher/classes/:classId/students',
  access: 'teacher',
  input: z.object({ classId: Id }),
  output: z.object({ classId: z.string(), className: z.string(), students: z.array(StudentDetail) }),
});

const StudentInput = {
  fullName: Name,
  givenNames: Name.nullable().optional(),
  familyName: Name.nullable().optional(),
  studentNumber: StudentNumber.nullable().optional(),
  photoConsent: z.boolean().optional(),
};

/**
 * Possible duplicates (same folded name) are reported as 409 CONFLICT with
 * `details.reason = 'POSSIBLE_DUPLICATE'`; resend with `allowDuplicateName: true` after the teacher
 * confirms it is a different child. Never merged automatically (IMP-4).
 */
export const addStudentToClass = endpoint({
  method: 'POST',
  path: '/api/teacher/classes/:classId/students',
  access: 'teacher',
  input: z.object({ classId: Id, ...StudentInput, allowDuplicateName: z.boolean().optional() }),
  output: StudentDetail,
});

export const updateStudent = endpoint({
  method: 'PATCH',
  path: '/api/teacher/students/:studentId',
  access: 'teacher',
  input: z.object({
    studentId: Id,
    fullName: Name.optional(),
    givenNames: StudentInput.givenNames,
    familyName: StudentInput.familyName,
    studentNumber: StudentInput.studentNumber,
    photoConsent: z.boolean().optional(),
  }),
  output: StudentDetail,
});

// ---------------------------------------------------------------- subject levels (teacher only, GRP-7)
export const SubjectLevel = z.object({ studentId: z.string(), level: z.string().nullable() });
export const getContextLevels = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/levels',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: z.object({ subjectId: z.string(), levels: z.array(SubjectLevel) }),
});
export const setContextLevels = endpoint({
  method: 'PUT',
  path: '/api/teacher/contexts/:contextId/levels',
  access: 'teacher',
  input: z.object({
    contextId: Id,
    levels: z
      .array(z.object({ studentId: Id, level: z.string().trim().min(1).max(40).nullable() }))
      .min(1)
      .max(200),
  }),
  output: z.object({ subjectId: z.string(), levels: z.array(SubjectLevel) }),
});

// ---------------------------------------------------------------- admin
export const AdminStudent = StudentDetail.extend({
  currentClassId: z.string().nullable(),
  currentClassName: z.string().nullable(),
});
export const adminListStudents = endpoint({
  method: 'GET',
  path: '/api/admin/students',
  access: 'admin',
  input: z.object({
    classId: Id.optional(),
    yearId: Id.optional(),
    q: z.string().max(100).optional(),
    includeDeactivated: QueryBool.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(100),
  }),
  output: z.object({ students: z.array(AdminStudent), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() }),
});
export const adminGetStudent = endpoint({
  method: 'GET',
  path: '/api/admin/students/:studentId',
  access: 'admin',
  input: z.object({ studentId: Id }),
  output: AdminStudent.extend({ enrolments: z.array(Enrolment) }),
});
export const adminAddStudent = endpoint({
  method: 'POST',
  path: '/api/admin/students',
  access: 'admin',
  input: z.object({ classId: Id, ...StudentInput, allowDuplicateName: z.boolean().optional() }),
  output: StudentDetail,
});
export const deactivateStudent = endpoint({
  method: 'POST',
  path: '/api/admin/students/:studentId/deactivate',
  access: 'admin',
  input: z.object({ studentId: Id }),
  output: Ok,
});
export const reactivateStudent = endpoint({
  method: 'POST',
  path: '/api/admin/students/:studentId/reactivate',
  access: 'admin',
  input: z.object({ studentId: Id }),
  output: Ok,
});

export const MoveReport = z.object({
  moved: z.array(z.string()),
  skipped: z.array(z.object({ studentId: z.string(), reason: z.enum(['ALREADY_IN_CLASS', 'DEACTIVATED', 'NOT_FOUND']) })),
});
/** Move students to another class (same or another year). Closes the open enrolment, opens a new one (DAT-2). */
export const moveStudents = endpoint({
  method: 'POST',
  path: '/api/admin/students/move',
  access: 'admin',
  input: z.object({ studentIds: z.array(Id).min(1).max(500), toClassId: Id, date: IsoDate.optional() }),
  output: MoveReport,
});
/** Promote every active student currently in a class to a class in another (new) year. */
export const promoteClass = endpoint({
  method: 'POST',
  path: '/api/admin/classes/:classId/promote',
  access: 'admin',
  input: z.object({ classId: Id, toClassId: Id, date: IsoDate.optional() }),
  output: MoveReport,
});
