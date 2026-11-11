/**
 * Uploads (S9: STU-8, D-014, CRD-1). Files are uploaded as multipart form data and served only
 * through policy-checked endpoints; the type is sniffed from the content, never taken from the
 * client. Upload endpoints are declared here like every other endpoint (access class, output
 * allow-list) and registered with `rawRoute()` on the server.
 */
import { z } from 'zod';
import { Ok, endpoint } from './define.ts';
import { Id, QueryBool } from './school.ts';

/** `teacher_sound` (S13b, D-107): a teacher's own time's-up clip, a teacher asset (not student media). */
export const FILE_KINDS = ['image', 'document', 'audio', 'import_source', 'teacher_sound'] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const FileKindSchema = z.enum(FILE_KINDS);

const MB = 1024 * 1024;
/** Hard size limit per kind (bytes), enforced while streaming (STU-8). */
export const UPLOAD_LIMITS: Record<FileKind, number> = {
  image: 10 * MB,
  document: 20 * MB,
  audio: 25 * MB,
  import_source: 20 * MB,
  teacher_sound: 2 * MB,
};

/** Longest voice recording on the student page and the teacher Goals page (S13b2, D-119). */
export const MAX_VOICE_RECORDING_MS = 5 * 60 * 1000;
/** Pictures are scaled down on the device to this long edge before upload (S13b2, D-119); the server caps evidence pictures at the same size. */
export const EVIDENCE_IMAGE_EDGE = 2048;

/**
 * Allow-list of sniffed types per kind. Never SVG, HTML, XML or scripts. `text/plain` covers CSV and
 * TXT (checked to be text without markup); `application/x-cfb` is accepted only when it is an
 * Excel 97-2003 workbook. `application/x-cc-html-table` (student lists only, S20c, D-171) is an HTML
 * table saved with a `.xls` name: only its table text is ever read, and it is never served as HTML.
 */
export const ALLOWED_MIME: Record<FileKind, readonly string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  document: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/plain',
  ],
  audio: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'],
  import_source: [
    'text/plain',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/x-cc-html-table',
  ],
  teacher_sound: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'],
};

/** `accept` attribute for file inputs (a hint for the picker only; the server sniffs the content). */
export const ACCEPT_HINT: Record<FileKind, string> = {
  image: 'image/jpeg,image/png,image/webp',
  document: '.pdf,.docx,.pptx,.odt,.xlsx,.xls,.csv,.txt',
  audio: 'audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav,.m4a,.mp3,.ogg,.webm,.wav',
  import_source: '.csv,.txt,.xlsx,.xls,.docx,.pdf,image/jpeg,image/png,image/webp',
  teacher_sound: 'audio/webm,audio/ogg,audio/mp4,audio/mpeg,.m4a,.mp3',
};

export const FileMeta = z.object({
  id: z.string(),
  kind: FileKindSchema,
  mime: z.string(),
  size: z.number().int(),
  name: z.string().nullable(),
  ownerStudentId: z.string().nullable(),
  hasThumbnail: z.boolean(),
  createdAt: z.number(),
});
export type FileMeta = z.infer<typeof FileMeta>;

/** Evidence file kinds a teacher uploads for a student: they need the student and the class+subject (D-174). */
export const EVIDENCE_FILE_KINDS = ['image', 'document', 'audio'] as const satisfies readonly FileKind[];

/**
 * Upload one file (multipart field `file`). Kinds image/document/audio are evidence files and need
 * `ownerStudentId` plus the matching media flag (D-014: photos and audio OFF by default →
 * 403 FEATURE_DISABLED); `import_source` is a student list for the importer (IMP-1).
 * `contextId` (S20b, D-170; required since S21b, D-174): the class+subject the evidence is for, so
 * the upload is refused before any bytes are stored when the teacher does not own that class+subject
 * (403), does not teach the student there, the Goals module is off or the class is read-only (the
 * same checks as attaching it). The teacher Goals page is the only caller of an evidence upload and
 * always has the class+subject, so an evidence upload without `ownerStudentId` or `contextId` is a
 * 400. Student lists and the time's-up clip (refused here, it has its own endpoint) carry no class.
 * Query-string input (the body is the multipart stream).
 */
