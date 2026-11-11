/**
 * Picker logic for "My avatar" (S17c, D-169), kept apart from the screen so it is unit-tested:
 * which parts the creator offers and how (colour swatches, pictures of the whole avatar or of the
 * face), the family order of the theme (S17a `avatarFamiliesFirst`), the ready-made avatars of a
 * family, choosing a part (a family keeps the species where it can) and "Surprise me" choices that
 * never put a body on a background of its own or a near colour.
 */
import {
  AVATAR_COLOURS,
  CREATURE_FAMILIES,
  CREATURE_FAMILY_KEYS,
  CREATURE_PARTS,
  HAIR_COLOURS,
  PERSON_PARTS,
  READY_MADE,
  SKIN_TONES,
  coloursClash,
  type AvatarColour,
  type AvatarSpecValue,
  type CreatureFamily,
  type CreatureSpec,
} from '../../shared/avatars.ts';
import { orderByFamilies, orderFamilies } from '../../shared/themePackage/engine.ts';

/** How a part is chosen: a colour swatch, a picture of the avatar, or a close-up of the face. */
export type PartKind = 'colour' | 'skin' | 'hair' | 'picture' | 'face';
export interface PickerPart {
  key: string;
  kind: PartKind;
  options: readonly string[];
}

const FACE_PARTS = new Set(['eyes', 'mouth', 'brows', 'glasses', 'cheeks']);
const part = (key: string, options: readonly string[]): PickerPart => ({ key, options, kind: FACE_PARTS.has(key) ? 'face' : 'picture' });
const colour = (key: string): PickerPart => ({ key, kind: 'colour', options: AVATAR_COLOURS });

/** The parts of the creator after the family and character (creatures) or for a person, in screen order. */
export function pickerParts(spec: AvatarSpecValue): PickerPart[] {
  if (spec.type === 'creature') {
    const c = CREATURE_PARTS;
    return [colour('color'), part('eyes', c.eyes), part('mouth', c.mouth), part('hat', c.hat), part('accessory', c.accessory), colour('accentColor'), part('bg', c.bg), colour('bgColor')];
  }
  const p = PERSON_PARTS;
  return [
    { key: 'skin', kind: 'skin', options: SKIN_TONES },
    part('face', p.face),
    part('hair', p.hair),
    { key: 'hairColor', kind: 'hair', options: HAIR_COLOURS },
    part('eyes', p.eyes),
    part('brows', p.brows),
    part('mouth', p.mouth),
    part('cheeks', p.cheeks),
    part('glasses', p.glasses),
    part('body', p.body),
    part('top', p.top),
    colour('topColor'),
    part('hat', p.hat),
    part('accessory', p.accessory),
    colour('accentColor'),
    part('pet', p.pet),
    part('bg', p.bg),
    colour('bgColor'),
  ];
}

/** The families in the theme's order (S17a): its first families, then the rest; nothing is hidden. */
export const familyOrder = (first: readonly string[] | undefined): CreatureFamily[] => orderFamilies(CREATURE_FAMILY_KEYS, first);

/** The ready-made avatars grouped by family, in the theme's family order (every one of the 120 stays). */
export function readyMadeGroups(first: readonly string[] | undefined): Array<{ family: CreatureFamily; avatars: CreatureSpec[] }> {
  const ordered = orderByFamilies(READY_MADE, first);
  return familyOrder(first).map((family) => ({ family, avatars: ordered.filter((a) => a.family === family) }));
}

/**
 * Sets one part. Choosing a family keeps the species when the family has it, otherwise takes the
 * character in the same place in the new family; choosing a species also sets its family.
 */
export function setPart(spec: AvatarSpecValue, key: string, value: string): AvatarSpecValue {
  if (spec.type === 'creature' && key === 'family') {
    const family = value as CreatureFamily;
    const species = CREATURE_FAMILIES[family] as readonly string[];
    if (species.includes(spec.species)) return { ...spec, family };
    const old = CREATURE_FAMILIES[spec.family] as readonly string[];
    return { ...spec, family, species: species[Math.max(0, old.indexOf(spec.species))] ?? species[0]! };
  }
  if (spec.type === 'creature' && key === 'species') {
    const family = CREATURE_FAMILY_KEYS.find((f) => (CREATURE_FAMILIES[f] as readonly string[]).includes(value)) ?? spec.family;
    return { ...spec, family, species: value };
  }
  return { ...spec, [key]: value } as AvatarSpecValue;
}

const BODY_OF: Readonly<Record<string, string>> = { color: 'bgColor', topColor: 'bgColor', bgColor: '' };
/** True when choosing `value` for `key` would put the body on a background of its own or a near colour. */
export function clashesWith(spec: AvatarSpecValue, key: string, value: string): boolean {
  if (!(key in BODY_OF)) return false;
  const body = spec.type === 'creature' ? spec.color : spec.topColor;
  if (key === 'bgColor') return coloursClash(body, value as AvatarColour);
  if ((spec.type === 'creature' && key === 'color') || (spec.type === 'person' && key === 'topColor')) return coloursClash(value as AvatarColour, spec.bgColor);
  return false;
}

/** The options "Surprise me" may pick for a part: not the current one, not locked, never a body/background clash. */
export function surpriseOptions(spec: AvatarSpecValue, p: PickerPart, isLocked: (part: string, option: string) => boolean): string[] {
  const now = (spec as unknown as Record<string, string>)[p.key];
  return p.options.filter((o) => o !== now && !isLocked(p.key, o) && !clashesWith(spec, p.key, o));
}
