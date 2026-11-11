/**
 * Screens for the student page sections the server contributes (`studentPage` in server manifests,
 * shared `StudentPageSection` union). Since S14d (D-151, refines D-085) the page is a home screen of
 * tiles plus short-step screens: each section key lists its tiles and the screen each tile opens
 * (type-checked: a new key in the union needs an entry here). Kept apart from the client module
 * manifests so the student bundle does not load the teacher app.
 */
import { lazy, type ReactNode } from 'react';
import type { StudentPage, StudentPageSection } from '../../shared/contracts/goals.ts';
import type { MessageKey } from '../../shared/i18n/index.ts';
import { IconClipboardCheck, IconFace, IconPlus, IconTarget, IconTrophy, IconUpload } from '../ui/icons.tsx';
import { AchievementsSection } from './AchievementsSection.tsx';
import { HomeworkSection } from './HomeworkSection.tsx';
import type { NavApi, Screen } from './nav.ts';
import { MyGoals } from './screens/MyGoals.tsx';

/**
 * The writing screens (New goal, How is it going?, Show my work) with the text checks and sentence
 * starters they share are lazy chunks (S26c, D-191; budget D-151): the page renders without them and
 * `preloadWritingScreens` fetches them as soon as the page has rendered, so opening one normally does
 * not wait (the screen frame shows "Loading…" if it still has to). My goals, the first tile, stays eager.
 */
const loadNewGoal = () => import('./screens/NewGoal.tsx');
const loadHowIsItGoing = () => import('./screens/HowIsItGoing.tsx');
const loadShowMyWork = () => import('./screens/ShowMyWork.tsx');
const NewGoal = lazy(() => loadNewGoal().then((m) => ({ default: m.NewGoal })));
const HowIsItGoing = lazy(() => loadHowIsItGoing().then((m) => ({ default: m.HowIsItGoing })));
const ShowMyWork = lazy(() => loadShowMyWork().then((m) => ({ default: m.ShowMyWork })));

/** Fetches the lazy writing screens in the background (errors are ignored here; opening a screen loads it). */
export function preloadWritingScreens(): void {
  for (const load of [loadNewGoal, loadHowIsItGoing, loadShowMyWork]) load().catch(() => undefined);
}

export type SectionKey = StudentPageSection['key'];
type DataOf<K extends SectionKey> = Extract<StudentPageSection, { key: K }>['data'];

/** What a section screen gets: its data, the subject, the media flags and the page navigation. */
export interface ScreenProps<D> {
  data: D;
  subjectId: string;
  media: StudentPage['media'];
  nav: NavApi['nav'];
  go: NavApi['go'];
  finish: NavApi['finish'];
  /** The id of the screen's h1 (for a section that names itself with it). */
  titleId: string;
}

export interface SectionScreen<K extends SectionKey> {
  screen: Screen;
  label: MessageKey;
  Icon: () => React.JSX.Element;
  /** Shown only when this is true for the section's data (default: always). */
  show?: (data: DataOf<K>) => boolean;
  /** A small "New!" mark on the tile. */
  isNew?: (data: DataOf<K>) => boolean;
  render: (p: ScreenProps<DataOf<K>>) => ReactNode;
}

const FaceIcon = () => <IconFace level={4} />;

export const STUDENT_SECTIONS: { [K in SectionKey]: Array<SectionScreen<K>> } = {
  goals: [
    { screen: 'goals', label: 'student.tile.goals', Icon: IconTarget, render: (p) => <MyGoals {...p} /> },
    { screen: 'newGoal', label: 'student.tile.newGoal', Icon: IconPlus, show: (d) => d.canWrite, render: (p) => <NewGoal {...p} /> },
    { screen: 'howIsItGoing', label: 'student.tile.howIsItGoing', Icon: FaceIcon, show: (d) => d.canWrite, render: (p) => <HowIsItGoing {...p} /> },
    { screen: 'showMyWork', label: 'student.tile.showMyWork', Icon: IconUpload, render: (p) => <ShowMyWork {...p} /> },
  ],
  achievements: [
    {
      screen: 'achievements',
      label: 'student.tile.achievements',
      Icon: IconTrophy,
      isNew: (d) => d.earned.some((b) => b.isNew),
      render: (p) => <AchievementsSection data={p.data} subjectId={p.subjectId} titleId={p.titleId} />,
    },
  ],
  homework: [{ screen: 'homework', label: 'student.tile.homework', Icon: IconClipboardCheck, render: (p) => <HomeworkSection data={p.data} subjectId={p.subjectId} titleId={p.titleId} /> }],
};

/** The order of the tiles on the home screen (the avatar tile comes last and belongs to no section). */
export const TILE_ORDER: readonly Screen[] = ['goals', 'newGoal', 'howIsItGoing', 'showMyWork', 'achievements', 'homework'];

export interface Tile {
  screen: Screen;
  label: MessageKey;
  Icon: () => React.JSX.Element;
  isNew: boolean;
  render: (p: Omit<ScreenProps<unknown>, 'data'>) => ReactNode;
}

/** The tiles (and their screens) of one subject: only for sections it has, in the home order. */
export function tilesOf(sections: readonly StudentPageSection[]): Tile[] {
  const out: Tile[] = [];
  for (const section of sections) {
    const list = STUDENT_SECTIONS[section.key] as Array<SectionScreen<SectionKey>> | undefined;
    for (const s of list ?? []) {
      const data = section.data as DataOf<SectionKey>;
      if (s.show && !(s.show as (d: unknown) => boolean)(data)) continue;
      out.push({
        screen: s.screen,
        label: s.label,
        Icon: s.Icon,
        isNew: s.isNew ? (s.isNew as (d: unknown) => boolean)(data) : false,
        render: (p) => (s.render as (q: ScreenProps<unknown>) => ReactNode)({ ...p, data }),
      });
    }
  }
  return out.sort((a, b) => TILE_ORDER.indexOf(a.screen) - TILE_ORDER.indexOf(b.screen));
}
