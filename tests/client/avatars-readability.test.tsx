// @vitest-environment jsdom
/**
 * Avatar readability and fairness (S17c, D-169; S13c items 9–11, D-124, UX-7). Same specs, re-rendered:
 * features (ink on a light rim) read on every body colour and skin tone in every built-in theme and the
 * Snow Day example; creature faces are larger; body and background never blend; hats keep ears,
 * horns and leaves in front; scarves go round each species' neck; Randomise never gives body =
 * background; the plain families have their details. Fictional data only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AvatarArt, FACE_SCALE, FEATURE_RIM, accessoryTransform, faceOf } from '../../src/client/avatars/AvatarArt.tsx';
import { contrast } from '../../src/client/themes/contrast.ts';
import { THEME_LIST } from '../../src/client/themes/registry.ts';
import { AVATAR_COLOURS, CREATURE_FAMILIES, CREATURE_FAMILY_KEYS, CREATURE_PARTS, PERSON_PARTS, SKIN_TONES, coloursClash, randomCreature, randomPerson, seededRandom, type AvatarColour, type CreatureFamily, type CreatureSpec, type PersonSpec } from '../../src/shared/avatars.ts';

const html = (spec: CreatureSpec | PersonSpec) => renderToStaticMarkup(createElement(AvatarArt, { spec, size: 48 }));
const parse = (svg: string) => new DOMParser().parseFromString(svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'), 'image/svg+xml');
const SPECIES = CREATURE_FAMILY_KEYS.flatMap((family) => (CREATURE_FAMILIES[family] as readonly string[]).map((species) => ({ family, species })));
const creature = (family: CreatureFamily, species: string, over: Partial<CreatureSpec> = {}): CreatureSpec => ({ v: 1, type: 'creature', family, species, color: 'blue', eyes: 'dots', mouth: 'smile', hat: 'none', accessory: 'none', accentColor: 'red', bg: 'circle', bgColor: 'yellow', ...over });
const person = (over: Partial<PersonSpec> = {}): PersonSpec => ({
  v: 1,
  type: 'person',
  body: 'round',
  skin: 'skin12',
  face: 'round',
  hair: 'short',
  hairColor: 'black',
  eyes: 'dots',
  brows: 'flat',
  mouth: 'smile',
  glasses: 'none',
  cheeks: 'none',
  top: 'tshirt',
  topColor: 'blue',
  hat: 'none',
  accessory: 'none',
  accentColor: 'red',
  pet: 'none',
  bg: 'circle',
  bgColor: 'yellow',
  ...over,
});

const snowDay = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'docs/examples/peppermint-snow-day.theme.json'), 'utf8')) as { key: string; colors: Record<string, string> };
const PALETTES: Array<[string, Record<string, string>]> = [...THEME_LIST.map((t): [string, Record<string, string>] => [t.key, t.colors as Record<string, string>]), [snowDay.key, snowDay.colors]];

describe('features read on every body colour and skin tone (D-169, fairness)', () => {
  it.each(PALETTES)('%s: ink or its light rim reaches 3:1 against every body and skin; ink vs rim too', (_key, c) => {
    const ink = c[FEATURE_RIM.ink]!;
    const rim = c[FEATURE_RIM.token]!;
    expect(contrast(ink, rim)).toBeGreaterThanOrEqual(3);
    const bodies = [...AVATAR_COLOURS.map((x) => `avatar-${x}`), ...SKIN_TONES.map((_, i) => `avatar-skin-${i + 1}`)];
    for (const b of bodies) {
      const best = Math.max(contrast(ink, c[b]!), contrast(rim, c[b]!));
      expect(best, `${b}: ink ${contrast(ink, c[b]!).toFixed(2)}, rim ${contrast(rim, c[b]!).toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
  });

  const RIM = `var(--cc-${FEATURE_RIM.token})`;
  const INK = `var(--cc-${FEATURE_RIM.ink})`;
  it('every eye style draws ink together with the light rim or a light white of the eye, on creatures and people', () => {
    for (const eyes of CREATURE_PARTS.eyes) {
      for (const spec of [creature('animals', 'cat', { eyes }), person({ eyes })]) {
        const part = parse(html(spec)).querySelector('[data-part="eyes"]')!;
        const out = part.outerHTML;
        expect(out, `${spec.type} ${eyes}`).toContain(INK);
        expect(out, `${spec.type} ${eyes}`).toContain(RIM);
      }
    }
  });

  it('every person mouth line sits on the light rim', () => {
    for (const mouth of PERSON_PARTS.mouth) {
      const out = parse(html(person({ mouth }))).querySelector('[data-part="mouth"]')!.outerHTML;
      expect(out, mouth).toContain(INK);
      expect(out, mouth).toContain(RIM);
    }
  });
});

describe('larger creature faces (D-169)', () => {
  it('front views are FACE_SCALE larger; side-view dinosaur faces are never below 0.75 of that', () => {
    expect(FACE_SCALE).toBeCloseTo(1.4);
    for (const { family, species } of SPECIES) {
      const f = faceOf({ species });
      expect(f.eyes.scale, species).toBeGreaterThanOrEqual(0.75);
      const eyes = parse(html(creature(family, species))).querySelector('[data-part="eyes"]')!.parentElement!;
      const scale = Number(/scale\(([\d.]+)\)/.exec(eyes.getAttribute('transform') ?? '')?.[1]);
      expect(scale, species).toBeCloseTo(f.eyes.scale * FACE_SCALE);
    }
  });
});

describe('body and background never blend (D-169)', () => {
  const clashing: Array<[AvatarColour, AvatarColour]> = AVATAR_COLOURS.flatMap((a) => AVATAR_COLOURS.filter((b) => coloursClash(a, b)).map((b): [AvatarColour, AvatarColour] => [a, b]));
  it('the same colour or a near pair gets a lighter background veil and a rimmed body; other pairs do not', () => {
    expect(clashing.length).toBeGreaterThan(AVATAR_COLOURS.length);
    for (const [color, bgColor] of clashing) {
      const out = html(creature('robots', 'round', { color, bgColor }));
      expect(out, `${color} on ${bgColor}`).toContain('data-part="veil"');
      expect(out, `${color} on ${bgColor}`).toContain('data-part="rim"');
      expect(html(person({ topColor: color, bgColor })), `${color} on ${bgColor}`).toContain('data-part="veil"');
    }
    expect(html(creature('robots', 'round', { color: 'navy', bgColor: 'yellow' }))).not.toContain('data-part="veil"');
  });

  it('Randomise never gives a body on its own or a near background colour (1,000 draws each)', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const c = randomCreature(seededRandom(seed));
      expect(coloursClash(c.color, c.bgColor), JSON.stringify(c)).toBe(false);
      const p = randomPerson(seededRandom(seed));
      expect(coloursClash(p.topColor, p.bgColor), JSON.stringify(p)).toBe(false);
    }
  });
});

describe('hats and extras never disappear into the body or background (S17c review)', () => {
  const ACCENT_HATS = CREATURE_PARTS.hat.filter((h) => h !== 'none' && h !== 'crown');
  const ACCENT_EXTRAS = CREATURE_PARTS.accessory.filter((a) => a !== 'none' && a !== 'wand');
  const edgeOf = (out: string, part: string) => parse(out).querySelector(`[data-part="${part}"] [data-part="accent-edge"]`);

  it('every accent hat and extra gets an ink-and-light edge when its colour equals the body or the background, on every species', () => {
    for (const { family, species } of SPECIES) {
      for (const hat of ACCENT_HATS) {
        for (const over of [{ color: 'orange', accentColor: 'orange', bgColor: 'navy' }, { color: 'navy', accentColor: 'yellow', bgColor: 'yellow' }] as const) {
          const edge = edgeOf(html(creature(family, species, { hat, ...over })), 'hat');
          expect(edge, `${species} ${hat} ${JSON.stringify(over)}`).not.toBeNull();
          expect(edge!.querySelector('path, rect, circle'), `${species} ${hat}`).not.toBeNull();
        }
      }
      for (const accessory of ACCENT_EXTRAS) {
        const edge = edgeOf(html(creature(family, species, { accessory, color: 'teal', accentColor: 'teal', bgColor: 'yellow' })), 'accessory');
        expect(edge, `${species} ${accessory}`).not.toBeNull();
      }
    }
  });

  it('no edge when the accent stands apart, so ordinary avatars look as before', () => {
    expect(coloursClash('red', 'blue') || coloursClash('red', 'yellow')).toBe(false);
    expect(html(creature('animals', 'cat', { hat: 'cap', accessory: 'scarf', color: 'blue', accentColor: 'red', bgColor: 'yellow' }))).not.toContain('accent-edge');
  });

  it('people: hats and extras near the clothes or the background get the edge too', () => {
    for (const hat of PERSON_PARTS.hat.filter((h) => h !== 'none' && h !== 'crown')) {
      expect(html(person({ hat, accentColor: 'yellow', bgColor: 'yellow' })), hat).toContain('data-part="accent-edge"');
    }
    for (const accessory of PERSON_PARTS.accessory.filter((a) => a !== 'none' && a !== 'wand')) {
      expect(html(person({ accessory, accentColor: 'blue', topColor: 'blue' })), accessory).toContain('data-part="accent-edge"');
    }
  });

  it('Randomise never draws a hat and extra colour near the body or the background (1,000 draws each)', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const c = randomCreature(seededRandom(seed));
      expect(coloursClash(c.accentColor, c.color) || coloursClash(c.accentColor, c.bgColor), JSON.stringify(c)).toBe(false);
      const p = randomPerson(seededRandom(seed));
      expect(coloursClash(p.accentColor, p.topColor) || coloursClash(p.accentColor, p.bgColor), JSON.stringify(p)).toBe(false);
    }
  });
});

describe('hats and scarves per species (D-169)', () => {
  it('ears, horns and carrot leaves stay in front of every hat', () => {
    const cases: Array<[CreatureFamily, string, string]> = [
      ['animals', 'cat', 'ears'],
      ['animals', 'bunny', 'ears'],
      ['animals', 'bear', 'ears'],
      ['monsters', 'horns', 'horns'],
      ['fruits', 'carrot', 'leaves'],
    ];
    for (const [family, species, front] of cases) {
      for (const hat of PERSON_PARTS.hat.filter((h) => h !== 'none')) {
        const out = html(creature(family, species, { hat }));
        expect(out.indexOf(`data-part="${front}"`), `${species} ${hat}`).toBeGreaterThan(out.indexOf('data-part="hat"'));
      }
    }
  });

  it('every species has its own hat height: the hat band sits on the head top, not the v1 default', () => {
    const tops = new Set(SPECIES.map(({ species }) => faceOf({ species }).hat.top));
    expect(tops.size).toBeGreaterThan(8);
    for (const species of ['cat', 'bunny', 'fluffy', 'round', 'carrot', 'strawberry']) expect(faceOf({ species }).hat.top, species).not.toBe(22);
  });

  it('the scarf goes round the narrow neck of the carrot, strawberry, star kid, octopus and big-headed alien', () => {
    for (const species of ['carrot', 'strawberry', 'starKid', 'octopus', 'bigHead']) expect(accessoryTransform(species, 'scarf'), species).toBeDefined();
    const t = accessoryTransform('carrot', 'scarf')!;
    expect(Number(/scale\(([\d.]+)\)/.exec(t)?.[1])).toBeLessThan(1);
  });
});

describe('richer plain families (D-169)', () => {
  const body = (family: CreatureFamily, species: string) => html(creature(family, species));
  it('the rocket pilot has a rocket and goggles; the football keeps its face on white with coloured patches', () => {
    expect(body('space', 'pilot')).toContain('data-part="rocket"');
    expect(body('space', 'pilot')).toContain('data-part="goggles"');
    const football = parse(body('sports', 'football'));
    const layers = [...football.documentElement.firstElementChild!.children];
    expect(layers[1]!.firstElementChild!.getAttribute('fill')).toBe('var(--cc-avatar-white)');
    expect(layers[1]!.outerHTML).toContain('var(--cc-avatar-blue)');
  });

  it('every species still shows its spec colour (same character, same colours)', () => {
    for (const { family, species } of SPECIES) for (const color of ['navy', 'mint'] as const) expect(html(creature(family, species, { color, bgColor: 'yellow' })), `${species} ${color}`).toContain(`var(--cc-avatar-${color})`);
  });
});
