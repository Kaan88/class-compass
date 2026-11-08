/**
 * Avatars history (core module 'avatars', S13c items 9 and 11, D-124): about 70 % of the demo students
 * choose an avatar on their personal page during the first weeks, some a ready-made one and some built
 * in the character creator; a few change it later and use a part they unlocked with a badge. The
 * others keep the generated avatar (the class fallback). Every spec goes through the real save, which
 * validates it against the catalogue (`AvatarSpec`) and checks the unlocks.
 */
import { AVATAR_UNLOCKS, READY_MADE, lockedPartsOf, randomCreature, randomPerson, type AvatarSpecValue } from '../../../shared/avatars.ts';
import { studentSetAvatar } from '../../../shared/contracts/avatars.ts';
import { earnedDefaultKeys, setOwnAvatar } from '../../modules/avatars/service.ts';
import type { HistoryGenerator, HistoryRun, HistoryWeek } from './types.ts';

const KEY = 'avatars';
const SHARE = 0.72;

interface Choice {
  week: number;
  kind: 'ready-made' | 'creator';
  /** Changes it again later (with an unlocked part when one is earned). */
  changeWeek: number | null;
  done: boolean;
}

const choicesOf = (h: HistoryRun) => h.memo(`${KEY}:choices`, () => new Map<string, Choice | null>());

function eveningOf(h: HistoryRun, week: HistoryWeek) {
  h.setTime(h.at(h.pick(week.days), h.pick(['16:20', '17:05', '18:30', '19:45'])) + h.int(0, 30) * 60_000);
}

/** A creator spec; with `unlocked`, one earned part (crown, wizard hat, star glasses, …) is used. */
function creatorSpec(h: HistoryRun, unlocked: readonly string[]): AvatarSpecValue {
  const spec: AvatarSpecValue = h.chance(0.6) ? randomPerson(h.rand) : randomCreature(h.rand);
  const usable = unlocked.filter((k) => !k.startsWith('glasses.') || spec.type === 'person');
  if (!usable.length) return spec;
  const [part, option] = h.pick(usable).split('.') as [string, string];
  return { ...spec, [part]: option } as AvatarSpecValue;
}

export const avatarsGenerator: HistoryGenerator = {
  key: KEY,
  module: null,
  setup(h, plan) {
    const choices = choicesOf(h);
    const last = h.weeks.length - 1;
    for (const s of plan.students) {
      if (choices.has(s.id)) continue;
      if (!h.chance(SHARE)) {
        choices.set(s.id, null);
        continue;
      }
      const week = h.int(0, Math.min(2, last));
      choices.set(s.id, { week, kind: h.chance(0.45) ? 'ready-made' : 'creator', changeWeek: h.chance(0.15) && week + 3 <= last ? h.int(week + 3, last) : null, done: false });
    }
  },
  endOfWeek(h, plan, week) {
    const choices = choicesOf(h);
    for (const s of plan.students) {
      const c = choices.get(s.id);
      if (!c) continue;
      if (!c.done && c.week === week.index) {
        c.done = true;
        eveningOf(h, week);
        const spec = c.kind === 'ready-made' ? h.pick(READY_MADE) : creatorSpec(h, []);
        h.call(studentSetAvatar, setOwnAvatar, h.student(s.id), { spec });
        h.count(KEY, c.kind === 'ready-made' ? 'ready-made avatars chosen' : 'avatars built in the creator');
      } else if (c.done && c.changeWeek === week.index) {
        c.changeWeek = null;
        eveningOf(h, week);
        const earned = new Set(earnedDefaultKeys(h.deps.db, s.id));
        const unlocked = Object.keys(AVATAR_UNLOCKS).filter((k) => earned.has(AVATAR_UNLOCKS[k]!));
        const spec = creatorSpec(h, unlocked);
        h.call(studentSetAvatar, setOwnAvatar, h.student(s.id), { spec });
        h.count(KEY, lockedPartsOf(spec).length ? 'avatars changed (with an unlocked part)' : 'avatars changed');
      }
    }
  },
};
