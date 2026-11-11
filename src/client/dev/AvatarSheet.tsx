/**
 * Avatar review sheets (/dev/avatars, signed-in users only; S17c, D-169). Every creature species in
 * all 12 colours at 48 px, the same with the background in the body colour, every hat and the scarf
 * on every species, and every skin tone with every eye style, in one built-in theme (`?theme=`).
 * `e2e/avatar-sheets.spec.ts` screenshots them (before/after pictures for the owner) and checks that
 * every species renders. Catalogue keys only; no student data.
 */
import { AVATAR_COLOURS, CREATURE_FAMILIES, CREATURE_FAMILY_KEYS, CREATURE_PARTS, OPTION_NAMES, PERSON_PARTS, SKIN_TONES, describeAvatar, type CreatureFamily, type CreatureSpec, type PersonSpec } from '../../shared/avatars.ts';
import { DEFAULT_THEME, isThemeKey } from '../../shared/themes.ts';
import { AvatarArt } from '../avatars/AvatarArt.tsx';
import { useI18n } from '../lib/i18n.tsx';
import { ThemeScope } from '../themes/index.tsx';

const SIZE = 48;
const SPECIES = CREATURE_FAMILY_KEYS.flatMap((family) => (CREATURE_FAMILIES[family] as readonly string[]).map((species) => ({ family, species })));

const creature = (family: CreatureFamily, species: string, over: Partial<CreatureSpec>): CreatureSpec => ({
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

const person = (over: Partial<PersonSpec>): PersonSpec => ({
  v: 1,
  type: 'person',
  body: 'round',
  skin: 'skin1',
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
  bgColor: 'mint',
  ...over,
});

function Row({ label, specs, testId }: { label: string; specs: Array<CreatureSpec | PersonSpec>; testId: string }) {
  const { locale } = useI18n();
  return (
    <div className="cc-avatar-sheet__row" data-testid={testId}>
      <span className="cc-avatar-sheet__label">{label}</span>
      {specs.map((s, i) => (
        <AvatarArt key={i} spec={s} size={SIZE} title={describeAvatar(s, locale)} />
      ))}
    </div>
  );
}

export function AvatarSheetPage() {
  const { locale } = useI18n();
  const asked = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('theme');
  const theme = asked && isThemeKey(asked) ? asked : DEFAULT_THEME;
  const colours = AVATAR_COLOURS.length;
  const name = (_family: CreatureFamily, species: string) => OPTION_NAMES[`species.${species}`]?.[locale] ?? species;
  return (
    <ThemeScope.Provider value={theme}>
      <main className="cc-avatar-sheet" data-theme={theme}>
        {/* Species × 12 colours; eyes and mouths take turns so every style shows on every colour. */}
        <section data-testid="sheet-species">
          {SPECIES.map(({ family, species }) => (
            <Row
              key={species}
              label={name(family, species)}
              testId={`sheet-species-${species}`}
              specs={AVATAR_COLOURS.map((color, i) =>
                creature(family, species, { color, eyes: CREATURE_PARTS.eyes[i % CREATURE_PARTS.eyes.length]!, mouth: CREATURE_PARTS.mouth[i % CREATURE_PARTS.mouth.length]!, bgColor: AVATAR_COLOURS[(i + colours / 2) % colours]! }),
              )}
            />
          ))}
        </section>
        {/* The background in the body colour (13 of the 120 ready-made avatars and some generated ones). */}
        <section data-testid="sheet-same">
          {SPECIES.map(({ family, species }) => (
            <Row key={species} label={name(family, species)} testId={`sheet-same-${species}`} specs={AVATAR_COLOURS.map((color, i) => creature(family, species, { color, bgColor: color, bg: CREATURE_PARTS.bg[i % CREATURE_PARTS.bg.length]! }))} />
          ))}
        </section>
        {/* Every hat and the scarf on every species. */}
        <section data-testid="sheet-hats">
          {SPECIES.map(({ family, species }) => (
            <Row
              key={species}
              label={name(family, species)}
              testId={`sheet-hats-${species}`}
              specs={[...PERSON_PARTS.hat.filter((h) => h !== 'none').map((hat) => creature(family, species, { hat, accentColor: 'red' })), ...PERSON_PARTS.accessory.filter((a) => a !== 'none').map((accessory) => creature(family, species, { accessory, accentColor: 'purple' }))]}
            />
          ))}
        </section>
        {/* Every skin tone with every eye style and mouth. */}
        <section data-testid="sheet-people">
          {SKIN_TONES.map((skin) => (
            <Row key={skin} label={describeAvatar(person({ skin }), locale)} testId={`sheet-people-${skin}`} specs={PERSON_PARTS.eyes.map((eyes, i) => person({ skin, eyes, mouth: PERSON_PARTS.mouth[i]!, hairColor: i % 2 ? 'black' : 'blonde', bgColor: AVATAR_COLOURS[i]! }))} />
          ))}
        </section>
      </main>
    </ThemeScope.Provider>
  );
}
