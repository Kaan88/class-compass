// @vitest-environment jsdom
/**
 * Avatars and badge art (S13c items 1, 9–11, D-124): original SVG drawn from the catalogue only, theme
 * tokens instead of colours, every random spec renders, 80+ badge icons with the tier shown by shape,
 * 120+ ready-made avatars, and the tokens exist (and contrast) in every theme. Fictional data only.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BadgeArt, GLYPHS } from '../../src/client/achievements/icons.tsx';
import { AvatarArt, accessoryTransform, faceOf } from '../../src/client/avatars/AvatarArt.tsx';
import { contrast } from '../../src/client/themes/contrast.ts';
import { themeTokens } from '../../src/client/themes/css.ts';
import { THEME_LIST } from '../../src/client/themes/registry.ts';
import { COLOR_TOKENS } from '../../src/client/themes/types.ts';
import { ACHIEVEMENT_TIERS, BADGE_ICONS, DEFAULT_ACHIEVEMENTS } from '../../src/shared/achievements.ts';
import { ALL_SPECIES, AVATAR_COLOURS, CREATURE_FAMILIES, CREATURE_FAMILY_KEYS, HAIR_COLOURS, OPTION_NAMES, PERSON_PARTS, READY_MADE, SKIN_TONES, describeAvatar, generatedAvatar, randomCreature, randomPerson, seededRandom, type CreatureFamily, type CreatureSpec } from '../../src/shared/avatars.ts';
import { AvatarSpec } from '../../src/shared/contracts/avatars.ts';

const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

describe('badge icons (item 1)', () => {
  it('has at least 80 original glyphs, one per key, and every default uses a known icon', () => {
    expect(BADGE_ICONS.length).toBeGreaterThanOrEqual(80);
    expect(Object.keys(GLYPHS).sort()).toEqual([...BADGE_ICONS].sort());
    expect(new Set(Object.values(GLYPHS)).size).toBe(BADGE_ICONS.length);
    for (const d of DEFAULT_ACHIEVEMENTS) expect(BADGE_ICONS as readonly string[]).toContain(d.icon);
  });

  it('shows the tier by a different frame shape, uses theme tokens only and hides itself from screen readers', () => {
    const frames = new Set<string>();
    for (const tier of ACHIEVEMENT_TIERS) {
      const out = html(createElement(BadgeArt, { icon: 'star', tier }));
      expect(out).toContain(`data-tier="${tier}"`);
      expect(out).toContain('aria-hidden="true"');
      expect(out).not.toMatch(RAW_COLOUR);
      frames.add(out.replace(/fill="[^"]*"/g, ''));
    }
    expect(frames.size).toBe(ACHIEVEMENT_TIERS.length);
  });
});

describe('avatars (items 9–11)', () => {
  it('has 120+ distinct ready-made avatars, all valid specs', () => {
    expect(READY_MADE.length).toBeGreaterThanOrEqual(120);
    expect(new Set(READY_MADE.map((r) => JSON.stringify(r))).size).toBe(READY_MADE.length);
    for (const r of READY_MADE) expect(AvatarSpec.safeParse(r).success).toBe(true);
  });

  it('offers inclusive choices: 12 skin tones, hijab and headscarf, many hair colours', () => {
    expect(SKIN_TONES).toHaveLength(12);
    expect(PERSON_PARTS.hair).toEqual(expect.arrayContaining(['hijab', 'headscarf', 'afro', 'braids']));
    expect(HAIR_COLOURS.length).toBeGreaterThanOrEqual(10);
  });

  it('renders any random spec (property test) with theme tokens only, no ids and no text that could leak', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = seededRandom(seed);
      const spec = seed % 2 ? randomPerson(rnd) : randomCreature(rnd);
      expect(AvatarSpec.safeParse(spec).success, JSON.stringify(spec)).toBe(true);
      const out = html(createElement(AvatarArt, { spec, size: 64 }));
      expect(out.startsWith('<svg'), JSON.stringify(spec)).toBe(true);
      expect(out).not.toMatch(RAW_COLOUR);
      expect(out).not.toMatch(/\sid="/);
      expect(out).not.toMatch(/<script|<image|href=/);
    }
    const g = generatedAvatar('00000000-0000-7000-8000-000000000001');
    expect(generatedAvatar('00000000-0000-7000-8000-000000000001')).toEqual(g);
    expect(html(createElement(AvatarArt, { spec: g, title: 'Ada' }))).toContain('role="img" aria-label="Ada"');
  });

  it('every theme defines the avatar and badge tokens; badge ink reads on every tier fill', () => {
    const needed = [...AVATAR_COLOURS.map((c) => `avatar-${c}`), ...SKIN_TONES.map((_, i) => `avatar-skin-${i + 1}`), 'badge-bronze', 'badge-silver', 'badge-gold', 'badge-plain', 'badge-ink'];
    for (const n of needed) expect(COLOR_TOKENS as readonly string[], n).toContain(n);
    for (const theme of THEME_LIST) {
      const c = theme.colors as Record<string, string>;
      for (const n of needed) expect(c[n], `${theme.key} ${n}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      for (const fill of ['badge-bronze', 'badge-silver', 'badge-gold', 'badge-plain']) expect(contrast(c['badge-ink']!, c[fill]!), `${theme.key} ${fill}`).toBeGreaterThanOrEqual(3);
    }
  });
});

/**
 * S13c review: every badge glyph in every tier (and locked), and every ready-made avatar plus random
 * specs, render as well-formed SVG whose every `var(--cc-…)` is defined by each theme. The art uses
 * tokens only, so this is what "renders in every theme" means; the e2e catalog runs axe on the same
 * badges and avatars in each theme (e2e/catalog.spec.ts).
 */
