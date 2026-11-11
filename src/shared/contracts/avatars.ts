/**
 * Avatars (S13c items 9 and 11, D-124, D-125). The spec is validated against the shared catalogue
 * (`src/shared/avatars.ts`): `.strict()` objects of enums only, so an unknown part, option or colour
 * is refused with 400 VALIDATION. Avatars are not photos: no media flag applies.
 */
import { z } from 'zod';
import { PICTURE_STATES, REFUSAL_REASONS } from '../avatarPictures.ts';
import { pii } from '../pii.ts';
import { AVATAR_COLOURS, CREATURE_FAMILIES, CREATURE_FAMILY_KEYS, CREATURE_PARTS, HAIR_COLOURS, PERSON_PARTS, SKIN_TONES, type AvatarSpecValue, type CreatureFamily } from '../avatars.ts';
import { Ok, endpoint } from './define.ts';
import { Id } from './school.ts';

const Colour = z.enum(AVATAR_COLOURS);

export const PersonSpec = z
  .object({
    v: z.literal(1),
    type: z.literal('person'),
    body: z.enum(PERSON_PARTS.body),
    skin: z.enum(SKIN_TONES),
    face: z.enum(PERSON_PARTS.face),
    hair: z.enum(PERSON_PARTS.hair),
    hairColor: z.enum(HAIR_COLOURS),
    eyes: z.enum(PERSON_PARTS.eyes),
    brows: z.enum(PERSON_PARTS.brows),
    mouth: z.enum(PERSON_PARTS.mouth),
    glasses: z.enum(PERSON_PARTS.glasses),
    cheeks: z.enum(PERSON_PARTS.cheeks),
    top: z.enum(PERSON_PARTS.top),
    topColor: Colour,
    hat: z.enum(PERSON_PARTS.hat),
    accessory: z.enum(PERSON_PARTS.accessory),
    accentColor: Colour,
    pet: z.enum(PERSON_PARTS.pet),
    bg: z.enum(PERSON_PARTS.bg),
    bgColor: Colour,
  })
  .strict();

export const CreatureSpec = z
  .object({
    v: z.literal(1),
    type: z.literal('creature'),
    family: z.enum(CREATURE_FAMILY_KEYS as [CreatureFamily, ...CreatureFamily[]]),
    species: z.string().max(40),
    color: Colour,
    eyes: z.enum(CREATURE_PARTS.eyes),
    mouth: z.enum(CREATURE_PARTS.mouth),
    hat: z.enum(CREATURE_PARTS.hat),
    accessory: z.enum(CREATURE_PARTS.accessory),
    accentColor: Colour,
    bg: z.enum(CREATURE_PARTS.bg),
    bgColor: Colour,
  })
  .strict()
  .refine((s) => (CREATURE_FAMILIES[s.family] as readonly string[]).includes(s.species), { message: 'Unknown character for this family', path: ['species'] });

export const AvatarSpec = z.union([PersonSpec, CreatureSpec]) as unknown as z.ZodType<AvatarSpecValue>;
export type AvatarSpec = AvatarSpecValue;

export const AVATAR_FALLBACKS = ['generated', 'initials'] as const;
export const AvatarFallback = z.enum(AVATAR_FALLBACKS);

/**
 * Avatars of the students in the signed-in teacher's classes (classroom-safe: catalogue keys only,
 * like the initials). Used by every student card, list and reveal through the client's avatar
 * directory. `spec` null = not chosen yet (the class fallback applies).
 */
export const classroomAvatars = endpoint({
  method: 'GET',
  path: '/api/classroom/avatars',
  access: 'classroom',
  input: z.object({}),
  output: z.object({
    classes: z.array(z.object({ classId: z.string(), fallback: AvatarFallback, locked: z.boolean() })),
    /**
     * `pictureUrl` (S24, D-184): the student's own picture, only once a teacher approved it and only
     * while the school's switch is on; null otherwise (the spec or the class fallback applies).
     */
    students: z.array(z.object({ id: z.string(), classId: z.string(), spec: AvatarSpec.nullable(), pictureUrl: z.string().nullable() })),
  }),
});

export const RefusalReason = z.enum(REFUSAL_REASONS);
export const PictureState = z.enum(PICTURE_STATES);

/**
 * The student's own picture on their page (S24, D-184). `state`: `off` = the school switch is off
 * (nothing shown), `classOff` = no class of theirs lets students send pictures, `locked` = avatar changes
 * are paused (that also stops uploads), `open` = they may send one. `approvedUrl` is the picture in use;
 * `pending` the one waiting for a teacher (only the student and their teachers see it); `refused` the
 * teacher's reason after "Not this one" (the picture itself is already deleted).
 */
