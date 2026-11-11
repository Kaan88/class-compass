// @vitest-environment jsdom
/**
 * The picture-based avatar picker (S17c, D-169; S13c item 11, D-124; S17a order, D-166): families in the
 * theme's order with every ready-made avatar grouped by family, labelled radio groups of swatches and
 * pictures, choosing a family keeps the species where it can, Randomise and "Surprise me" never put a
 * body on its own or a near background colour, axe on the picker, and natural Turkish names.
 * Fictional data only.
 */
import axe from 'axe-core';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { AvatarPanel } from '../../src/client/student/AvatarPanel.tsx';
import { clashesWith, familyOrder, pickerParts, readyMadeGroups, setPart, surpriseOptions } from '../../src/client/student/avatarPicker.ts';
import { AVATAR_COLOURS, CREATURE_FAMILY_KEYS, PERSON_PARTS, READY_MADE, TR_WITH, coloursClash, describeAvatar, type CreatureSpec, type PersonSpec } from '../../src/shared/avatars.ts';
import { COLOUR_NAMES, OPTION_NAMES } from '../../src/shared/avatars.ts';

afterEach(cleanup);

const cat: CreatureSpec = { v: 1, type: 'creature', family: 'animals', species: 'bunny', color: 'blue', eyes: 'dots', mouth: 'smile', hat: 'cap', accessory: 'scarf', accentColor: 'red', bg: 'circle', bgColor: 'yellow' };

describe('picker logic', () => {
  it('groups all 120 ready-made avatars by family in the theme order; nothing is hidden', () => {
    const groups = readyMadeGroups(['sea', 'robots']);
    expect(groups.map((g) => g.family).slice(0, 2)).toEqual(['sea', 'robots']);
    expect(groups.map((g) => g.family).sort()).toEqual([...CREATURE_FAMILY_KEYS].sort());
    expect(groups.flatMap((g) => g.avatars)).toHaveLength(READY_MADE.length);
    for (const g of groups) for (const a of g.avatars) expect(a.family).toBe(g.family);
    expect(familyOrder(undefined)).toEqual([...CREATURE_FAMILY_KEYS]);
  });

  it('choosing a family keeps the species when it can, otherwise the character in the same place; a species sets its family', () => {
    expect(setPart(cat, 'family', 'animals')).toEqual(cat);
    const robot = setPart(cat, 'family', 'robots') as CreatureSpec;
    expect(robot.family).toBe('robots');
    expect(robot.species).toBe('antenna'); // the bunny is the 3rd animal, so the 3rd robot
    expect({ ...robot, family: 'animals', species: 'bunny' }).toEqual(cat); // only family and species changed
    expect(setPart(cat, 'species', 'dragon')).toMatchObject({ family: 'mythical', species: 'dragon', color: 'blue', hat: 'cap' });
  });

  it('Surprise never offers the current option, a locked one or a clash', () => {
    const colour = pickerParts(cat).find((p) => p.key === 'bgColor')!;
    const ok = surpriseOptions(cat, colour, () => false);
    expect(ok).not.toContain('yellow');
    for (const o of ok) expect(coloursClash(cat.color, o as never)).toBe(false);
    const hats = pickerParts(cat).find((p) => p.key === 'hat')!;
    expect(surpriseOptions(cat, hats, (_p, o) => o === 'crown')).not.toContain('crown');
    expect(clashesWith(cat, 'color', 'yellow')).toBe(true);
    expect(clashesWith(cat, 'eyes', 'big')).toBe(false);
    // The extra colour stays apart from the body and the background (S17c review).
    const accent = pickerParts(cat).find((p) => p.key === 'accentColor')!;
    for (const o of surpriseOptions(cat, accent, () => false)) expect(coloursClash(cat.color, o as never) || coloursClash(cat.bgColor, o as never), o).toBe(false);
    expect(clashesWith(cat, 'accentColor', 'blue')).toBe(true);
    expect(clashesWith(cat, 'accentColor', 'yellow')).toBe(true);
  });

  it('colours are swatches, eyes and mouths close-ups of the face, the rest pictures', () => {
    const kinds = Object.fromEntries(pickerParts(cat).map((p) => [p.key, p.kind]));
    expect(kinds).toMatchObject({ color: 'colour', bgColor: 'colour', eyes: 'face', mouth: 'face', hat: 'picture', accessory: 'picture', bg: 'picture' });
    const person = Object.fromEntries(pickerParts({ ...READY_MADE[0]!, type: 'person' } as unknown as PersonSpec).map((p) => [p.key, p.kind]));
    expect(person).toMatchObject({ skin: 'skin', hairColor: 'hair', topColor: 'colour', glasses: 'face', hair: 'picture' });
  });
});

