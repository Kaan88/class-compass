/**
 * Avatar catalogue (S13c items 9 and 11, D-124, D-125): every part and colour a student can pick in
 * the character creator, the ready-made avatars, the unlocks, the stable generated default and the
 * accessible names. The art is original, drawn in our own flat, friendly style
 * (`src/client/avatars/`); nothing imitates an existing show's or game's characters, style or names.
 *
 * A saved avatar is a small JSON spec of catalogue keys only (no free text, no pictures), validated
 * on the server against this catalogue (`AvatarSpec` in contracts/avatars.ts): unknown parts or
 * colours are refused. Colours are KEYS mapped to theme tokens (`--cc-avatar-<colour>`), so every
 * theme restyles every avatar without changing what it means.
 */
import type { LocalizedTextValue } from './contracts/define.ts';

type Named<K extends string> = Readonly<Record<K, LocalizedTextValue>>;

// ---------------------------------------------------------------- colours (theme tokens)
export const AVATAR_COLOURS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'navy', 'purple', 'pink', 'brown', 'grey', 'mint'] as const;
export type AvatarColour = (typeof AVATAR_COLOURS)[number];
export const COLOUR_NAMES: Named<AvatarColour> = {
  red: { en: 'red', tr: 'kırmızı' },
  orange: { en: 'orange', tr: 'turuncu' },
  yellow: { en: 'yellow', tr: 'sarı' },
  green: { en: 'green', tr: 'yeşil' },
  teal: { en: 'teal', tr: 'çam yeşili' },
  blue: { en: 'blue', tr: 'mavi' },
  navy: { en: 'navy', tr: 'lacivert' },
  purple: { en: 'purple', tr: 'mor' },
  pink: { en: 'pink', tr: 'pembe' },
  brown: { en: 'brown', tr: 'kahverengi' },
  grey: { en: 'grey', tr: 'gri' },
  mint: { en: 'mint', tr: 'nane yeşili' },
};

/** A wide, inclusive range of skin tones (tokens `--cc-avatar-skin-1` … `-12`). */
export const SKIN_TONES = ['skin1', 'skin2', 'skin3', 'skin4', 'skin5', 'skin6', 'skin7', 'skin8', 'skin9', 'skin10', 'skin11', 'skin12'] as const;
export type SkinTone = (typeof SKIN_TONES)[number];
export const SKIN_NAMES: Named<SkinTone> = {
  skin1: { en: 'very light skin', tr: 'çok açık ten' },
  skin2: { en: 'light skin', tr: 'açık ten' },
  skin3: { en: 'light warm skin', tr: 'açık sıcak ten' },
  skin4: { en: 'light olive skin', tr: 'açık buğday ten' },
  skin5: { en: 'medium light skin', tr: 'orta açık ten' },
  skin6: { en: 'medium skin', tr: 'orta ten' },
  skin7: { en: 'olive skin', tr: 'buğday ten' },
  skin8: { en: 'tan skin', tr: 'esmer ten' },
  skin9: { en: 'medium dark skin', tr: 'orta koyu ten' },
  skin10: { en: 'brown skin', tr: 'kahverengi ten' },
  skin11: { en: 'dark brown skin', tr: 'koyu kahverengi ten' },
  skin12: { en: 'deep brown skin', tr: 'çok koyu ten' },
};

export const HAIR_COLOURS = ['black', 'darkBrown', 'brown', 'auburn', 'ginger', 'blonde', 'lightBlonde', 'grey', 'white', 'blue', 'pink', 'purple'] as const;
export type HairColour = (typeof HAIR_COLOURS)[number];
export const HAIR_COLOUR_NAMES: Named<HairColour> = {
  black: { en: 'black', tr: 'siyah' },
  darkBrown: { en: 'dark brown', tr: 'koyu kahverengi' },
  brown: { en: 'brown', tr: 'kahverengi' },
  auburn: { en: 'auburn', tr: 'kızıl kahve' },
  ginger: { en: 'ginger', tr: 'kızıl' },
  blonde: { en: 'blonde', tr: 'sarı' },
  lightBlonde: { en: 'light blonde', tr: 'açık sarı' },
  grey: { en: 'grey', tr: 'gri' },
  white: { en: 'white', tr: 'beyaz' },
  blue: { en: 'blue', tr: 'mavi' },
  pink: { en: 'pink', tr: 'pembe' },
  purple: { en: 'purple', tr: 'mor' },
};

