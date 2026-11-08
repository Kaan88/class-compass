/**
 * Avatars (S13c items 9 and 11, D-124, D-125). The spec is validated against the shared catalogue
 * (`src/shared/avatars.ts`): `.strict()` objects of enums only, so an unknown part, option or colour
 * is refused with 400 VALIDATION. Avatars are not photos: no media flag applies.
 */
import { z } from 'zod';
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
    students: z.array(z.object({ id: z.string(), classId: z.string(), spec: AvatarSpec.nullable() })),
  }),
});

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

export const AvatarClassSettings = z.object({ locked: z.boolean(), fallback: AvatarFallback });
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
  input: z.object({ classId: Id, locked: z.boolean().optional(), fallback: AvatarFallback.optional() }),
  output: AvatarClassSettings,
});
