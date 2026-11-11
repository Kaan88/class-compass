/**
 * Students' own avatar pictures (S24, D-184; owner request 2026-11-11). Shared numbers and keys of the
 * upload, the teacher's check and the clean-up; the server enforces every one of them again.
 *
 * - A picture is sent from the student page (one square picture made on the device), waits in a
 *   quarantine folder outside the backed-up uploads until a teacher of the student says "Yes, use it",
 *   and only then is it moved into the uploads (backed up, exported) and shown to anyone else.
 * - "Not this one" asks for a reason the student sees and deletes the picture at once; a picture nobody
 *   checked is deleted after `PENDING_DAYS` days.
 */

/** Days an unchecked picture waits before it is deleted (owner decision b). */
export const PENDING_DAYS = 14;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const PENDING_MS = PENDING_DAYS * DAY_MS;
/** The teacher's list warns from this many days before the deletion. */
export const EXPIRY_WARNING_DAYS = 3;

/** The square picture the editor makes and the server stores (pixels per side). */
export const AVATAR_PICTURE_EDGE = 512;
/** Largest upload the server reads (bytes). The editor's 512 px picture is far smaller. */
export const AVATAR_PICTURE_MAX_BYTES = 8 * 1024 * 1024;
/** Pictures wider or taller than this are refused before decoding (pixels). */
export const AVATAR_PICTURE_MAX_DIMENSION = 8000;
/** Uploads per student per hour (a new picture replaces the waiting one, so this only stops loops). */
export const AVATAR_PICTURE_UPLOADS_PER_HOUR = 10;

/** What the editor's file picker offers (the server sniffs the bytes; HEIC is converted on the device where it can be). */
export const AVATAR_PICTURE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

/** Reasons a teacher gives for "Not this one"; the student sees the reason in words. */
export const REFUSAL_REASONS = ['knownPerson', 'unkind', 'namePlace', 'hardToSee'] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/** What the student page can do with their own picture now. */
export const PICTURE_STATES = ['off', 'classOff', 'locked', 'open'] as const;
export type PictureState = (typeof PICTURE_STATES)[number];

/** The word an administrator types to delete every uploaded picture (same word in both languages, like the full export). */
export const DELETE_ALL_PICTURES_CONFIRM = 'DELETE PICTURES';

/** The days left (rounded up, at least 0) before a waiting picture is deleted. */
export const daysLeft = (expiresAt: number, now: number) => Math.max(0, Math.ceil((expiresAt - now) / DAY_MS));