export const StudentPictureInfo = z.object({
  state: PictureState,
  approvedUrl: z.string().nullable(),
  pending: z.object({ sentAt: z.number(), deleteAt: z.number(), url: z.string() }).nullable(),
  refused: z.object({ reason: RefusalReason, at: z.number() }).nullable(),
});
export type StudentPictureInfo = z.infer<typeof StudentPictureInfo>;

/** The student's own avatar on their page (studentId from the link session only). */
export const StudentAvatarInfo = z.object({
  spec: AvatarSpec.nullable(),
  /** Shown until the student chooses (a stable generated avatar). */
  generated: AvatarSpec,
  /** Teachers stopped changes for the class (D-124). */
  locked: z.boolean(),
  fallback: AvatarFallback,
  /** Default achievement keys the student has earned (unlocks; any class+subject). */
  earned: z.array(z.string()),
  /** S24 (D-184): the student's own picture. */
  picture: StudentPictureInfo,
});
export type StudentAvatarInfo = z.infer<typeof StudentAvatarInfo>;

export const studentSetAvatar = endpoint({
  method: 'PUT',
  path: '/api/student/avatar',
  access: 'student',
  input: z.object({ spec: AvatarSpec }),
  output: StudentAvatarInfo,
});

/** A teacher of the student's class (or an admin) resets the avatar to the generated one (audited). */
export const resetStudentAvatar = endpoint({
  method: 'DELETE',
  path: '/api/teacher/students/:studentId/avatar',
  access: 'teacher',
  input: z.object({ studentId: Id }),
  output: Ok,
});

/** `uploads` (S24, D-184): students of the class may send their own picture; `picturesAvailable`: the school switch. */
export const AvatarClassSettings = z.object({ locked: z.boolean(), fallback: AvatarFallback, uploads: z.boolean(), picturesAvailable: z.boolean() });
export const getAvatarSettings = endpoint({
  method: 'GET',
  path: '/api/teacher/classes/:classId/avatar-settings',
  access: 'teacher',
  input: z.object({ classId: Id }),
  output: AvatarClassSettings,
});
export const setAvatarSettings = endpoint({
  method: 'PUT',
  path: '/api/teacher/classes/:classId/avatar-settings',
  access: 'teacher',
  input: z.object({ classId: Id, locked: z.boolean().optional(), fallback: AvatarFallback.optional(), uploads: z.boolean().optional() }),
  output: AvatarClassSettings,
});

// ---------------------------------------------------------------- own pictures (S24, D-184)
/**
 * The student sends one square picture made by the editor (multipart field `file`, at most 8 MB; JPG,
 * PNG or WebP). The server re-encodes it to a 512 px WebP without metadata and keeps it in the
 * quarantine folder until a teacher decides; a new picture replaces (and deletes) a waiting one.
 */
export const studentUploadPicture = endpoint({
  method: 'POST',
  path: '/api/student/avatar-picture',
  access: 'student',
  input: z.object({}),
  output: StudentPictureInfo,
});
/** `pending`: take the waiting picture back (deleted); `refused`: clear the refusal note; `approved`: stop using the picture (deleted). */
export const studentRemovePicture = endpoint({
  method: 'DELETE',
  path: '/api/student/avatar-picture',
  access: 'student',
  input: z.object({ which: z.enum(['pending', 'refused', 'approved']) }),
  output: StudentPictureInfo,
});
/** The student's own waiting or approved picture (raw image; 404 for anything else). */
export const studentPictureImage = endpoint({
  method: 'GET',
  path: '/api/student/avatar-picture/:pictureId',
  access: 'student',
  input: z.object({ pictureId: Id }),
  output: z.unknown(),
});

/**
 * An approved picture for the classroom (cards, lists, groups, reveals): 404 unless the school switch
 * is on, the picture is approved and the teacher teaches the student. Classroom access like the D-077
 * photo, so cards keep working while the teacher area is locked; `v` busts the browser cache.
 */
export const classroomPictureImage = endpoint({
  method: 'GET',
  path: '/api/classroom/students/:studentId/avatar-picture',
  access: 'classroom',
  input: z.object({ studentId: Id, v: z.string().max(64).optional() }),
  output: z.unknown(),
});
export const classroomPictureUrl = (studentId: string, pictureId: string) =>
  `/api/classroom/students/${encodeURIComponent(studentId)}/avatar-picture?v=${encodeURIComponent(pictureId)}`;
export const studentPictureUrl = (pictureId: string) => `/api/student/avatar-picture/${encodeURIComponent(pictureId)}`;