export const uploadFile = endpoint({
  method: 'POST',
  path: '/api/files',
  access: 'account',
  input: z.discriminatedUnion('kind', [
    z.object({ kind: z.enum(EVIDENCE_FILE_KINDS), ownerStudentId: Id, contextId: Id }),
    z.object({ kind: z.literal('import_source'), ownerStudentId: Id.optional() }),
    z.object({ kind: z.literal('teacher_sound') }),
  ]),
  output: FileMeta,
});

/**
 * Download a file after the policy check (owner scope). Binary response with
 * `Content-Security-Policy: sandbox`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`,
 * attachment for anything but images and audio, Range support for audio. `thumb=true` serves the
 * image thumbnail.
 */
export const getFile = endpoint({
  method: 'GET',
  path: '/api/files/:fileId',
  access: 'account',
  input: z.object({ fileId: Id, thumb: QueryBool.optional() }),
  output: z.unknown(),
});

export const getFileMeta = endpoint({
  method: 'GET',
  path: '/api/files/:fileId/meta',
  access: 'account',
  input: z.object({ fileId: Id }),
  output: FileMeta,
});

/** Soft-delete a file (row kept, bytes removed). Uploader or admin; a student photo through removeStudentPhoto. */
export const deleteFile = endpoint({
  method: 'DELETE',
  path: '/api/files/:fileId',
  access: 'account',
  input: z.object({ fileId: Id }),
  output: Ok,
});

// ---------------------------------------------------------------- teacher time's-up clip (S13b, D-107)
/**
 * The teacher's own recorded time's-up clip (multipart field `file`): a teacher asset, not student
 * media, so the student media flags do not apply; still sniffed (audio only) and limited to 2 MB.
 * Replaces an earlier clip.
 */
export const uploadTimeUpClip = endpoint({ method: 'POST', path: '/api/teacher/time-up-clip', access: 'teacher', input: z.object({}), output: FileMeta });
export const deleteTimeUpClip = endpoint({ method: 'DELETE', path: '/api/teacher/time-up-clip', access: 'teacher', input: z.object({}), output: Ok });
/** The signed-in teacher's clip, playable on the classroom display (classroom access); 404 without one. */
export const classroomTimeUpClip = endpoint({ method: 'GET', path: '/api/classroom/time-up-clip', access: 'classroom', input: z.object({ v: z.string().max(64).optional() }), output: z.unknown() });

// ---------------------------------------------------------------- student photos (CRD-1, D-014)
/**
 * Upload a student photo (multipart field `file`, query `consent=true`). Only while the admin
 * enabled `media.studentPhotos` (default OFF → 403 FEATURE_DISABLED); the consent confirmation is
 * recorded on the student and in the audit log. Teachers of the student's class, or an admin.
 */
export const uploadStudentPhoto = endpoint({
  method: 'POST',
  path: '/api/students/:studentId/photo',
  access: 'account',
  input: z.object({ studentId: Id, consent: QueryBool.optional() }),
  output: z.object({ studentId: z.string(), photoUrl: z.string().nullable(), photoConsent: z.boolean() }),
});

export const removeStudentPhoto = endpoint({
  method: 'DELETE',
  path: '/api/students/:studentId/photo',
  access: 'account',
  input: z.object({ studentId: Id }),
  output: Ok,
});

/**
 * The photo for classroom cards: served only when photos are enabled, the student has consent and a
 * photo, and the teacher teaches the student's class (404 otherwise). Classroom access, so student
 * cards can show it while the device is locked.
 */
export const classroomStudentPhoto = endpoint({
  method: 'GET',
  path: '/api/classroom/students/:studentId/photo',
  access: 'classroom',
  input: z.object({ studentId: Id, v: z.string().max(64).optional() }),
  output: z.unknown(),
});

/** URL of a student's classroom photo (cache-busted by the file id). */
export const studentPhotoUrl = (studentId: string, fileId: string) => `/api/classroom/students/${encodeURIComponent(studentId)}/photo?v=${encodeURIComponent(fileId)}`;

/** The classroom photo URL of a student, or null unless photos are on (D-014), consent is recorded and there is a photo (CRD-1). */
export function photoUrlOf(s: { id: string; photoFileId: string | null; photoConsent: boolean }, photosOn: boolean): string | null {
  return photosOn && s.photoConsent && s.photoFileId ? studentPhotoUrl(s.id, s.photoFileId) : null;
}