// ---------------------------------------------------------------- person parts
export const PERSON_PARTS = {
  body: ['round', 'square', 'slim', 'broad'],
  face: ['round', 'oval', 'square', 'heart', 'long'],
  hair: ['none', 'short', 'spiky', 'curly', 'afro', 'long', 'ponytail', 'bun', 'braids', 'bob', 'sidePart', 'wavy', 'buzz', 'twoBuns', 'hijab', 'headscarf'],
  eyes: ['dots', 'round', 'happy', 'wink', 'sparkle', 'sleepy', 'big', 'lashes'],
  brows: ['none', 'flat', 'raised', 'thick', 'curved'],
  mouth: ['smile', 'grin', 'laugh', 'small', 'tongue', 'calm', 'teeth', 'cat'],
  glasses: ['none', 'round', 'square', 'sunglasses', 'star'],
  cheeks: ['none', 'blush', 'freckles', 'both'],
  top: ['tshirt', 'hoodie', 'collar', 'stripes', 'dungarees', 'jumper', 'jersey', 'tunic'],
  hat: ['none', 'cap', 'beanie', 'crown', 'wizard', 'flowers', 'headband', 'party', 'bucket'],
  accessory: ['none', 'scarf', 'headphones', 'backpack', 'wand', 'ball', 'book', 'medal'],
  pet: ['none', 'cat', 'dog', 'bird', 'bunny', 'fish'],
  bg: ['circle', 'rings', 'stars', 'stripes', 'dots', 'waves', 'hills', 'sunburst'],
} as const;
export type PersonPart = keyof typeof PERSON_PARTS;

