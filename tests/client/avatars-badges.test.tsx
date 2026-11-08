/**
 * Avatars and badge art (S13c items 1, 9–11, D-124): original SVG drawn from the catalogue only, theme
 * tokens instead of colours, every random spec renders, 80+ badge icons with the tier shown by shape,
 * 120+ ready-made avatars, and the tokens exist (and contrast) in every theme. Fictional data only.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BadgeArt, GLYPHS } from '../../src/client/achievements/icons.tsx';
import { AvatarArt } from '../../src/client/avatars/AvatarArt.tsx';
import { contrast } from '../../src/client/themes/contrast.ts';
import { THEME_LIST } from '../../src/client/themes/registry.ts';
import { COLOR_TOKENS } from '../../src/client/themes/types.ts';
import { ACHIEVEMENT_TIERS, BADGE_ICONS, DEFAULT_ACHIEVEMENTS } from '../../src/shared/achievements.ts';
import { AVATAR_COLOURS, HAIR_COLOURS, PERSON_PARTS, READY_MADE, SKIN_TONES, generatedAvatar, randomCreature, randomPerson, seededRandom } from '../../src/shared/avatars.ts';
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