describe('the picker screen', () => {
  const info = {
    spec: cat,
    generated: READY_MADE[0]!,
    locked: false,
    fallback: 'generated' as const,
    earned: [],
    picture: { state: 'off' as const, approvedUrl: null, pending: null, refused: null },
  };
  const mount = (locale: 'en' | 'tr' = 'en') =>
    render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(I18nProvider, { locale, children: createElement(AvatarPanel, { info, name: 'Ada' }) })));

  it('shows families with thumbnails and one family of ready-made avatars at a time', async () => {
    const { getByTestId, getAllByTestId } = mount();
    await act(async () => getByTestId('avatar-change').click());
    const families = within(getByTestId('avatar-ready-families')).getAllByRole('button');
    expect(families).toHaveLength(CREATURE_FAMILY_KEYS.length);
    for (const f of families) expect(f.querySelector('svg')).not.toBeNull();
    expect(getAllByTestId('avatar-ready')).toHaveLength(12);
    await act(async () => getByTestId('avatar-ready-family-space').click());
    expect(getAllByTestId('avatar-ready').map((b) => b.getAttribute('aria-label'))).toEqual(READY_MADE.filter((a) => a.family === 'space').map((a) => describeAvatar(a, 'en')));
  });

  it('every part is a labelled radio group; choosing a species picture changes the avatar; axe finds nothing serious', async () => {
    const { getByTestId, container } = mount();
    await act(async () => getByTestId('avatar-change').click());
    await act(async () => getByTestId('avatar-tab-make').click());
    for (const key of ['species', 'color', 'eyes', 'mouth', 'hat', 'accessory', 'accentColor', 'bg', 'bgColor']) {
      const group = getByTestId(`avatar-part-${key}`);
      expect(group.tagName, key).toBe('FIELDSET');
      expect(group.querySelector('legend')?.textContent, key).toBeTruthy();
      const radios = within(group).getAllByRole('radio');
      expect(radios.length, key).toBeGreaterThan(1);
      for (const r of radios) expect((r.closest('label')?.textContent ?? '').trim(), key).not.toBe('');
      expect(radios.filter((r) => (r as HTMLInputElement).checked), key).toHaveLength(1);
    }
    expect(within(getByTestId('avatar-part-color')).getByRole('radio', { name: 'blue' })).toBeTruthy();
    // A crown needs an achievement: its radio is disabled and the unlock is written out.
    expect((within(getByTestId('avatar-part-hat')).getByRole('radio', { name: 'a crown' }) as HTMLInputElement).disabled).toBe(true);
    expect(getByTestId('avatar-part-hat').textContent).toContain('to unlock');
    await act(async () => getByTestId('avatar-make-family-robots').click());
    const boxy = within(getByTestId('avatar-part-species')).getByRole('radio', { name: 'boxy robot' });
    await act(async () => fireEvent.click(boxy));
    expect(container.querySelector('.cc-avatar-preview svg[role="img"]')?.getAttribute('aria-label')).toBe('Blue boxy robot with a cap and a scarf');
    const r = await axe.run(getByTestId('avatar-creator'), { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });

  it('in every part the options come before "Surprise me" in the DOM, so the tab order matches what is drawn (WCAG 2.4.3)', async () => {
    const { getByTestId, container } = mount();
    await act(async () => getByTestId('avatar-change').click());
    await act(async () => getByTestId('avatar-tab-make').click());
    const parts = [...container.querySelectorAll('fieldset.cc-avatar-part')];
    expect(parts.length).toBeGreaterThan(5);
    for (const part of parts) {
      const children = [...part.children];
      const at = (sel: string) => children.findIndex((c) => c.matches(sel));
      const options = at('.cc-avatar-options');
      const surprise = at('.cc-avatar-part__surprise');
      expect(options, part.getAttribute('data-testid') ?? '').toBe(1); // straight after the legend
      expect(surprise, part.getAttribute('data-testid') ?? '').toBe(children.length - 1);
      if (at('.cc-avatar-unlocks') >= 0) expect(at('.cc-avatar-unlocks')).toBeLessThan(surprise);
    }
  });

  it('Randomise never gives a body on its own or a near background colour', async () => {
    const { getByTestId, container } = mount();
    await act(async () => getByTestId('avatar-change').click());
    for (let i = 0; i < 40; i++) {
      await act(async () => getByTestId('avatar-randomise').click());
      const label = container.querySelector('.cc-avatar-preview svg[role="img"]')!;
      expect(label.innerHTML).not.toContain('data-part="veil"');
    }
  });
});

