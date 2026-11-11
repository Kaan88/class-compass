/**
 * The assistant chat in the teacher area (S19b, D-180): the limits and words both sides agree on.
 * The chat runs on the server (`server/modules/assistantChat/`): it sends the teacher's message and the
 * tools that teacher may use to a connection (D-179), runs read-only tools at once as that teacher
 * through the AI tools layer (D-160, D-161), and asks the teacher before any change.
 */

/** The longest message a teacher can send (characters). */
export const ASSISTANT_MESSAGE_MAX = 8000;
export const ASSISTANT_TITLE_MAX = 80;
export const ASSISTANT_SEARCH_MAX = 100;
/** Chats per teacher (oldest archived ones first should be deleted by the teacher; the retention job does the rest). */
export const ASSISTANT_CHATS_MAX = 500;
/** Rounds of model replies with tool calls in one answer before the server stops the loop. */
export const ASSISTANT_MAX_ROUNDS = 8;
/** Tool calls the server runs from one model reply (more are refused). */
export const ASSISTANT_MAX_CALLS_PER_ROUND = 10;

/** Retention (owner decision 2026-11-11): a school year after the last message by default; the administrator may change it. */
export const ASSISTANT_RETENTION_DEFAULT_DAYS = 365;
export const ASSISTANT_RETENTION_MIN_DAYS = 30;
export const ASSISTANT_RETENTION_MAX_DAYS = 3650;

/** Why the chat cannot be used right now (the page explains each one). */
export const ASSISTANT_UNAVAILABLE = ['OFF', 'AI_TOOLS_OFF', 'NO_CONNECTION'] as const;
export type AssistantUnavailable = (typeof ASSISTANT_UNAVAILABLE)[number];

/** How an answer ended: complete, waiting for the teacher's Yes/No, stopped by the teacher, failed, or stopped by the screen lock. */
export const ASSISTANT_RUN_ENDS = ['complete', 'awaiting', 'cancelled', 'error', 'locked'] as const;
export type AssistantRunEnd = (typeof ASSISTANT_RUN_ENDS)[number];

/**
 * Pseudonyms as the provider sees them while the student-data switch is off (D-161): "Student 4" in text
 * and `student-4` as an id. The browser gets real names back (mapped on the server).
 */
export const PSEUDONYM_TEXT = /\b(?:Student (\d{1,7})|student-(\d{1,7}))\b/gu;
