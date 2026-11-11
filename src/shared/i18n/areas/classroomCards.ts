/**
 * Strings of the marks on the classroom student cards (S22c, D-177): this lesson's achievements and the
 * group number. An area dictionary (D-179): registered when the achievements or grouping panels are
 * imported (the classroom board), so the student page never loads it (D-151 budget).
 */
import { registerMessages } from '../index.ts';

export const en = {
  'grouping.cardGroup': 'In group {n}',
  'achievements.cardCount': '{count} achievements this lesson',
  'achievements.cardCount_one': '{count} achievement this lesson',
  'achievements.cardCount_other': '{count} achievements this lesson',
};

export const tr: Record<keyof typeof en, string> = {
  'grouping.cardGroup': '{n}. grupta',
  'achievements.cardCount': 'Bu derste {count} başarı',
  'achievements.cardCount_one': 'Bu derste {count} başarı',
  'achievements.cardCount_other': 'Bu derste {count} başarı',
};

export const classroomCardsMessages = { en, tr };
registerMessages(classroomCardsMessages);
