/**
 * Lesson goals (S25d, D-188): one short goal sentence a teacher may set for a lesson of a class+subject
 * where the Lesson goals module is on ("We can ask and answer about the weather."), shown on the
 * classroom board and reviewed at End Lesson. Plain constants, shared by the server and the client.
 */

/** How the class did with the goal at End Lesson. Words, never a score or a colour alone. */
export const LESSON_GOAL_OUTCOMES = ['reached', 'partly', 'notYet'] as const;
export type LessonGoalOutcome = (typeof LESSON_GOAL_OUTCOMES)[number];

/** A goal is one short sentence the class can read from the board. */
export const MAX_LESSON_GOAL_LENGTH = 140;
