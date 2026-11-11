/**
 * Frozen avatar defaults (S17c, D-169; S13c item 9, D-124). A child's avatar never changes or
 * disappears: the generated avatar of a child who never chose one and the 120 ready-made avatars are
 * pinned to the v1 copy captured from origin/main before S17c (`avatars-v1.golden.json`), and every
 * v1 catalogue key still exists, so every stored spec stays valid and is drawn as the same character.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AVATAR_COLOURS, CREATURE_FAMILIES, CREATURE_PARTS, HAIR_COLOURS, PERSON_PARTS, READY_MADE, SKIN_TONES, generatedAvatar, hashOf, seededRandom } from '../../src/shared/avatars.ts';
import { AvatarSpec } from '../../src/shared/contracts/avatars.ts';

interface Golden {
  catalogue: {
    colours: string[];
    skinTones: string[];
    hairColours: string[];
    personParts: Record<string, string[]>;
    creatureFamilies: Record<string, string[]>;
    creatureParts: Record<string, string[]>;
  };
  generated: Array<[string, unknown]>;
  readyMade: unknown[];
}
const golden = JSON.parse(fs.readFileSync(new URL('./avatars-v1.golden.json', import.meta.url), 'utf8')) as Golden;

describe('frozen avatar defaults (D-169)', () => {
  it('the generated avatar of 20 fixed student ids is exactly the v1 one', () => {
    expect(golden.generated).toHaveLength(20);
    for (const [id, spec] of golden.generated) expect(generatedAvatar(id), id).toEqual(spec);
  });

  it('all 120 ready-made avatars are exactly the v1 ones, in the same order', () => {
    expect(golden.readyMade).toHaveLength(120);
    expect(READY_MADE).toEqual(golden.readyMade);
  });

  it('every frozen default is still a valid spec (the catalogue only grows)', () => {
    for (const spec of [...golden.readyMade, ...golden.generated.map(([, s]) => s)]) expect(AvatarSpec.safeParse(spec).success, JSON.stringify(spec)).toBe(true);
  });

  it('the hash and the random numbers are unchanged', () => {
    expect(hashOf('avatar:x')).toBe(45157638);
    expect(hashOf('')).toBe(2166136261);
    const r = seededRandom(1);
    expect([r(), r(), r()].map((x) => Math.round(x * 1e9))).toEqual([627073941, 2735721, 527447040]);
  });
});

describe('catalogue keys are only added, never removed or renamed (D-169)', () => {
  const missing = (v1: readonly string[], now: readonly string[]) => v1.filter((k) => !now.includes(k));
  it('colours, skin tones and hair colours', () => {
    expect(missing(golden.catalogue.colours, AVATAR_COLOURS)).toEqual([]);
    expect(missing(golden.catalogue.skinTones, SKIN_TONES)).toEqual([]);
    expect(missing(golden.catalogue.hairColours, HAIR_COLOURS)).toEqual([]);
  });
  it('person parts and their options', () => {
    for (const [part, options] of Object.entries(golden.catalogue.personParts)) {
      const now = (PERSON_PARTS as unknown as Record<string, readonly string[]>)[part];
      expect(now, part).toBeDefined();
      expect(missing(options, now!), part).toEqual([]);
    }
  });
  it('creature families, their species and the creature parts', () => {
    for (const [family, species] of Object.entries(golden.catalogue.creatureFamilies)) {
      const now = (CREATURE_FAMILIES as unknown as Record<string, readonly string[]>)[family];
      expect(now, family).toBeDefined();
      expect(missing(species, now!), family).toEqual([]);
    }
    for (const [part, options] of Object.entries(golden.catalogue.creatureParts)) {
      const now = (CREATURE_PARTS as unknown as Record<string, readonly string[]>)[part];
      expect(now, part).toBeDefined();
      expect(missing(options, now!), part).toEqual([]);
    }
  });
});