export const PictureListItem = z.object({
  id: z.string(),
  studentId: z.string(),
  studentName: z.string().meta(pii('studentName')),
  /** The student's current class; null (administrators only) for a student without a class now. */
  classId: z.string().nullable(),
  className: z.string().nullable(),
  status: z.enum(['pending', 'approved']),
  sentAt: z.number(),
  /** Pending: when it is deleted if nobody checks it. */
  deleteAt: z.number().nullable(),
  decidedAt: z.number().nullable(),
  /** The picture itself (teacher or admin access, the same checks). */
  url: z.string(),
});
export type PictureListItem = z.infer<typeof PictureListItem>;
export const PictureList = z.object({ enabled: z.boolean(), toCheck: z.array(PictureListItem), inUse: z.array(PictureListItem) });
export type PictureList = z.infer<typeof PictureList>;
const Confirm = z.object({ pictureId: Id, confirm: z.boolean().optional() });
const Refuse = z.object({ pictureId: Id, reason: RefusalReason.optional() });

/** Teacher side: pictures of the students the teacher teaches today (any of their classes). */
export const teacherPictures = endpoint({
  method: 'GET',
  path: '/api/teacher/avatar-pictures',
  access: 'teacher',
  input: z.object({}),
  output: PictureList,
});
/** The menu badge: the number to check (a background poll, PIN-7). */
export const teacherPictureCount = endpoint({
  method: 'GET',
  path: '/api/teacher/avatar-pictures/count',
  access: 'teacher',
  background: true,
  input: z.object({}),
  output: z.object({ enabled: z.boolean(), toCheck: z.number().int() }),
});
/** "Yes, use it": `confirm` must be true (the teacher ticked "Not a photo of the student or anyone they know"), else 400 CONFIRM_REQUIRED. */
export const teacherApprovePicture = endpoint({
  method: 'POST',
  path: '/api/teacher/avatar-pictures/:pictureId/approve',
  access: 'teacher',
  input: Confirm,
  output: Ok,
});
/** "Not this one": `reason` is required (400 REASON_REQUIRED); the picture is deleted at once. */
export const teacherRefusePicture = endpoint({
  method: 'POST',
  path: '/api/teacher/avatar-pictures/:pictureId/refuse',
  access: 'teacher',
  input: Refuse,
  output: Ok,
});
/** Remove an approved picture (deleted at once; the student falls back to their avatar). */
export const teacherRemovePicture = endpoint({
  method: 'DELETE',
  path: '/api/teacher/avatar-pictures/:pictureId',
  access: 'teacher',
  input: z.object({ pictureId: Id }),
  output: Ok,
});
export const teacherPictureImage = endpoint({
  method: 'GET',
  path: '/api/teacher/avatar-pictures/:pictureId/image',
  access: 'teacher',
  input: z.object({ pictureId: Id }),
  output: z.unknown(),
});

/** Admin side: every picture of the school, the same decisions, and "Delete all uploaded pictures". */
export const adminPictures = endpoint({
  method: 'GET',
  path: '/api/admin/avatar-pictures',
  access: 'admin',
  input: z.object({}),
  output: PictureList,
});
export const adminApprovePicture = endpoint({
  method: 'POST',
  path: '/api/admin/avatar-pictures/:pictureId/approve',
  access: 'admin',
  input: Confirm,
  output: Ok,
});
export const adminRefusePicture = endpoint({
  method: 'POST',
  path: '/api/admin/avatar-pictures/:pictureId/refuse',
  access: 'admin',
  input: Refuse,
  output: Ok,
});
export const adminRemovePicture = endpoint({
  method: 'DELETE',
  path: '/api/admin/avatar-pictures/:pictureId',
  access: 'admin',
  input: z.object({ pictureId: Id }),
  output: Ok,
});
export const adminPictureImage = endpoint({
  method: 'GET',
  path: '/api/admin/avatar-pictures/:pictureId/image',
  access: 'admin',
  input: z.object({ pictureId: Id }),
  output: z.unknown(),
});
/** Deletes every waiting and approved picture (typed confirmation `DELETE_ALL_PICTURES_CONFIRM`, audited with counts). */
export const adminDeleteAllPictures = endpoint({
  method: 'POST',
  path: '/api/admin/avatar-pictures/delete-all',
  access: 'admin',
  input: z.object({ confirm: z.string().max(64) }),
  output: z.object({ pending: z.number().int(), approved: z.number().int() }),
});

/** Super Speakers (owner decision d): the picture on the hall board and the scorer, only while the admin setting is on. */
export const boardPictureImage = endpoint({
  method: 'GET',
  path: '/api/board/students/:studentId/picture',
  access: 'display',
  input: z.object({ studentId: Id, v: z.string().max(64).optional() }),
  output: z.unknown(),
});
export const scorerPictureImage = endpoint({
  method: 'GET',
  path: '/api/scorer/students/:studentId/picture',
  access: 'scorer',
  input: z.object({ studentId: Id, v: z.string().max(64).optional() }),
  output: z.unknown(),
});
export const speakersPictureUrl = (where: 'board' | 'scorer', studentId: string, pictureId: string) =>
  `/api/${where}/students/${encodeURIComponent(studentId)}/picture?v=${encodeURIComponent(pictureId)}`;
