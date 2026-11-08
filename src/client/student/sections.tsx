/**
 * Screens for the student page sections the server contributes (`studentPage` in server manifests,
 * shared `StudentPageSection` union). One entry per section key (type-checked: a new key in the union
 * needs a screen here). Kept apart from the client module manifests so the student bundle does not
 * load the teacher app (D-085).
 */
import type { ReactNode } from 'react';
import type { StudentPage, StudentPageSection } from '../../shared/contracts/goals.ts';
import { AchievementsSection } from './AchievementsSection.tsx';
import { GoalsSection } from './GoalsSection.tsx';
import { HomeworkSection } from './HomeworkSection.tsx';

type SectionProps<K extends StudentPageSection['key']> = { data: Extract<StudentPageSection, { key: K }>['data']; subjectId: string; media: StudentPage['media'] };

export const STUDENT_SECTIONS: { [K in StudentPageSection['key']]: (p: SectionProps<K>) => ReactNode } = {
  goals: (p) => <GoalsSection {...p} />,
  homework: (p) => <HomeworkSection data={p.data} subjectId={p.subjectId} />,
  achievements: (p) => <AchievementsSection data={p.data} subjectId={p.subjectId} />,
};
