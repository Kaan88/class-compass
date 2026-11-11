/**
 * Frozen avatar defaults (S17c, D-169). A child who never chose an avatar sees `generatedAvatar(id)`
 * (the class fallback "generated"), and the picker offers the 120 `READY_MADE` avatars. Both used to
 * draw from the live catalogue lists, so adding a family, species, colour, option or unlock silently
 * changed the creature of every child who never chose one. They now draw only from the FROZEN v1
 * lists below, so the catalogue can grow without changing anybody's avatar.
 *
 * NEVER EDIT THIS FILE (lists, hash, random numbers or order of the draws). Golden tests
 * (`tests/client/avatars-defaults.test.ts`) pin 20 generated avatars and all 120 ready-made ones to
 * the copy taken from origin/main before S17c. New families or looks go into the live catalogue
 * (`avatars.ts`); a later ready-made set would be appended as its own frozen list, never by changing
 * this one.
 */
import type { CreatureSpec } from './avatars.ts';

/** FNV-1a: a small stable hash. */
export function hashOf(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic random numbers from a seed (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- the v1 lists (frozen)
const V1_COLOURS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'navy', 'purple', 'pink', 'brown', 'grey', 'mint'] as const;
const V1_FAMILIES = {
  animals: ['cat', 'bear', 'bunny'],
  monsters: ['blob', 'horns', 'fluffy'],
  robots: ['boxy', 'round', 'antenna'],
  aliens: ['antennae', 'threeEyes', 'bigHead'],
  dinosaurs: ['rex', 'spikes', 'longNeck'],
  fruits: ['apple', 'carrot', 'strawberry'],
  sea: ['fish', 'octopus', 'crab'],
  mythical: ['unicorn', 'dragon', 'phoenix'],
  space: ['astronaut', 'pilot', 'starKid'],
  sports: ['football', 'basketball', 'tennis'],
} as const;
type V1Family = keyof typeof V1_FAMILIES;
const V1_FAMILY_KEYS = Object.keys(V1_FAMILIES) as V1Family[];
const V1_EYES = ['dots', 'round', 'happy', 'wink', 'sparkle', 'sleepy', 'big', 'lashes'] as const;
const V1_MOUTHS = ['smile', 'grin', 'laugh', 'small', 'tongue', 'calm', 'teeth', 'cat'] as const;
/** The hats, extras and backgrounds that needed no unlock in v1 (in catalogue order). */
const V1_FREE_HATS = ['none', 'cap', 'beanie', 'flowers', 'headband', 'party', 'bucket'] as const;
const V1_FREE_ACCESSORIES = ['none', 'scarf', 'headphones', 'backpack', 'ball', 'book'] as const;
const V1_FREE_BGS = ['circle', 'rings', 'stripes', 'dots', 'waves', 'hills'] as const;
const V1_READY_BGS = ['circle', 'rings', 'dots', 'waves'] as const;

const pick = <T,>(xs: readonly T[], rnd: () => number): T => xs[Math.floor(rnd() * xs.length)]!;

/** v1 `randomCreature`, draw for draw (the order of the draws is part of the frozen result). */
function v1Creature(rnd: () => number, family?: V1Family): CreatureSpec {
  const f = family ?? pick(V1_FAMILY_KEYS, rnd);
  return {
    v: 1,
    type: 'creature',
    family: f,
    species: pick(V1_FAMILIES[f], rnd),
    color: pick(V1_COLOURS, rnd),
    eyes: pick(V1_EYES, rnd),
    mouth: pick(V1_MOUTHS, rnd),
    hat: rnd() < 0.6 ? 'none' : pick(V1_FREE_HATS, rnd),
    accessory: rnd() < 0.6 ? 'none' : pick(V1_FREE_ACCESSORIES, rnd),
    accentColor: pick(V1_COLOURS, rnd),
    bg: pick(V1_FREE_BGS, rnd),
    bgColor: pick(V1_COLOURS, rnd),
  };
}

/** The avatar shown before a student chooses one: a creature generated from a stable hash of the id (item 9). Frozen (D-169). */
export const generatedAvatar = (studentId: string): CreatureSpec => v1Creature(seededRandom(hashOf(`avatar:${studentId}`)));

/** Ready-made avatars: 10 families × 3 characters × 4 looks = 120, frozen (D-169). */
export const READY_MADE: readonly CreatureSpec[] = V1_FAMILY_KEYS.flatMap((family) =>
  (V1_FAMILIES[family] as readonly string[]).flatMap((species) =>
    [0, 1, 2, 3].map((look): CreatureSpec => {
      const base = v1Creature(seededRandom(hashOf(`${family}.${species}.${look}`)), family);
      return { ...base, species, color: V1_COLOURS[(hashOf(species) + look * 3) % V1_COLOURS.length]!, bg: V1_READY_BGS[look]! };
    }),
  ),
);