describe('Turkish and English names (D-169)', () => {
  it('uses the fixed Turkish words', () => {
    expect(COLOUR_NAMES.teal.tr).toBe('petrol yeşili');
    expect(OPTION_NAMES['hat.cap']!.tr).toBe('şapka');
  });

  it('names an avatar the Turkish way: what it has comes before the noun', () => {
    expect(describeAvatar({ ...cat, species: 'cat', hat: 'cap', accessory: 'scarf' }, 'tr')).toBe('Şapkalı ve atkılı mavi kedi');
    expect(describeAvatar({ ...cat, species: 'cat', hat: 'none', accessory: 'none', color: 'teal' }, 'tr')).toBe('Petrol yeşili kedi');
    expect(describeAvatar({ ...cat, family: 'space', species: 'pilot', hat: 'none', accessory: 'medal' }, 'tr')).toBe('Madalyalı mavi roket pilotu');
    const person: PersonSpec = { v: 1, type: 'person', body: 'round', skin: 'skin12', face: 'round', hair: 'short', hairColor: 'black', eyes: 'dots', brows: 'flat', mouth: 'smile', glasses: 'round', cheeks: 'none', top: 'tshirt', topColor: 'blue', hat: 'none', accessory: 'scarf', accentColor: 'red', pet: 'none', bg: 'circle', bgColor: 'yellow' };
    expect(describeAvatar(person, 'tr')).toBe('Kısa saçlı, çok koyu tenli, tişörtlü, atkılı ve yuvarlak gözlüklü kişi');
    expect(describeAvatar(person, 'en')).toBe('Person with short hair, deep brown skin, a T-shirt, a scarf and round glasses');
    expect(describeAvatar({ ...cat, species: 'cat' }, 'en')).toBe('Blue cat with a cap and a scarf');
  });

  it('a ball is "top tutan", never the ambiguous "toplu" ("plump", "collective")', () => {
    expect(describeAvatar({ ...cat, species: 'cat', hat: 'none', accessory: 'ball' }, 'tr')).toBe('Top tutan mavi kedi');
    expect(describeAvatar({ ...cat, species: 'bunny', hat: 'cap', accessory: 'ball', color: 'mint' }, 'tr')).toBe('Şapkalı ve top tutan nane yeşili tavşan');
    for (const a of READY_MADE) expect(describeAvatar(a, 'tr')).not.toMatch(/toplu/i);
  });

  it('every hat, extra, glasses, pet, hair and clothes option has a Turkish "with" form', () => {
    for (const part of ['hat', 'accessory', 'glasses', 'pet'] as const) for (const o of PERSON_PARTS[part]) if (o !== 'none') expect(TR_WITH[`${part}.${o}`], `${part}.${o}`).toBeTruthy();
    for (const part of ['hair', 'top'] as const) for (const o of PERSON_PARTS[part]) expect(TR_WITH[`${part}.${o}`], `${part}.${o}`).toBeTruthy();
    expect(AVATAR_COLOURS.every((c) => (COLOUR_NAMES[c].tr ?? '').length > 0)).toBe(true);
  });
});
