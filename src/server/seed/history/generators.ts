/**
 * Demo history generator registry (seed:demo-history). One line per module; see docs/EXTENDING.md
 * "Demo history generators". The order is the order in which hooks run within each step (for a
 * lesson: attendance first, so later generators see who is in the room; achievements after the
 * modules whose activity earns badges; Super Speakers last, at school level).
 */
import { achievementsGenerator } from './achievements.ts';
import { assistantGenerator } from './assistant.ts';
import { attendanceGenerator } from './attendance.ts';
import { avatarsGenerator } from './avatars.ts';
import { countersGenerator } from './counters.ts';
import { goalsGenerator } from './goals.ts';
import { groupingGenerator } from './grouping.ts';
import { homeworkGenerator } from './homework.ts';
import { lessonsGenerator } from './lessons.ts';
import { routinesGenerator } from './routines.ts';
import { secretGenerator } from './secret.ts';
import { superSpeakersGenerator } from './superSpeakers.ts';
import type { HistoryGenerator } from './types.ts';

export const HISTORY_GENERATORS: readonly HistoryGenerator[] = [
  attendanceGenerator,
  lessonsGenerator,
  routinesGenerator,
  groupingGenerator,
  countersGenerator,
  secretGenerator,
  assistantGenerator,
  homeworkGenerator,
  goalsGenerator,
  achievementsGenerator,
  avatarsGenerator,
  superSpeakersGenerator,
];
