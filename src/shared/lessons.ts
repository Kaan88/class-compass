/** Lesson/attendance constants shared by contracts, domain logic, server and client. */
export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'] as const;
export const DEFAULT_ROUTINE_ID = 'builtin:default';
export const MAX_STAGES = 20;
export const MAX_TIMER_MS = 3 * 60 * 60 * 1000;

/**
 * Lesson topics / skill focus (S13a, D-101): the icon a topic (a skill category) can show on the
 * classroom display. The topic name is always written next to it; the icon is decoration.
 */
export const TOPIC_ICONS = ['book', 'pen', 'grammar', 'words', 'ear', 'speech', 'letters', 'star', 'music', 'game', 'puzzle', 'paint'] as const;
export type TopicIcon = (typeof TOPIC_ICONS)[number];
/** At most this many topics per lesson (default one). */
export const MAX_LESSON_TOPICS = 3;