/** Creature families (item 9) as the other "character type" in the same creator (item 11). */
export const CREATURE_FAMILIES = {
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
export type CreatureFamily = keyof typeof CREATURE_FAMILIES;
export const CREATURE_FAMILY_KEYS = Object.keys(CREATURE_FAMILIES) as CreatureFamily[];
export const ALL_SPECIES = CREATURE_FAMILY_KEYS.flatMap((f) => CREATURE_FAMILIES[f] as readonly string[]);

export const CREATURE_PARTS = {
  eyes: PERSON_PARTS.eyes,
  mouth: PERSON_PARTS.mouth,
  hat: PERSON_PARTS.hat,
  accessory: PERSON_PARTS.accessory,
  bg: PERSON_PARTS.bg,
} as const;

export interface PersonSpec {
  v: 1;
  type: 'person';
  body: (typeof PERSON_PARTS.body)[number];
  skin: SkinTone;
  face: (typeof PERSON_PARTS.face)[number];
  hair: (typeof PERSON_PARTS.hair)[number];
  hairColor: HairColour;
  eyes: (typeof PERSON_PARTS.eyes)[number];
  brows: (typeof PERSON_PARTS.brows)[number];
  mouth: (typeof PERSON_PARTS.mouth)[number];
  glasses: (typeof PERSON_PARTS.glasses)[number];
  cheeks: (typeof PERSON_PARTS.cheeks)[number];
  top: (typeof PERSON_PARTS.top)[number];
  topColor: AvatarColour;
  hat: (typeof PERSON_PARTS.hat)[number];
  accessory: (typeof PERSON_PARTS.accessory)[number];
  accentColor: AvatarColour;
  pet: (typeof PERSON_PARTS.pet)[number];
  bg: (typeof PERSON_PARTS.bg)[number];
  bgColor: AvatarColour;
}

export interface CreatureSpec {
  v: 1;
  type: 'creature';
  family: CreatureFamily;
  species: string;
  color: AvatarColour;
  eyes: (typeof PERSON_PARTS.eyes)[number];
  mouth: (typeof PERSON_PARTS.mouth)[number];
  hat: (typeof PERSON_PARTS.hat)[number];
  accessory: (typeof PERSON_PARTS.accessory)[number];
  accentColor: AvatarColour;
  bg: (typeof PERSON_PARTS.bg)[number];
  bgColor: AvatarColour;
}

export type AvatarSpecValue = PersonSpec | CreatureSpec;

// ---------------------------------------------------------------- names (accessible names, creator labels)
export const PART_LABELS: Named<PersonPart | 'type' | 'family' | 'species' | 'skin' | 'hairColor' | 'topColor' | 'accentColor' | 'bgColor' | 'color'> = {
  type: { en: 'Character type', tr: 'Karakter türü' },
  family: { en: 'Family', tr: 'Aile' },
  species: { en: 'Character', tr: 'Karakter' },
  body: { en: 'Body', tr: 'Gövde' },
  skin: { en: 'Skin tone', tr: 'Ten rengi' },
  face: { en: 'Face shape', tr: 'Yüz şekli' },
  hair: { en: 'Hair', tr: 'Saç' },
  hairColor: { en: 'Hair colour', tr: 'Saç rengi' },
  eyes: { en: 'Eyes', tr: 'Gözler' },
  brows: { en: 'Eyebrows', tr: 'Kaşlar' },
  mouth: { en: 'Mouth', tr: 'Ağız' },
  glasses: { en: 'Glasses', tr: 'Gözlük' },
  cheeks: { en: 'Cheeks', tr: 'Yanaklar' },
  top: { en: 'Clothes', tr: 'Kıyafet' },
  topColor: { en: 'Clothes colour', tr: 'Kıyafet rengi' },
  hat: { en: 'Hat', tr: 'Şapka' },
  accessory: { en: 'Extra', tr: 'Aksesuar' },
  accentColor: { en: 'Extra colour', tr: 'Aksesuar rengi' },
  pet: { en: 'Pet', tr: 'Evcil hayvan' },
  bg: { en: 'Background', tr: 'Arka plan' },
  bgColor: { en: 'Background colour', tr: 'Arka plan rengi' },
  color: { en: 'Colour', tr: 'Renk' },
};

export const OPTION_NAMES: Readonly<Record<string, LocalizedTextValue>> = {
  // body
  'body.round': { en: 'round', tr: 'yuvarlak' },
  'body.square': { en: 'square', tr: 'köşeli' },
  'body.slim': { en: 'slim', tr: 'ince' },
  'body.broad': { en: 'broad', tr: 'geniş' },
  // face
  'face.round': { en: 'round face', tr: 'yuvarlak yüz' },
  'face.oval': { en: 'oval face', tr: 'oval yüz' },
  'face.square': { en: 'square face', tr: 'köşeli yüz' },
  'face.heart': { en: 'heart-shaped face', tr: 'kalp yüz' },
  'face.long': { en: 'long face', tr: 'uzun yüz' },
  // hair
  'hair.none': { en: 'no hair', tr: 'saçsız' },
  'hair.short': { en: 'short hair', tr: 'kısa saç' },
  'hair.spiky': { en: 'spiky hair', tr: 'dikenli saç' },
  'hair.curly': { en: 'curly hair', tr: 'kıvırcık saç' },
  'hair.afro': { en: 'afro hair', tr: 'afro saç' },
  'hair.long': { en: 'long hair', tr: 'uzun saç' },
  'hair.ponytail': { en: 'a ponytail', tr: 'at kuyruğu' },
  'hair.bun': { en: 'a bun', tr: 'topuz' },
  'hair.braids': { en: 'braids', tr: 'örgüler' },
  'hair.bob': { en: 'a bob', tr: 'küt saç' },
  'hair.sidePart': { en: 'side-parted hair', tr: 'yandan ayrık saç' },
  'hair.wavy': { en: 'wavy hair', tr: 'dalgalı saç' },
  'hair.buzz': { en: 'very short hair', tr: 'çok kısa saç' },
  'hair.twoBuns': { en: 'two buns', tr: 'iki topuz' },
  'hair.hijab': { en: 'a hijab', tr: 'başörtüsü' },
  'hair.headscarf': { en: 'a tied headscarf', tr: 'bağlı eşarp' },
  // eyes
  'eyes.dots': { en: 'dot eyes', tr: 'nokta gözler' },
  'eyes.round': { en: 'round eyes', tr: 'yuvarlak gözler' },
  'eyes.happy': { en: 'happy eyes', tr: 'mutlu gözler' },
  'eyes.wink': { en: 'a wink', tr: 'göz kırpma' },
  'eyes.sparkle': { en: 'sparkly eyes', tr: 'parlak gözler' },
  'eyes.sleepy': { en: 'sleepy eyes', tr: 'uykulu gözler' },
  'eyes.big': { en: 'big eyes', tr: 'iri gözler' },
  'eyes.lashes': { en: 'eyes with lashes', tr: 'kirpikli gözler' },
  // brows
  'brows.none': { en: 'no eyebrows', tr: 'kaşsız' },
  'brows.flat': { en: 'straight eyebrows', tr: 'düz kaşlar' },
  'brows.raised': { en: 'raised eyebrows', tr: 'kalkık kaşlar' },
  'brows.thick': { en: 'thick eyebrows', tr: 'kalın kaşlar' },
  'brows.curved': { en: 'curved eyebrows', tr: 'kavisli kaşlar' },
  // mouth
  'mouth.smile': { en: 'a smile', tr: 'gülümseme' },
  'mouth.grin': { en: 'a big grin', tr: 'kocaman sırıtış' },
  'mouth.laugh': { en: 'a laugh', tr: 'kahkaha' },
  'mouth.small': { en: 'a small mouth', tr: 'küçük ağız' },
  'mouth.tongue': { en: 'a cheeky tongue', tr: 'dil çıkarma' },
  'mouth.calm': { en: 'a calm mouth', tr: 'sakin ağız' },
  'mouth.teeth': { en: 'a toothy smile', tr: 'dişli gülüş' },
  'mouth.cat': { en: 'a cat smile', tr: 'kedi gülüşü' },
  // glasses
  'glasses.none': { en: 'no glasses', tr: 'gözlüksüz' },
  'glasses.round': { en: 'round glasses', tr: 'yuvarlak gözlük' },
  'glasses.square': { en: 'square glasses', tr: 'köşeli gözlük' },
  'glasses.sunglasses': { en: 'sunglasses', tr: 'güneş gözlüğü' },
  'glasses.star': { en: 'star glasses', tr: 'yıldız gözlük' },
  // cheeks
  'cheeks.none': { en: 'plain cheeks', tr: 'sade yanaklar' },
  'cheeks.blush': { en: 'rosy cheeks', tr: 'pembe yanaklar' },
  'cheeks.freckles': { en: 'freckles', tr: 'çiller' },
  'cheeks.both': { en: 'freckles and rosy cheeks', tr: 'çiller ve pembe yanaklar' },
  // top
  'top.tshirt': { en: 'a T-shirt', tr: 'tişört' },
  'top.hoodie': { en: 'a hoodie', tr: 'kapüşonlu' },
  'top.collar': { en: 'a collared shirt', tr: 'yakalı gömlek' },
  'top.stripes': { en: 'a striped top', tr: 'çizgili üst' },
  'top.dungarees': { en: 'dungarees', tr: 'salopet' },
  'top.jumper': { en: 'a jumper with a heart', tr: 'kalpli kazak' },
  'top.jersey': { en: 'a sports shirt', tr: 'forma' },
  'top.tunic': { en: 'a tunic', tr: 'tunik' },
  // hat
  'hat.none': { en: 'no hat', tr: 'şapkasız' },
  'hat.cap': { en: 'a cap', tr: 'kep' },
  'hat.beanie': { en: 'a beanie', tr: 'bere' },
  'hat.crown': { en: 'a crown', tr: 'taç' },
  'hat.wizard': { en: 'a wizard hat', tr: 'büyücü şapkası' },
  'hat.flowers': { en: 'a flower band', tr: 'çiçek taç' },
  'hat.headband': { en: 'a headband', tr: 'saç bandı' },
  'hat.party': { en: 'a party hat', tr: 'parti şapkası' },
  'hat.bucket': { en: 'a bucket hat', tr: 'balıkçı şapkası' },
  // accessory
  'accessory.none': { en: 'no extra', tr: 'aksesuarsız' },
  'accessory.scarf': { en: 'a scarf', tr: 'atkı' },
  'accessory.headphones': { en: 'headphones', tr: 'kulaklık' },
  'accessory.backpack': { en: 'a backpack', tr: 'sırt çantası' },
  'accessory.wand': { en: 'a magic wand', tr: 'sihirli değnek' },
  'accessory.ball': { en: 'a ball', tr: 'top' },
  'accessory.book': { en: 'a book', tr: 'kitap' },
  'accessory.medal': { en: 'a medal', tr: 'madalya' },
  // pet
  'pet.none': { en: 'no pet', tr: 'evcil hayvan yok' },
  'pet.cat': { en: 'a pet cat', tr: 'kedi' },
  'pet.dog': { en: 'a pet dog', tr: 'köpek' },
  'pet.bird': { en: 'a pet bird', tr: 'kuş' },
  'pet.bunny': { en: 'a pet bunny', tr: 'tavşan' },
  'pet.fish': { en: 'a pet fish', tr: 'balık' },
  // backgrounds
  'bg.circle': { en: 'plain', tr: 'sade' },
  'bg.rings': { en: 'rings', tr: 'halkalar' },
  'bg.stars': { en: 'stars', tr: 'yıldızlar' },
  'bg.stripes': { en: 'stripes', tr: 'çizgiler' },
  'bg.dots': { en: 'dots', tr: 'noktalar' },
  'bg.waves': { en: 'waves', tr: 'dalgalar' },
  'bg.hills': { en: 'hills', tr: 'tepeler' },
  'bg.sunburst': { en: 'sunburst', tr: 'güneş ışınları' },
  // types and families
  'type.person': { en: 'person', tr: 'insan' },
  'type.creature': { en: 'creature', tr: 'yaratık' },
  'family.animals': { en: 'Animals', tr: 'Hayvanlar' },
  'family.monsters': { en: 'Monsters', tr: 'Canavarlar' },
  'family.robots': { en: 'Robots', tr: 'Robotlar' },
  'family.aliens': { en: 'Aliens', tr: 'Uzaylılar' },
  'family.dinosaurs': { en: 'Dinosaurs', tr: 'Dinozorlar' },
  'family.fruits': { en: 'Fruit and vegetables', tr: 'Meyve ve sebzeler' },
  'family.sea': { en: 'Sea creatures', tr: 'Deniz canlıları' },
  'family.mythical': { en: 'Mythical creatures', tr: 'Efsanevi yaratıklar' },
  'family.space': { en: 'Space explorers', tr: 'Uzay kaşifleri' },
  'family.sports': { en: 'Sports characters', tr: 'Spor karakterleri' },
  // species
  'species.cat': { en: 'cat', tr: 'kedi' },
  'species.bear': { en: 'bear', tr: 'ayı' },
  'species.bunny': { en: 'bunny', tr: 'tavşan' },
  'species.blob': { en: 'blob monster', tr: 'pelte canavar' },
  'species.horns': { en: 'horned monster', tr: 'boynuzlu canavar' },
  'species.fluffy': { en: 'fluffy monster', tr: 'pofuduk canavar' },
  'species.boxy': { en: 'boxy robot', tr: 'kutu robot' },
  'species.round': { en: 'round robot', tr: 'yuvarlak robot' },
  'species.antenna': { en: 'antenna robot', tr: 'antenli robot' },
  'species.antennae': { en: 'alien with antennae', tr: 'antenli uzaylı' },
  'species.threeEyes': { en: 'three-eyed alien', tr: 'üç gözlü uzaylı' },
  'species.bigHead': { en: 'big-headed alien', tr: 'koca kafalı uzaylı' },
  'species.rex': { en: 'little rex', tr: 'küçük reks' },
  'species.spikes': { en: 'spiky dinosaur', tr: 'dikenli dinozor' },
  'species.longNeck': { en: 'long-necked dinosaur', tr: 'uzun boyunlu dinozor' },
  'species.apple': { en: 'apple friend', tr: 'elma dostu' },
  'species.carrot': { en: 'carrot friend', tr: 'havuç dostu' },
  'species.strawberry': { en: 'strawberry friend', tr: 'çilek dostu' },
  'species.fish': { en: 'fish', tr: 'balık' },
  'species.octopus': { en: 'octopus', tr: 'ahtapot' },
  'species.crab': { en: 'crab', tr: 'yengeç' },
  'species.unicorn': { en: 'unicorn', tr: 'tek boynuzlu at' },
  'species.dragon': { en: 'dragon', tr: 'ejderha' },
  'species.phoenix': { en: 'fire bird', tr: 'ateş kuşu' },
  'species.astronaut': { en: 'astronaut', tr: 'astronot' },
  'species.pilot': { en: 'rocket pilot', tr: 'roket pilotu' },
  'species.starKid': { en: 'star kid', tr: 'yıldız çocuk' },
  'species.football': { en: 'football buddy', tr: 'futbol topu dostu' },
  'species.basketball': { en: 'basketball buddy', tr: 'basketbol topu dostu' },
  'species.tennis': { en: 'tennis ball buddy', tr: 'tenis topu dostu' },
};

// ---------------------------------------------------------------- unlocks (earn a badge to unlock a part)
/** `part.option` → the default achievement key that unlocks it (any class+subject, a live award). */
export const AVATAR_UNLOCKS: Readonly<Record<string, string>> = {
  'hat.crown': 'goals.getter3',
  'hat.wizard': 'reflections.r5',
  'glasses.star': 'goals.firstReached',
  'accessory.medal': 'homework.done5',
  'accessory.wand': 'teacher.wordWizard',
  'bg.sunburst': 'evidence.collector5',
  'bg.stars': 'evidence.first',
};

/** The parts of a spec that need an unlock, as `part.option` keys. */
export function lockedPartsOf(spec: AvatarSpecValue): string[] {
  const keys = [`hat.${spec.hat}`, `accessory.${spec.accessory}`, `bg.${spec.bg}`, ...(spec.type === 'person' ? [`glasses.${spec.glasses}`] : [])];
  return keys.filter((k) => k in AVATAR_UNLOCKS);
}

// ---------------------------------------------------------------- generation
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

const pick = <T,>(xs: readonly T[], rnd: () => number): T => xs[Math.floor(rnd() * xs.length)]!;
const withoutLocked = <T extends string>(part: string, xs: readonly T[]) => xs.filter((x) => !(`${part}.${x}` in AVATAR_UNLOCKS));

/** A random person (only parts that need no unlock). */
export function randomPerson(rnd: () => number): PersonSpec {
  const p = PERSON_PARTS;
  return {
    v: 1,
    type: 'person',
    body: pick(p.body, rnd),
    skin: pick(SKIN_TONES, rnd),
    face: pick(p.face, rnd),
    hair: pick(p.hair, rnd),
    hairColor: pick(HAIR_COLOURS, rnd),
    eyes: pick(p.eyes, rnd),
    brows: pick(p.brows, rnd),
    mouth: pick(p.mouth, rnd),
    glasses: rnd() < 0.6 ? 'none' : pick(withoutLocked('glasses', p.glasses), rnd),
    cheeks: pick(p.cheeks, rnd),
    top: pick(p.top, rnd),
    topColor: pick(AVATAR_COLOURS, rnd),
    hat: rnd() < 0.55 ? 'none' : pick(withoutLocked('hat', p.hat), rnd),
    accessory: rnd() < 0.5 ? 'none' : pick(withoutLocked('accessory', p.accessory), rnd),
    accentColor: pick(AVATAR_COLOURS, rnd),
    pet: rnd() < 0.6 ? 'none' : pick(p.pet, rnd),
    bg: pick(withoutLocked('bg', p.bg), rnd),
    bgColor: pick(AVATAR_COLOURS, rnd),
  };
}

/** A random creature of a family (any family when omitted). */
export function randomCreature(rnd: () => number, family?: CreatureFamily): CreatureSpec {
  const f = family ?? pick(CREATURE_FAMILY_KEYS, rnd);
  const c = CREATURE_PARTS;
  return {
    v: 1,
    type: 'creature',
    family: f,
    species: pick(CREATURE_FAMILIES[f], rnd),
    color: pick(AVATAR_COLOURS, rnd),
    eyes: pick(c.eyes, rnd),
    mouth: pick(c.mouth, rnd),
    hat: rnd() < 0.6 ? 'none' : pick(withoutLocked('hat', c.hat), rnd),
    accessory: rnd() < 0.6 ? 'none' : pick(withoutLocked('accessory', c.accessory), rnd),
    accentColor: pick(AVATAR_COLOURS, rnd),
    bg: pick(withoutLocked('bg', c.bg), rnd),
    bgColor: pick(AVATAR_COLOURS, rnd),
  };
}

/** The avatar shown before a student chooses one: a creature generated from a stable hash of the id (item 9). */
export const generatedAvatar = (studentId: string): CreatureSpec => randomCreature(seededRandom(hashOf(`avatar:${studentId}`)));

/** Ready-made avatars: 10 families × 3 characters × 4 looks = 120 (test-enforced ≥ 120). */
export const READY_MADE: readonly CreatureSpec[] = CREATURE_FAMILY_KEYS.flatMap((family) =>
  (CREATURE_FAMILIES[family] as readonly string[]).flatMap((species) =>
    [0, 1, 2, 3].map((look): CreatureSpec => {
      const rnd = seededRandom(hashOf(`${family}.${species}.${look}`));
      const base = randomCreature(rnd, family);
      return { ...base, species, color: AVATAR_COLOURS[(hashOf(species) + look * 3) % AVATAR_COLOURS.length]!, bg: (['circle', 'rings', 'dots', 'waves'] as const)[look]! };
    }),
  ),
);

// ---------------------------------------------------------------- accessible name
const nameOf = (key: string, locale: 'en' | 'tr') => OPTION_NAMES[key]?.[locale] ?? '';

/** "Blue robot with a cap" style accessible name, in the page language. */
export function describeAvatar(spec: AvatarSpecValue, locale: 'en' | 'tr'): string {
  const extras: string[] = [];
  if (spec.hat !== 'none') extras.push(nameOf(`hat.${spec.hat}`, locale));
  if (spec.accessory !== 'none') extras.push(nameOf(`accessory.${spec.accessory}`, locale));
  if (spec.type === 'person') {
    if (spec.glasses !== 'none') extras.push(nameOf(`glasses.${spec.glasses}`, locale));
    if (spec.pet !== 'none') extras.push(nameOf(`pet.${spec.pet}`, locale));
  }
  const join = locale === 'tr' ? ' ve ' : ' and ';
  const tail = extras.length ? (locale === 'tr' ? `, ${extras.join(join)} ile` : ` with ${extras.join(join)}`) : '';
  if (spec.type === 'creature') {
    const colour = COLOUR_NAMES[spec.color][locale] ?? '';
    const what = nameOf(`species.${spec.species}`, locale);
    const head = `${colour} ${what}`;
    return (locale === 'en' ? head.charAt(0).toUpperCase() + head.slice(1) : head.charAt(0).toLocaleUpperCase('tr-TR') + head.slice(1)) + tail;
  }
  const parts = [nameOf(`hair.${spec.hair}`, locale), SKIN_NAMES[spec.skin][locale] ?? '', nameOf(`top.${spec.top}`, locale)].filter(Boolean);
  const head = locale === 'tr' ? `Kişi: ${parts.join(', ')}` : `Person with ${parts.join(', ')}`;
  return head + (extras.length ? (locale === 'tr' ? `; ${extras.join(join)}` : `, ${extras.join(join)}`) : '');
}
