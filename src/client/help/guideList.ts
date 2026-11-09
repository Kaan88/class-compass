/** The user guides (docs/guides/<lang>/<id>.md) and their titles in the Help screen. */
import type { MessageKey } from '../../shared/i18n/index.ts';

/** Guides in the order the Help screen lists them. File name = id. */
export const GUIDE_IDS = ['quick-start-teacher', 'teacher', 'quick-start-admin', 'admin', 'super-speakers', 'scorer', 'board-screen', 'ai-tools', 'quick-start-student', 'student'] as const;
export type GuideId = (typeof GUIDE_IDS)[number];

export const GUIDE_TITLE_KEYS: Record<GuideId, MessageKey> = {
  'quick-start-teacher': 'help.guide.quickStartTeacher',
  teacher: 'help.guide.teacher',
  'quick-start-admin': 'help.guide.quickStartAdmin',
  admin: 'help.guide.admin',
  'super-speakers': 'help.guide.superSpeakers',
  scorer: 'help.guide.scorer',
  'board-screen': 'help.guide.boardScreen',
  'ai-tools': 'help.guide.aiTools',
  'quick-start-student': 'help.guide.quickStartStudent',
  student: 'help.guide.student',
};

export const isGuideId = (s: unknown): s is GuideId => typeof s === 'string' && (GUIDE_IDS as readonly string[]).includes(s);

