/**
 * Strings of the classroom board's dock on a phone (S23b, D-183): the button that shows the dock
 * buttons that do not fit on its one line. An area dictionary (D-179): registered when the board's
 * dock is imported, so the student page never loads it (D-151 budget).
 */
import { registerMessages } from '../index.ts';

export const en = {
  'board.dockMore': 'More',
  'board.dockFewer': 'Fewer',
};

export const tr: Record<keyof typeof en, string> = {
  'board.dockMore': 'Diğer',
  'board.dockFewer': 'Daha az',
};

export const classroomDockMessages = { en, tr };
registerMessages(classroomDockMessages);