describe('recognisable creatures (S14a, D-146)', () => {
  const ALL_SPECIES_SPECS = CREATURE_FAMILY_KEYS.flatMap((family) => (CREATURE_FAMILIES[family] as readonly string[]).map((species) => ({ family, species })));
  const base = (family: CreatureFamily, species: string, over: Partial<CreatureSpec> = {}): CreatureSpec => ({
    v: 1,
    type: 'creature',
    family,
    species,
    color: 'blue',
    eyes: 'dots',
    mouth: 'smile',
    hat: 'none',
    accessory: 'none',
    accentColor: 'red',
    bg: 'circle',
    bgColor: 'yellow',
    ...over,
  });
  /** The body of the picture: everything between the background circle and the eyes. */
  const bodyOf = (spec: CreatureSpec) => {
    const svg = html(createElement(AvatarArt, { spec, size: 48 }));
    const doc = new DOMParser().parseFromString(svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'), 'image/svg+xml');
    const layers = [...doc.documentElement.firstElementChild!.children];
    return layers[1]!; // [0] background, [1] body, [2] eyes …
  };

  it('every species has its own outline, and none is a bare ellipse or circle', () => {
    const signatures = new Map<string, string>();
    for (const { family, species } of ALL_SPECIES_SPECS) {
      const body = bodyOf(base(family, species));
      const shapes = [body, ...body.querySelectorAll('*')].filter((e) => ['path', 'ellipse', 'circle', 'rect'].includes(e.nodeName));
      expect(shapes.length > 1 || shapes[0]?.nodeName === 'path', `${species}: more than one plain shape`).toBe(true);
      const sig = new XMLSerializer().serializeToString(body);
      expect(signatures.has(sig), `${species} looks like ${signatures.get(sig)}`).toBe(false);
      signatures.set(sig, species);
    }
  });

  it('the unicorn horn is drawn after the hat, whatever the hat', () => {
    for (const hat of PERSON_PARTS.hat) {
      const svg = html(createElement(AvatarArt, { spec: base('mythical', 'unicorn', { hat }) }));
      const hatAt = svg.indexOf('data-part="hat"');
      const hornAt = svg.indexOf('data-part="horn"');
      expect(hatAt, hat).toBeGreaterThan(0);
      expect(hornAt, hat).toBeGreaterThan(hatAt);
    }
  });

  it('a beak species never gets a person mouth, whatever mouth was chosen', () => {
    for (const mouth of PERSON_PARTS.mouth) {
      const svg = html(createElement(AvatarArt, { spec: base('mythical', 'phoenix', { mouth }) }));
      expect(svg, mouth).toContain('data-part="beak"');
      expect(svg, mouth).not.toContain('data-part="mouth"');
    }
  });

  it('dinosaurs and mythical creatures get their own mouths (jaw, snout, muzzle), people-like mouths stay elsewhere', () => {
    const part = (family: CreatureFamily, species: string) => /data-part="(\w+)"/.exec(html(createElement(AvatarArt, { spec: base(family, species) })).replace(/data-part="(hat|eyes)"/g, ''))?.[1];
    expect(part('dinosaurs', 'rex')).toBe('jaw');
    expect(part('dinosaurs', 'spikes')).toBe('snout');
    expect(part('dinosaurs', 'longNeck')).toBe('snout');
    expect(part('mythical', 'unicorn')).toBe('muzzle');
    expect(part('mythical', 'dragon')).toBe('snout');
    expect(part('animals', 'cat')).toBe('mouth');
  });

  /** Where a point of the person drawing lands after an SVG transform list (translate, rotate, scale). */
  const apply = (transform: string | null | undefined, [x0, y0]: [number, number]): [number, number] => {
    const ops = [...(transform ?? '').matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)].map((m) => [m[1]!, m[2]!.trim().split(/[\s,]+/).map(Number)] as const);
    let [x, y] = [x0, y0];
    for (const [op, a] of ops.reverse()) {
      if (op === 'translate') [x, y] = [x + a[0]!, y + (a[1] ?? 0)];
      else if (op === 'scale') [x, y] = [x * a[0]!, y * (a[1] ?? a[0]!)];
      else {
        const r = (a[0]! * Math.PI) / 180;
        [x, y] = [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
      }
    }
    return [x, y];
  };
  const accessoryOf = (spec: CreatureSpec) => {
    const svg = html(createElement(AvatarArt, { spec, size: 48 }));
    const doc = new DOMParser().parseFromString(svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'), 'image/svg+xml');
    return doc.querySelector('[data-part="accessory"]');
  };
  const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  it('headphones sit on the head and the scarf round the neck of the side-view dinosaurs (review fix, D-146)', () => {
    // The headphones are drawn round (50, 44) and the scarf round (50, 73) on a person.
    for (const { family, species } of ALL_SPECIES_SPECS) {
      const f = faceOf({ species });
      const phones = accessoryOf(base(family, species, { accessory: 'headphones' }));
      expect(phones, species).not.toBeNull();
      const transform = phones!.getAttribute('transform');
      expect(transform ?? undefined, species).toBe(accessoryTransform(species, 'headphones'));
      if (f.eyes.x === 50 && f.eyes.scale === 1) continue; // a front view: drawn as on a person
      // A side view: the middle of the headphones lands on the head, next to the eyes, and smaller.
      expect(near(apply(transform, [50, 44]), [f.eyes.x, f.eyes.y]), `${species} headphones`).toBeLessThanOrEqual(6);
      expect(transform, species).toMatch(/scale\(0\.\d+\)/);
      // The scarf and the medal move to the neck: between the head and the body, under the eyes.
      for (const accessory of ['scarf', 'medal'] as const) {
        const t = accessoryOf(base(family, species, { accessory }))!.getAttribute('transform');
        const [x, y] = apply(t, [50, 73]);
        expect(y, `${species} ${accessory}`).toBeGreaterThan(f.eyes.y);
        expect(y, `${species} ${accessory}`).toBeLessThan(f.eyes.y + 40);
        expect(Math.abs(x - f.eyes.x), `${species} ${accessory}`).toBeLessThan(20);
        if (accessory === 'medal') expect(t, species).not.toContain('rotate'); // a medal hangs straight down
      }
    }
    // Held things stay at the side for every species.
    for (const accessory of ['wand', 'ball', 'book'] as const) expect(accessoryOf(base('dinosaurs', 'rex', { accessory }))!.getAttribute('transform')).toBeNull();
  });

  it("the unicorn's scarf and medal hang under its muzzle, not over its mouth (review fix, D-146)", () => {
    const mouthY = faceOf({ species: 'unicorn' }).mouth.y;
    for (const accessory of ['scarf', 'medal'] as const) {
      const [, y] = apply(accessoryOf(base('mythical', 'unicorn', { accessory }))!.getAttribute('transform'), [50, 70]);
      expect(y, accessory).toBeGreaterThan(mouthY + 3);
    }
  });

  it('keeps every stored spec valid: the ready-made list and the catalogue did not change shape (D-124)', () => {
    expect(READY_MADE).toHaveLength(120);
    for (const r of READY_MADE) expect(AvatarSpec.safeParse(r).success).toBe(true);
    for (const species of ['rex', 'spikes', 'longNeck', 'unicorn', 'dragon', 'phoenix']) expect(ALL_SPECIES).toContain(species);
  });

  it('uses the Turkish names the owner confirmed; the English names stay', () => {
    const tr = (s: string) => OPTION_NAMES[`species.${s}`]!.tr;
    expect(['rex', 'spikes', 'longNeck', 'unicorn', 'dragon', 'phoenix'].map(tr)).toEqual(['tiranozor', 'stegozor', 'uzun boyunlu dinozor', 'tek boynuzlu at', 'ejderha', 'anka kuşu']);
    expect(OPTION_NAMES['species.phoenix']!.en).toBe('fire bird');
    expect(describeAvatar(base('dinosaurs', 'rex'), 'tr')).toBe('Mavi tiranozor');
  });
});

describe('every badge and avatar in every theme (item 10, review fix)', () => {
  const VAR = /var\((--cc-[a-z0-9-]+)\)/g;
  const wellFormed = (svg: string) => {
    const doc = new DOMParser().parseFromString(svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'), 'image/svg+xml');
    return doc.getElementsByTagName('parsererror').length === 0 && doc.documentElement.nodeName === 'svg';
  };
  const art: string[] = [];
  for (const icon of BADGE_ICONS) for (const tier of ACHIEVEMENT_TIERS) for (const locked of [false, true]) art.push(html(createElement(BadgeArt, { icon, tier, locked })));
  for (const spec of READY_MADE) art.push(html(createElement(AvatarArt, { spec, size: 48, title: 'Avatar' })));
  for (let seed = 1; seed <= 100; seed++) art.push(html(createElement(AvatarArt, { spec: seed % 2 ? randomPerson(seededRandom(seed)) : randomCreature(seededRandom(seed)), size: 48 })));
  const used = new Set(art.flatMap((svg) => [...svg.matchAll(VAR)].map((m) => m[1]!)));

  it('renders well-formed SVG for all of them', () => {
    expect(art.length).toBeGreaterThanOrEqual(BADGE_ICONS.length * ACHIEVEMENT_TIERS.length * 2 + READY_MADE.length);
    for (const svg of art) expect(wellFormed(svg), svg.slice(0, 120)).toBe(true);
    expect(used.size).toBeGreaterThan(10);
  });

  it.each(THEME_LIST.map((t) => [t.key, t] as const))('every colour and style variable the art uses is defined by the %s theme', (_key, theme) => {
    const defined = new Map(themeTokens(theme));
    for (const v of used) {
      expect(defined.has(v), `${theme.key} ${v}`).toBe(true);
      expect(String(defined.get(v)).trim(), `${theme.key} ${v}`).not.toBe('');
    }
  });
});

