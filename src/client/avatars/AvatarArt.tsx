/**
 * Avatar renderer (S13c items 9 and 11, D-124, D-125). Original, flat geometric art drawn for Class
 * Compass: simple circles, rounded rectangles and short paths in a 100×100 box, coloured only with
 * theme tokens (`--cc-avatar-*`), so every theme can retune the palette. It deliberately does not
 * imitate any show, game or existing character set (D-125).
 *
 * One small inline SVG per avatar, no images and no fetch: cheap to draw on an old phone and safe on
 * the classroom display. Layers, back to front: background, pet, body/top, face, hair, features,
 * glasses, hat, accessory.
 *
 * S14a (D-146): the dinosaurs and mythical creatures are redrawn so children can name them at a glance.
 * `SPECIES_FACE` places each species' eyes, mouth and hat, and the head, neck and back anchors that put
 * headphones, scarf, medal and backpack where they belong; specs are unchanged (D-124).
 *
 * S17c (D-169): readability and fairness, same specs drawn as the same characters.
 * - Creature faces are `FACE_SCALE` (1.4×) larger at the same anchors, side-view dinosaur faces never
 *   below 0.75 of that; person features 1.15×.
 * - Every eye and mouth sits on a light rim (`avatar-white` under the `avatar-ink` line, `FEATURE_RIM`),
 *   so features read on dark bodies (navy, brown, purple) and on the darkest skin tones; the
 *   contrast test checks ink or rim against every body colour and skin tone in every theme. No new tokens.
 * - When body and background have the same or a near colour (`coloursClash`), the background gets a
 *   light veil and the body a soft `avatar-outline` rim.
 * - Hats sit on each species' head (`hat.top`), ears and horns stay in front of a hat (`overHat`), and
 *   scarves go round each species' neck (`anchors.neck`).
 * - The plain families are drawn with more character: a football with patches and the face on white,
 *   a rocket pilot with helmet, goggles and a rocket, an astronaut with a visor glint, a tapering carrot
 *   with ridges, a heart-shaped strawberry with seeds, a star kid with rounded points, robots with
 *   bolts and lights, and small details on the animals, monsters, aliens and sea creatures.
 */
import { memo, type ReactNode } from 'react';
import { coloursClash, type AvatarSpecValue, type CreatureSpec, type PersonSpec } from '../../shared/avatars.ts';

const v = (t: string) => `var(--cc-${t})`;
const INK = v('avatar-ink');
const WHITE = v('avatar-white');
const OUTLINE = v('avatar-outline');
const col = (c: string) => v(`avatar-${c}`);
const skinOf = (s: string) => v(`avatar-skin-${s.replace('skin', '')}`);
const hairOf = (h: string) => v(`avatar-hair-${h}`);

/** How much larger creature features are drawn than the v1 art (S17c). */
export const FACE_SCALE = 1.4;
/** Person features (inside the face shape). */
export const PERSON_FACE_SCALE = 1.15;
/** The light rim under every eye and mouth line: the colour token and how much wider than the ink line it is. */
export const FEATURE_RIM = { token: 'avatar-white', ink: 'avatar-ink', extra: 1.8 } as const;

/** A line feature: the light rim first, then the ink line on top. */
function RimLine({ d, width = 2 }: { d: string; width?: number }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke={WHITE} strokeWidth={width + FEATURE_RIM.extra} />
      <path d={d} stroke={INK} strokeWidth={width} />
    </g>
  );
}
/** A filled ink feature with a light rim around it (paint order: the rim stroke under the fill). */
const rimmed = { stroke: WHITE, strokeWidth: FEATURE_RIM.extra, strokeLinejoin: 'round' as const, paintOrder: 'stroke' };

// ---------------------------------------------------------------- shared layers
function Background({ kind, colour }: { kind: string; colour: string }) {
  const c = col(colour);
  const soft = { fill: WHITE, opacity: 0.35 };
  switch (kind) {
    case 'rings':
      return (
        <g>
          <circle cx="50" cy="50" r="50" fill={c} />
          <circle cx="50" cy="50" r="38" fill="none" stroke={WHITE} strokeOpacity="0.35" strokeWidth="4" />
          <circle cx="50" cy="50" r="26" fill="none" stroke={WHITE} strokeOpacity="0.35" strokeWidth="4" />
        </g>
      );
    case 'stars':
      return (
        <g>
          <circle cx="50" cy="50" r="50" fill={c} />
          {[
            [18, 22],
            [80, 18],
            [86, 60],
            [14, 64],
            [30, 10],
          ].map(([x, y]) => (
            <path key={`${x}-${y}`} d={`M${x} ${y! - 5}l1.6 3.4 3.4 1.6-3.4 1.6-1.6 3.4-1.6-3.4-3.4-1.6 3.4-1.6z`} {...soft} opacity={0.6} />
          ))}
        </g>
      );
    case 'stripes':
      return (
        <g>
          <circle cx="50" cy="50" r="50" fill={c} />
          {[10, 30, 50, 70, 90].map((y) => (
            <rect key={y} x="0" y={y - 4} width="100" height="8" {...soft} />
          ))}
        </g>
      );
    case 'dots':
      return (
        <g>
          <circle cx="50" cy="50" r="50" fill={c} />
          {[15, 35, 55, 75, 95].flatMap((x) => [20, 45, 70].map((y) => <circle key={`${x}-${y}`} cx={x - ((y / 25) % 2) * 10} cy={y} r="3" {...soft} />))}
        </g>
      );
    case 'waves':
      return (
        <g>
          <circle cx="50" cy="50" r="50" fill={c} />
          <path d="M0 30q12-8 25 0t25 0 25 0 25 0M0 55q12-8 25 0t25 0 25 0 25 0" stroke={WHITE} strokeOpacity="0.35" strokeWidth="5" fill="none" />
        </g>
      );
    case 'hills':
      return (
        <g>
          <circle cx="50" cy="50" r="50" fill={c} />
          <path d="M0 70q25-25 50 0t50 0v30H0z" {...soft} />
        </g>
      );
    case 'sunburst':
      return (
        <g>
          <circle cx="50" cy="50" r="50" fill={c} />
          {Array.from({ length: 12 }, (_, i) => (
            <path key={i} d="M50 50L46 0h8z" {...soft} opacity={0.25} transform={`rotate(${i * 30} 50 50)`} />
          ))}
        </g>
      );
    default:
      return <circle cx="50" cy="50" r="50" fill={c} />;
  }
}

/** A lighter background when the body has the same or a near colour (S17c). */
const Veil = () => <circle data-part="veil" cx="50" cy="50" r="50" fill={WHITE} opacity="0.5" />;

/**
 * One eye at (x, y) in the v1 size; the caller scales the face. Every style has a light rim or a
 * light white of the eye, and a catch-light, so it reads on dark bodies and dark skin (S17c).
 */
function Eye({ kind, x, y, side }: { kind: string; x: number; y: number; side: -1 | 1 }) {
  const dot = (r: number, glint: number) => (
    <g>
      <circle cx={x} cy={y} r={r} fill={INK} {...rimmed} />
      <circle cx={x + r * 0.35} cy={y - r * 0.35} r={glint} fill={WHITE} />
    </g>
  );
  switch (kind) {
    case 'round':
      return (
        <g>
          <circle cx={x} cy={y} r="4.2" fill={WHITE} stroke={INK} strokeWidth="1" />
          <circle cx={x} cy={y + 0.5} r="2.1" fill={INK} />
          <circle cx={x + 0.8} cy={y - 0.3} r="0.7" fill={WHITE} />
        </g>
      );
    case 'happy':
      return <RimLine d={`M${x - 3.5} ${y + 1}q3.5-4 7 0`} />;
    case 'wink':
      return side < 0 ? dot(2.5, 0.8) : <RimLine d={`M${x - 3.5} ${y}h7`} />;
    case 'sparkle':
      return (
        <g>
          <circle cx={x} cy={y} r="3.4" fill={INK} {...rimmed} />
          <circle cx={x + 1.2} cy={y - 1.2} r="1.15" fill={WHITE} />
          <circle cx={x - 1.1} cy={y + 1.2} r="0.55" fill={WHITE} />
        </g>
      );
    case 'sleepy':
      return <RimLine d={`M${x - 3.5} ${y}q3.5 3 7 0`} />;
    case 'big':
      return (
        <g>
          <ellipse cx={x} cy={y} rx="4.6" ry="5.4" fill={WHITE} stroke={INK} strokeWidth="1" />
          <circle cx={x} cy={y + 1} r="2.7" fill={INK} />
          <circle cx={x + 1} cy={y} r="0.95" fill={WHITE} />
        </g>
      );
    case 'lashes':
      return (
        <g>
          <RimLine d={`M${x - 3} ${y - 3}l-1.4-1.6M${x} ${y - 3.6}v-2M${x + 3} ${y - 3}l1.4-1.6`} width={1.1} />
          {dot(2.7, 0.85)}
        </g>
      );
    default:
      return dot(2.5, 0.8);
  }
}

function Eyes({ kind, cy = 44, dx = 8 }: { kind: string; cy?: number; dx?: number }) {
  return (
    <g data-part="eyes">
      <Eye kind={kind} x={50 - dx} y={cy} side={-1} />
      <Eye kind={kind} x={50 + dx} y={cy} side={1} />
    </g>
  );
}

/** A mouth centred on x = 50 at height cy in the v1 size, each line on a light rim (S17c). */
function Mouth({ kind, cy = 55 }: { kind: string; cy?: number }) {
  switch (kind) {
    case 'grin':
      return <path d={`M42 ${cy - 1}q8 7 16 0z`} fill={INK} {...rimmed} />;
    case 'laugh':
      return (
        <g>
          <path d={`M41 ${cy - 2}q9 11 18 0z`} fill={INK} {...rimmed} />
          <path d={`M46 ${cy + 3}q4 2 8 0`} fill={v('avatar-blush')} />
        </g>
      );
    case 'small':
      return <RimLine d={`M47 ${cy}q3 2 6 0`} />;
    case 'tongue':
      return (
        <g>
          <path d={`M48 ${cy + 1.5}q2 4.5 4 0`} fill={v('avatar-blush')} stroke={WHITE} strokeWidth="1" />
          <RimLine d={`M43 ${cy - 1}q7 6 14 0`} />
        </g>
      );
    case 'calm':
      return <RimLine d={`M45 ${cy}h10`} />;
    case 'teeth':
      return (
        <g>
          <rect x="43" y={cy - 3} width="14" height="6.5" rx="3" fill={INK} {...rimmed} />
          <rect x="45" y={cy - 2.6} width="10" height="2.4" rx="0.6" fill={WHITE} />
        </g>
      );
    case 'cat':
      return <RimLine d={`M44 ${cy - 1}q3 3 6 0q3 3 6 0`} />;
    default:
      return <RimLine d={`M43 ${cy - 1}q7 6 14 0`} />;
  }
}

function Hat({ kind, colour, top = 26 }: { kind: string; colour: string; top?: number }) {
  const c = col(colour);
  const t = top;
  switch (kind) {
    case 'cap':
      return (
        <g>
          <path d={`M30 ${t + 6}q20-18 40 0z`} fill={c} />
          <path d={`M60 ${t + 5}h18q-2 4-18 4z`} fill={c} />
          <path d={`M60 ${t + 5}h18q-2 4-18 4z`} fill={INK} opacity="0.2" />
        </g>
      );
    case 'beanie':
      return (
        <g>
          <path d={`M30 ${t + 7}q20-22 40 0z`} fill={c} />
          <rect x="29" y={t + 4} width="42" height="6" rx="3" fill={c} stroke={WHITE} strokeOpacity="0.4" />
          <circle cx="50" cy={t - 8} r="4" fill={c} />
        </g>
      );
    case 'crown':
      return <path d={`M34 ${t + 4}l2-14 7 8 7-11 7 11 7-8 2 14z`} fill={v('badge-gold')} stroke={INK} strokeWidth="1" />;
    case 'wizard':
      return (
        <g>
          <path d={`M30 ${t + 6}L50 ${t - 22}L70 ${t + 6}z`} fill={c} />
          <path d={`M47 ${t - 6}l1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5 3-1.5z`} fill={v('badge-gold')} />
        </g>
      );
    case 'flowers':
      return (
        <g>
          {[34, 42, 50, 58, 66].map((x, i) => (
            <circle key={x} cx={x} cy={t + 1 - (i % 2) * 2} r="3.4" fill={i % 2 ? c : v('avatar-yellow')} />
          ))}
        </g>
      );
    case 'headband':
      return <rect x="30" y={t + 2} width="40" height="5" rx="2.5" fill={c} />;
    case 'party':
      return (
        <g>
          <path d={`M42 ${t + 4}L50 ${t - 16}L58 ${t + 4}z`} fill={c} />
          <circle cx="50" cy={t - 17} r="2.5" fill={v('avatar-yellow')} />
        </g>
      );
    case 'bucket':
      return <path d={`M33 ${t + 6}l4-12h26l4 12z`} fill={c} />;
    default:
      return null;
  }
}

function Accessory({ kind, colour }: { kind: string; colour: string }) {
  const c = col(colour);
  switch (kind) {
    case 'scarf':
      return (
        <g>
          <path d="M36 70q14 7 28 0v6q-14 7-28 0z" fill={c} />
          <path d="M56 74l3 12h6l-3-13z" fill={c} />
        </g>
      );
    case 'headphones':
      return (
        <g>
          <path d="M28 46q0-24 22-24t22 24" fill="none" stroke={INK} strokeWidth="3" />
          <rect x="24" y="42" width="8" height="12" rx="3" fill={c} />
          <rect x="68" y="42" width="8" height="12" rx="3" fill={c} />
        </g>
      );
    case 'backpack':
      return <rect x="20" y="76" width="10" height="18" rx="3" fill={c} />;
    case 'wand':
      return (
        <g>
          <path d="M76 92L88 70" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M88 64l1.8 4 4 1.8-4 1.8-1.8 4-1.8-4-4-1.8 4-1.8z" fill={v('badge-gold')} />
        </g>
      );
    case 'ball':
      return (
        <g>
          <circle cx="82" cy="86" r="8" fill={c} />
          <path d="M74 86h16M82 78v16" stroke={WHITE} strokeOpacity="0.6" strokeWidth="1.5" />
        </g>
      );
    case 'book':
      return (
        <g>
          <rect x="70" y="78" width="16" height="12" rx="1.5" fill={c} />
          <path d="M78 78v12" stroke={WHITE} strokeWidth="1.2" />
        </g>
      );
    case 'medal':
      return (
        <g>
          <path d="M46 70l4 8 4-8" fill="none" stroke={c} strokeWidth="2.5" />
          <circle cx="50" cy="82" r="4.5" fill={v('badge-gold')} stroke={INK} strokeWidth="1" />
        </g>
      );
    default:
      return null;
  }
}

function Pet({ kind }: { kind: string }) {
  if (kind === 'none') return null;
  const c = { cat: 'orange', dog: 'brown', bird: 'yellow', bunny: 'grey', fish: 'teal' }[kind] ?? 'grey';
  return (
    <g transform="translate(70 70) scale(0.28)">
      {kind === 'fish' ? <path d="M10 50q40-40 70 0q-30 40-70 0zM80 50l20-15v30z" fill={col(c)} /> : <circle cx="50" cy="55" r="34" fill={col(c)} />}
      {kind === 'cat' ? <path d="M22 35l6-26 18 18zM78 35l-6-26-18 18z" fill={col(c)} /> : null}
      {kind === 'dog' ? <path d="M16 40q-6 26 10 30l6-30zM84 40q6 26-10 30l-6-30z" fill={INK} opacity="0.6" /> : null}
      {kind === 'bunny' ? <path d="M36 24q-4-30 6-24t2 24zM64 24q4-30-6-24t-2 24z" fill={col(c)} /> : null}
      {kind === 'bird' ? <path d="M82 52l16 4-16 6z" fill={v('avatar-orange')} /> : null}
      <circle cx="38" cy="50" r="5" fill={INK} />
      <circle cx="62" cy="50" r="5" fill={INK} />
    </g>
  );
}

/** Scales a feature group by k around (cx, cy): bigger, at the same anchor. */
const around = (cx: number, cy: number, k: number) => (k === 1 ? undefined : `translate(${cx} ${cy}) scale(${k}) translate(${-cx} ${-cy})`);

// ---------------------------------------------------------------- person
function FaceShape({ kind, fill }: { kind: string; fill: string }) {
  switch (kind) {
    case 'oval':
      return <ellipse cx="50" cy="46" rx="17" ry="21" fill={fill} />;
    case 'square':
      return <rect x="31" y="27" width="38" height="38" rx="10" fill={fill} />;
    case 'heart':
      return <path d="M31 38q0-12 19-12t19 12q0 18-19 28q-19-10-19-28z" fill={fill} />;
    case 'long':
      return <rect x="33" y="24" width="34" height="44" rx="16" fill={fill} />;
    default:
      return <circle cx="50" cy="46" r="20" fill={fill} />;
  }
}

function HairBack({ kind, fill, scarf }: { kind: string; fill: string; scarf: string }) {
  switch (kind) {
    case 'long':
    case 'wavy':
      return <path d="M28 44q0-24 22-24t22 24v26H28z" fill={fill} />;
    case 'braids':
      return (
        <g>
          <rect x="26" y="44" width="7" height="28" rx="3.5" fill={fill} />
          <rect x="67" y="44" width="7" height="28" rx="3.5" fill={fill} />
        </g>
      );
    case 'ponytail':
      return <path d="M66 32q16 6 10 30q-4-14-12-20z" fill={fill} />;
    case 'hijab':
      // Covers the hair, ears and neck, framing the face; the fabric uses the accent colour.
      return <path d="M24 48q0-30 26-30t26 30v30q-26 10-52 0z" fill={scarf} />;
    case 'headscarf':
      return <path d="M28 40q0-22 22-22t22 22l-4 4H32z" fill={scarf} />;
    case 'afro':
      return <circle cx="50" cy="38" r="27" fill={fill} />;
    default:
      return null;
  }
}

function HairFront({ kind, fill, scarf }: { kind: string; fill: string; scarf: string }) {
  switch (kind) {
    case 'short':
      return <path d="M30 40q2-18 20-18t20 18q-8-8-20-8t-20 8z" fill={fill} />;
    case 'spiky':
      return <path d="M30 40l2-12 5 5 4-10 5 7 4-9 4 9 5-7 4 10 5-5 2 12q-10-7-20-7t-20 7z" fill={fill} />;
    case 'curly':
      return (
        <g>
          {[32, 39, 46, 54, 61, 68].map((x, i) => (
            <circle key={x} cx={x} cy={i % 2 ? 28 : 31} r="6" fill={fill} />
          ))}
        </g>
      );
    case 'afro':
      return <path d="M30 38q20-14 40 0q-4-10-20-10t-20 10z" fill={fill} />;
    case 'long':
    case 'ponytail':
    case 'braids':
      return <path d="M30 42q2-20 20-20t20 20q-6-10-20-12q-14 2-20 12z" fill={fill} />;
    case 'wavy':
      return <path d="M30 42q2-20 20-20t20 20q-4-4-7-2t-6-4-7 2-7-2-6 4-7-2z" fill={fill} />;
    case 'bun':
      return (
        <g>
          <circle cx="50" cy="20" r="7" fill={fill} />
          <path d="M30 40q2-18 20-18t20 18q-8-9-20-9t-20 9z" fill={fill} />
        </g>
      );
    case 'twoBuns':
      return (
        <g>
          <circle cx="34" cy="24" r="6.5" fill={fill} />
          <circle cx="66" cy="24" r="6.5" fill={fill} />
          <path d="M30 40q2-18 20-18t20 18q-8-9-20-9t-20 9z" fill={fill} />
        </g>
      );
    case 'bob':
      return <path d="M28 52V40q0-18 22-18t22 18v12h-6V38q-16-6-32 0v14z" fill={fill} />;
    case 'sidePart':
      return <path d="M30 42q0-20 20-20t20 20q-4-8-14-10q-6 6-26 10z" fill={fill} />;
    case 'buzz':
      return <path d="M31 38q3-15 19-15t19 15q-9-6-19-6t-19 6z" fill={fill} opacity="0.75" />;
    case 'hijab':
      return <path d="M28 46q0-22 22-22t22 22q-4-14-22-14t-22 14z" fill={scarf} />;
    case 'headscarf':
      return (
        <g>
          <path d="M30 40q2-16 20-16t20 16q-8-6-20-6t-20 6z" fill={scarf} />
          <path d="M68 40l8 8-10-2z" fill={scarf} />
        </g>
      );
    default:
      return null;
  }
}

function Brows({ kind, fill }: { kind: string; fill: string }) {
  const s = { stroke: fill, strokeWidth: kind === 'thick' ? 3 : 1.8, strokeLinecap: 'round' as const, fill: 'none' };
  switch (kind) {
    case 'flat':
    case 'thick':
      return <path d="M38 36h7M55 36h7" {...s} />;
    case 'raised':
      return <path d="M38 35l7-2M55 33l7 2" {...s} />;
    case 'curved':
      return <path d="M38 36q3.5-3 7 0M55 36q3.5-3 7 0" {...s} />;
    default:
      return null;
  }
}

function Glasses({ kind }: { kind: string }) {
  switch (kind) {
    case 'round':
      return <path d="M46.5 44a4.5 4.5 0 1 1-9 0a4.5 4.5 0 1 1 9 0M62.5 44a4.5 4.5 0 1 1-9 0a4.5 4.5 0 1 1 9 0M46.5 44h7" stroke={INK} strokeWidth="1.5" fill="none" />;
    case 'square':
      return (
        <g stroke={INK} strokeWidth="1.5" fill="none">
          <rect x="36.5" y="40" width="10" height="8" rx="1.5" />
          <rect x="53.5" y="40" width="10" height="8" rx="1.5" />
          <path d="M46.5 44h7" />
        </g>
      );
    case 'sunglasses':
      return (
        <g fill={INK}>
          <rect x="36" y="40" width="11" height="7" rx="3" />
          <rect x="53" y="40" width="11" height="7" rx="3" />
          <rect x="46" y="42" width="8" height="1.6" />
        </g>
      );
    case 'star':
      return (
        <g fill={v('badge-gold')} stroke={INK} strokeWidth="1">
          <path d="M42 37l1.8 4.2 4.5.4-3.4 3 1 4.4-3.9-2.3-3.9 2.3 1-4.4-3.4-3 4.5-.4z" />
          <path d="M58 37l1.8 4.2 4.5.4-3.4 3 1 4.4-3.9-2.3-3.9 2.3 1-4.4-3.4-3 4.5-.4z" />
        </g>
      );
    default:
      return null;
  }
}

function Cheeks({ kind }: { kind: string }) {
  const blush = kind === 'blush' || kind === 'both';
  const freckles = kind === 'freckles' || kind === 'both';
  return (
    <g>
      {blush ? (
        <g fill={v('avatar-blush')} opacity="0.55">
          <ellipse cx="38" cy="52" rx="3.6" ry="2.2" />
          <ellipse cx="62" cy="52" rx="3.6" ry="2.2" />
        </g>
      ) : null}
      {freckles ? (
        <g fill={INK} opacity="0.35">
          {[
            [38, 50],
            [40, 52],
            [36, 52],
            [62, 50],
            [60, 52],
            [64, 52],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="0.7" />
          ))}
        </g>
      ) : null}
    </g>
  );
}

function Top({ kind, colour, body }: { kind: string; colour: string; body: string }) {
  const c = col(colour);
  const w = body === 'slim' ? 26 : body === 'broad' ? 40 : body === 'square' ? 36 : 32;
  const left = 50 - w;
  const shape = body === 'square' ? `M${left} 100V80q0-12 12-12h${2 * w - 24}q12 0 12 12v20z` : `M${left} 100q0-32 ${w} -32t${w} 32z`;
  return (
    <g>
      <path d={shape} fill={c} />
      {kind === 'hoodie' ? <path d="M38 72q12 10 24 0" stroke={WHITE} strokeOpacity="0.5" strokeWidth="2" fill="none" /> : null}
      {kind === 'collar' ? <path d="M42 69l8 7 8-7" fill={WHITE} /> : null}
      {kind === 'stripes' ? <path d={`M${left + 6} 84h${2 * w - 12}M${left + 3} 92h${2 * w - 6}`} stroke={WHITE} strokeOpacity="0.5" strokeWidth="3" /> : null}
      {kind === 'dungarees' ? <rect x="40" y="80" width="20" height="20" rx="2" fill={v('avatar-blue')} /> : null}
      {kind === 'jumper' ? <path d="M40 70q10 4 20 0" stroke={INK} strokeOpacity="0.25" strokeWidth="3" fill="none" /> : null}
      {kind === 'jersey' ? (
        <text x="50" y="93" fontSize="12" textAnchor="middle" fill={WHITE} fontWeight="700">
          7
        </text>
      ) : null}
      {kind === 'tunic' ? <path d="M50 70v28" stroke={WHITE} strokeOpacity="0.45" strokeWidth="2" /> : null}
    </g>
  );
}

function Person({ s }: { s: PersonSpec }) {
  const skin = skinOf(s.skin);
  const hair = hairOf(s.hairColor);
  const scarf = col(s.accentColor);
  const covered = s.hair === 'hijab' || s.hair === 'headscarf';
  const k = PERSON_FACE_SCALE;
  return (
    <g>
      <Background kind={s.bg} colour={s.bgColor} />
      {coloursClash(s.topColor, s.bgColor) ? <Veil /> : null}
      <Top kind={s.top} colour={s.topColor} body={s.body} />
      <rect x="45" y="60" width="10" height="10" fill={skin} />
      <HairBack kind={s.hair} fill={hair} scarf={scarf} />
      {s.hair !== 'hijab' ? (
        <g fill={skin}>
          <circle cx="30" cy="47" r="4" />
          <circle cx="70" cy="47" r="4" />
        </g>
      ) : null}
      <FaceShape kind={s.face} fill={skin} />
      <Cheeks kind={s.cheeks} />
      <g transform={around(50, 44, k)}>
        <Eyes kind={s.eyes} cy={44} dx={8 / k} />
      </g>
      <Brows kind={s.brows} fill={covered ? INK : hair} />
      <g data-part="mouth" transform={around(50, 56, k)}>
        <Mouth kind={s.mouth} cy={56} />
      </g>
      <HairFront kind={s.hair} fill={hair} scarf={scarf} />
      <Glasses kind={s.glasses} />
      {s.hair !== 'hijab' ? <Hat kind={s.hat} colour={s.accentColor === s.topColor ? 'yellow' : s.accentColor} /> : null}
      <Accessory kind={s.accessory} colour={s.accentColor} />
      <Pet kind={s.pet} />
    </g>
  );
}

// ---------------------------------------------------------------- creatures
/**
 * Where a species' face goes (S14a, D-146): the eyes (centre, height, spacing, size), which mouth it
 * has (a person mouth, a beak, a snout, a horse's muzzle or a dinosaur jaw), where a hat sits and
 * what must be drawn over the hat (the unicorn's horn, ears, horns, carrot leaves). The stored spec
 * does not change (D-124): the same eyes, mouth and hat options, drawn where they belong on each animal.
 */
type MouthStyle = 'person' | 'beak' | 'snout' | 'muzzle' | 'jaw';
/**
 * Where an accessory goes on a species (S14a review, D-146): the accessory's reference point (see
 * `ACCESSORY_REF`) is moved to (x, y), scaled and, for a scarf around a slanting neck, turned. Without
 * an anchor the accessory is drawn where it sits on a person (front view, head in the middle).
 */
interface Anchor {
  x: number;
  y: number;
  scale: number;
  /** Degrees; only the scarf turns with the neck, a medal always hangs straight down. */
  rotate?: number;
}
type AnchorKind = 'head' | 'neck' | 'back';
type OverHat = 'horn' | 'ears' | 'horns' | 'leaves';
interface FaceSpot {
  /** `scale` 1 = a front view; side views are smaller (never below 0.75, S17c). Drawn `FACE_SCALE` larger. */
  eyes: { x: number; y: number; dx: number; scale: number };
  mouth: { style: MouthStyle; x: number; y: number; w: number };
  /** `top`: the top of the head, where the hat's band sits. */
  hat: { x: number; top: number; scale: number };
  overHat?: OverHat;
  anchors?: Partial<Record<AnchorKind, Anchor>>;
}
const face = (eyes: Partial<FaceSpot['eyes']>, mouth: Partial<FaceSpot['mouth']>, hat: Partial<FaceSpot['hat']>, overHat?: OverHat, anchors?: FaceSpot['anchors']): FaceSpot => {
  const e = { x: 50, y: 50, dx: 9, scale: 1, ...eyes };
  return { eyes: e, mouth: { style: 'person', x: 50, y: e.y + 13 * e.scale, w: 14, ...mouth }, hat: { x: 50, top: 22, scale: 1, ...hat }, overHat, anchors };
};
export const SPECIES_FACE: Readonly<Record<string, FaceSpot>> = {
  // Animals: the ears stay in front of a hat.
  cat: face({ y: 52 }, {}, { top: 29, scale: 0.9 }, 'ears'),
  bear: face({ y: 50 }, { y: 64 }, { top: 27, scale: 0.9 }, 'ears'),
  bunny: face({ y: 55 }, {}, { top: 33, scale: 0.85 }, 'ears'),
  // Monsters.
  blob: face({ y: 52 }, {}, { top: 29, scale: 0.9 }),
  horns: face({ y: 50 }, {}, { top: 29, scale: 0.9 }, 'horns'),
  fluffy: face({ y: 54 }, {}, { top: 24, scale: 0.95 }),
  // Robots.
  boxy: face({ y: 46, dx: 9 }, { y: 57 }, { top: 26 }),
  round: face({ y: 50, dx: 9 }, {}, { top: 26 }),
  antenna: face({ y: 44, dx: 9 }, { y: 56 }, { top: 24 }),
  // Aliens.
  antennae: face({ y: 52 }, {}, { top: 29, scale: 0.9 }),
  threeEyes: face({ y: 56 }, {}, { top: 28, scale: 0.9 }),
  bigHead: face({ y: 48, dx: 11 }, { y: 62 }, { top: 21 }, undefined, { neck: { x: 50, y: 80, scale: 0.6 } }),
  // Fruit and vegetables: narrow bodies get a smaller scarf higher up.
  apple: face({ y: 58 }, {}, { top: 30, scale: 0.9 }),
  carrot: face({ y: 47, dx: 8 }, { y: 59 }, { top: 29, scale: 0.85 }, 'leaves', { neck: { x: 50, y: 68, scale: 0.6 } }),
  strawberry: face({ y: 54, dx: 9 }, { y: 66 }, { top: 30, scale: 0.85 }, undefined, { neck: { x: 50, y: 77, scale: 0.65 } }),
  // Sea creatures.
  fish: face({ y: 52, dx: 8 }, { y: 64 }, { top: 35, scale: 0.8 }, undefined, { neck: { x: 48, y: 72, scale: 0.75 } }),
  octopus: face({ y: 42 }, { y: 54 }, { top: 22 }, undefined, { neck: { x: 50, y: 62, scale: 0.95 } }),
  crab: face({ y: 56 }, { y: 68 }, { top: 40, scale: 0.85 }, undefined, { neck: { x: 50, y: 80, scale: 0.85 } }),
  // Dinosaurs, seen from the side and facing right: headphones on the head, a scarf round the slanting
  // neck, a medal on the chest and a backpack on the back or flank.
  rex: face({ x: 71, y: 33, dx: 5, scale: 0.75 }, { style: 'jaw', x: 76, y: 44, w: 26 }, { x: 68, top: 20, scale: 0.7 }, undefined, {
    head: { x: 71, y: 36, scale: 0.62 },
    neck: { x: 55, y: 57, scale: 0.6, rotate: 30 },
    back: { x: 34, y: 66, scale: 0.85, rotate: -15 },
  }),
  spikes: face({ x: 81, y: 57, dx: 5, scale: 0.75 }, { style: 'snout', x: 88, y: 65, w: 7 }, { x: 80, top: 45, scale: 0.55 }, undefined, {
    head: { x: 83, y: 58, scale: 0.45 },
    neck: { x: 70, y: 63, scale: 0.5, rotate: 70 },
    back: { x: 40, y: 60, scale: 0.85, rotate: 90 },
  }),
  longNeck: face({ x: 68, y: 18, dx: 5, scale: 0.75 }, { style: 'snout', x: 76, y: 24, w: 6 }, { x: 66, top: 10, scale: 0.5 }, undefined, {
    head: { x: 68, y: 20, scale: 0.45 },
    neck: { x: 62, y: 54, scale: 0.5, rotate: 20 },
    back: { x: 38, y: 68, scale: 0.8, rotate: 90 },
  }),
  // Mythical creatures, from the front. The unicorn's long muzzle reaches the person's neck line, so its
  // scarf and medal go lower, under the head.
  unicorn: face({ y: 44 }, { style: 'muzzle', y: 74, w: 10 }, { top: 24 }, 'horn', { neck: { x: 50, y: 84, scale: 0.9 } }),
  dragon: face({ y: 46 }, { style: 'snout', y: 66, w: 14 }, { top: 26 }),
  phoenix: face({ y: 45, dx: 8 }, { style: 'beak', y: 56, w: 12 }, { top: 30 }),
  // Space explorers.
  astronaut: face({ y: 50, dx: 8 }, { y: 61 }, { top: 20, scale: 1.05 }),
  pilot: face({ y: 55, dx: 8 }, { y: 66 }, { top: 26, scale: 0.95 }, undefined, { neck: { x: 50, y: 80, scale: 0.85 } }),
  starKid: face({ y: 52, dx: 8 }, { y: 63 }, { top: 20, scale: 0.6 }, undefined, { neck: { x: 50, y: 76, scale: 0.7 } }),
  // Sports characters: the face sits on the middle of the ball.
  football: face({ y: 52 }, {}, { top: 26 }),
  basketball: face({ y: 52 }, {}, { top: 26 }),
  tennis: face({ y: 52 }, {}, { top: 26 }),
};
const DEFAULT_FACE = face({}, {}, {});
export const faceOf = (s: Pick<CreatureSpec, 'species'>): FaceSpot => SPECIES_FACE[s.species] ?? DEFAULT_FACE;

/**
 * Which anchor each accessory follows, and the point of the person drawing that lands on the anchor:
 * the middle of the headphones, the middle of the scarf (the medal's ribbon hangs from the same neck
 * line) and the middle of the backpack. Wand, ball and book are held at the side and stay put.
 */
export const ACCESSORY_ANCHOR: Readonly<Record<string, AnchorKind>> = { headphones: 'head', scarf: 'neck', medal: 'neck', backpack: 'back' };
const ACCESSORY_REF: Readonly<Record<AnchorKind, { x: number; y: number }>> = { head: { x: 50, y: 44 }, neck: { x: 50, y: 73 }, back: { x: 25, y: 85 } };

/** The SVG transform that puts an accessory on its species' anchor (none when the species has none). */
export function accessoryTransform(species: string, accessory: string): string | undefined {
  const kind = ACCESSORY_ANCHOR[accessory];
  const a = kind ? SPECIES_FACE[species]?.anchors?.[kind] : undefined;
  if (!kind || !a) return undefined;
  const ref = ACCESSORY_REF[kind];
  const turn = a.rotate && accessory !== 'medal' ? ` rotate(${a.rotate})` : '';
  return `translate(${a.x} ${a.y})${turn} scale(${a.scale}) translate(${-ref.x} ${-ref.y})`;
}

/** Mouth options that show an open mouth on a snout or a jaw. */
const OPEN = new Set(['grin', 'laugh', 'teeth', 'tongue']);

/** A second shade of the body colour: the body colour under a thin layer of ink. */
function Shade({ d, colour, amount = 0.28 }: { d: string; colour: string; amount?: number }) {
  return (
    <g>
      <path d={d} fill={colour} />
      <path d={d} fill={INK} opacity={amount} />
    </g>
  );
}

const BLUSH = v('avatar-blush');

/** Parts drawn again in front of a hat, so a hat never hides what makes the species (S17c). */
function OverHatPart({ kind, s }: { kind: OverHat; s: CreatureSpec }) {
  const c = col(s.color);
  switch (kind) {
    case 'horn':
      return <Horn />;
    case 'ears':
      return <g data-part="ears">{earsOf(s.species, c)}</g>;
    case 'horns':
      return <path data-part="horns" d="M30 34l-6-16 14 10zM70 34l6-16-14 10z" fill={WHITE} stroke={INK} strokeOpacity="0.3" strokeWidth="1" />;
    case 'leaves':
      return <g data-part="leaves">{carrotLeaves()}</g>;
  }
}

function earsOf(species: string, c: string): ReactNode {
  switch (species) {
    case 'cat':
      return (
        <g>
          <path d="M27 38l4-22 16 13z" fill={c} />
          <path d="M73 38l-4-22-16 13z" fill={c} />
          <path d="M31 31l2-10 8 7z" fill={BLUSH} opacity="0.7" />
          <path d="M69 31l-2-10-8 7z" fill={BLUSH} opacity="0.7" />
        </g>
      );
    case 'bear':
      return (
        <g>
          <circle cx="29" cy="31" r="9" fill={c} />
          <circle cx="71" cy="31" r="9" fill={c} />
          <circle cx="29" cy="31" r="4.5" fill={INK} opacity="0.2" />
          <circle cx="71" cy="31" r="4.5" fill={INK} opacity="0.2" />
        </g>
      );
    case 'bunny':
      return (
        <g>
          <rect x="33" y="4" width="11" height="34" rx="5.5" fill={c} />
          <rect x="56" y="4" width="11" height="34" rx="5.5" fill={c} />
          <rect x="36" y="9" width="5" height="22" rx="2.5" fill={BLUSH} opacity="0.7" />
          <rect x="59" y="9" width="5" height="22" rx="2.5" fill={BLUSH} opacity="0.7" />
        </g>
      );
    default:
      return null;
  }
}

function carrotLeaves() {
  const g = v('avatar-green');
  return (
    <g fill={g}>
      <path d="M50 31Q40 22 41 9Q48 17 51 30Z" />
      <path d="M50 31Q60 22 61 9Q53 17 49 30Z" />
      <path d="M50 31Q48 18 50 5Q54 18 51 31Z" />
      <path d="M50 31Q60 22 61 9Q53 17 49 30Z" fill={INK} opacity="0.15" />
    </g>
  );
}

function CreatureBody({ s }: { s: CreatureSpec }) {
  const c = col(s.color);
  const dark = { fill: INK, opacity: 0.18 };
  const light = { fill: WHITE, opacity: 0.3 };
  switch (s.species) {
    case 'cat':
      // Pointed ears with pink insides, a light muzzle and whiskers.
      return (
        <g>
          {earsOf('cat', c)}
          <ellipse cx="50" cy="57" rx="27" ry="27" fill={c} />
          <ellipse cx="50" cy="68" rx="12" ry="8" {...light} />
          <path d="M47.5 61.5h5l-2.5 2.6z" fill={BLUSH} />
          <path d="M22 62l10 1M22 68l10-2M78 62l-10 1M78 68l-10-2" stroke={INK} strokeOpacity="0.4" strokeWidth="1.2" strokeLinecap="round" />
        </g>
      );
    case 'bear':
      return (
        <g>
          {earsOf('bear', c)}
          <circle cx="50" cy="55" r="28" fill={c} />
          <ellipse cx="50" cy="65" rx="13" ry="9" {...light} />
          <ellipse cx="50" cy="59.5" rx="3" ry="2" fill={INK} opacity="0.7" />
        </g>
      );
    case 'bunny':
      return (
        <g>
          {earsOf('bunny', c)}
          <ellipse cx="50" cy="60" rx="26" ry="26" fill={c} />
          <ellipse cx="50" cy="71" rx="11" ry="8" {...light} />
          <ellipse cx="50" cy="64" rx="2.4" ry="1.6" fill={BLUSH} />
        </g>
      );
    case 'blob':
      // A jelly monster with a shine and drippy feet.
      return (
        <g>
          <path d="M24 84q-8-50 26-56t26 56q-4 6-8 0q-4 6-9 0q-4 6-9 0q-4 6-9 0q-4 6-9 0z" fill={c} />
          <ellipse cx="36" cy="42" rx="5" ry="8" transform="rotate(25 36 42)" {...light} />
        </g>
      );
    case 'horns':
      return (
        <g>
          <path d="M30 34l-6-16 14 10zM70 34l6-16-14 10z" fill={WHITE} stroke={INK} strokeOpacity="0.3" strokeWidth="1" />
          <rect x="26" y="28" width="48" height="56" rx="20" fill={c} />
          <ellipse cx="50" cy="74" rx="14" ry="8" {...light} />
          <path d="M26 46l-6 4 6 4M74 46l6 4-6 4" fill={c} />
        </g>
      );
    case 'fluffy':
      return (
        <g fill={c}>
          {Array.from({ length: 12 }, (_, i) => (
            <circle key={i} cx={50 + 25 * Math.cos((i / 12) * Math.PI * 2)} cy={57 + 25 * Math.sin((i / 12) * Math.PI * 2)} r="9" />
          ))}
          <circle cx="50" cy="57" r="25" />
          <path d="M44 30q3-8 6-2q3-8 6 2" fill="none" stroke={c} strokeWidth="4" strokeLinecap="round" />
        </g>
      );
    case 'boxy':
      // A boxy robot: antenna light, a screen face, ear bolts and a chest panel.
      return (
        <g>
          <path d="M50 16v10" stroke={INK} strokeWidth="2" />
          <circle cx="50" cy="14" r="3.2" fill={v('avatar-red')} stroke={WHITE} strokeWidth="1" />
          <Shade d="M18 44h7v14h-7zM75 44h7v14h-7z" colour={c} amount={0.35} />
          <rect x="24" y="26" width="52" height="58" rx="8" fill={c} />
          <rect x="30" y="33" width="40" height="32" rx="6" fill={WHITE} opacity="0.55" />
          <rect x="36" y="71" width="28" height="8" rx="2" fill={INK} opacity="0.2" />
          <circle cx="41" cy="75" r="1.8" fill={v('avatar-yellow')} />
          <circle cx="50" cy="75" r="1.8" fill={v('avatar-green')} />
          <circle cx="59" cy="75" r="1.8" fill={v('avatar-red')} />
        </g>
      );
    case 'round':
      return (
        <g>
          <path d="M50 26v-8" stroke={INK} strokeWidth="2" />
          <circle cx="50" cy="17" r="3" fill={v('avatar-yellow')} stroke={WHITE} strokeWidth="1" />
          <Shade d="M20 54a5 7 0 1 0 0.01 0zM80 54a5 7 0 1 0 0.01 0z" colour={c} amount={0.35} />
          <circle cx="50" cy="55" r="28" fill={c} />
          <ellipse cx="50" cy="55" rx="20" ry="16" fill={WHITE} opacity="0.55" />
          <path d="M30 40q8-10 20-11" stroke={WHITE} strokeOpacity="0.5" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </g>
      );
    case 'antenna':
      return (
        <g>
          <path d="M38 24l-6-12M62 24l6-12" stroke={INK} strokeWidth="2" />
          <circle cx="32" cy="11" r="3.2" fill={v('avatar-yellow')} stroke={WHITE} strokeWidth="1" />
          <circle cx="68" cy="11" r="3.2" fill={v('avatar-yellow')} stroke={WHITE} strokeWidth="1" />
          <rect x="26" y="24" width="48" height="60" rx="14" fill={c} />
          <rect x="32" y="31" width="36" height="30" rx="9" fill={WHITE} opacity="0.45" />
          <rect x="38" y="66" width="24" height="12" rx="3" fill={INK} opacity="0.2" />
          <circle cx="44" cy="72" r="2" fill={v('avatar-red')} />
          <circle cx="56" cy="72" r="2" fill={v('avatar-yellow')} />
          {[30, 70].map((x) => (
            <circle key={x} cx={x} cy={78} r="1.6" fill={INK} opacity="0.3" />
          ))}
        </g>
      );
    case 'antennae':
      return (
        <g>
          <path d="M42 30q-6-14-12-18M58 30q6-14 12-18" stroke={c} strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="30" cy="11" r="4" fill={c} />
          <circle cx="70" cy="11" r="4" fill={c} />
          <circle cx="30" cy="11" r="1.6" {...light} />
          <circle cx="70" cy="11" r="1.6" {...light} />
          <ellipse cx="50" cy="57" rx="26" ry="28" fill={c} />
          <circle cx="32" cy="70" r="3" {...dark} />
          <circle cx="68" cy="72" r="2.4" {...dark} />
          <circle cx="62" cy="36" r="2" {...dark} />
        </g>
      );
    case 'threeEyes':
      return (
        <g>
          {/* Two little waving arms, so the alien is more than an egg. */}
          <path d="M26 66q-10 2-10 12M74 66q10 2 10 12" stroke={c} strokeWidth="6" strokeLinecap="round" fill="none" />
          <ellipse cx="50" cy="57" rx="27" ry="28" fill={c} />
          <ellipse cx="50" cy="76" rx="12" ry="6" {...light} />
        </g>
      );
    case 'bigHead':
      return (
        <g>
          {/* A small body under the big head. */}
          <path d="M36 100q0-22 14-22t14 22z" fill={c} />
          <ellipse cx="50" cy="48" rx="33" ry="28" fill={c} />
          <path d="M28 34q10-12 26-12" stroke={WHITE} strokeOpacity="0.35" strokeWidth="3" strokeLinecap="round" fill="none" />
        </g>
      );
    case 'rex':
      // A little T. rex facing right: big head with a jaw (drawn with the face), tiny arms, strong legs, tail.
      return (
        <g>
          <path d="M32 64Q16 64 6 78L10 83Q22 76 36 77Z" fill={c} />
          <path d="M33 76h10v15h5v5H33z" fill={c} />
          <Shade d="M49 76h9v15h5v5H49z" colour={c} amount={0.2} />
          <ellipse cx="46" cy="69" rx="20" ry="15" fill={c} />
          <ellipse cx="51" cy="73" rx="11" ry="8" {...light} />
          <path d="M40 58Q36 25 62 24H79Q93 25 93 37V44Q93 52 83 52H65Q60 62 47 64Z" fill={c} />
          <path d="M57 65l7 2 1.5 4" stroke={INK} strokeOpacity="0.55" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <ellipse cx="88" cy="31" rx="1.5" ry="1.1" fill={INK} />
        </g>
      );
    case 'spikes':
      // A stegosaur facing right: plates along the back, four legs, a spiky tail, a head big enough for its face.
      return (
        <g>
          {(
            [
              [20, 48],
              [30, 38],
              [43, 33],
              [56, 35],
              [66, 43],
            ] as const
          ).map(([x, y]) => (
            <Shade key={x} d={`M${x - 6} ${y + 10}Q${x - 8} ${y - 1} ${x} ${y - 9}Q${x + 8} ${y - 1} ${x + 6} ${y + 10}Z`} colour={c} />
          ))}
          <path d="M18 64Q8 60 4 50L8 48Q14 56 22 58Z" fill={c} />
          <path d="M7 49l-3-7 6 4zM12 54l-2-7 6 5z" fill={WHITE} stroke={INK} strokeWidth="0.7" />
          <Shade d="M20 66h8v18h-8zM58 66h8v18h-8z" colour={c} amount={0.2} />
          <path d="M28 66h8v18h-8zM66 66h8v18h-8z" fill={c} />
          <path d="M12 70Q16 40 44 40Q68 40 74 62V72Q44 78 12 72Z" fill={c} />
          <path d="M66 62Q70 46 83 46Q97 48 96 60Q95 72 84 73H68Z" fill={c} />
          <path d="M20 68Q44 74 70 68" stroke={WHITE} strokeOpacity="0.35" strokeWidth="3" fill="none" />
        </g>
      );
    case 'longNeck':
      // A long-necked dinosaur: the body and four legs low in the circle, a curved neck, a small head.
      return (
        <g>
          <path d="M24 72Q10 70 4 60L8 57Q14 66 26 66Z" fill={c} />
          <Shade d="M26 76h7v18h-7zM50 76h7v18h-7z" colour={c} amount={0.2} />
          <path d="M36 76h7v18h-7zM60 76h7v18h-7z" fill={c} />
          <ellipse cx="44" cy="72" rx="23" ry="12" fill={c} />
          <path d="M55 68Q70 46 63 22" stroke={c} strokeWidth="11" strokeLinecap="round" fill="none" />
          <ellipse cx="69" cy="20" rx="14" ry="10" fill={c} />
          <path d="M60 54Q66 42 63 30" stroke={WHITE} strokeOpacity="0.3" strokeWidth="3" strokeLinecap="round" fill="none" />
        </g>
      );
    case 'apple':
      return (
        <g>
          <path d="M50 28q-2-8 4-12" stroke={v('avatar-brown')} strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M54 22q8-6 12 0q-6 4-12 0z" fill={v('avatar-green')} />
          <path d="M50 32q-26-10-26 22t26 32q26 0 26-32t-26-22z" fill={c} />
          <ellipse cx="36" cy="46" rx="4" ry="7" transform="rotate(20 36 46)" {...light} />
        </g>
      );
    case 'carrot':
      // A carrot that tapers to a rounded tip, with ridges across and leaves on top.
      return (
        <g>
          {carrotLeaves()}
          <path d="M29 34Q50 24 71 34Q70 62 53 92Q50 96 47 92Q30 62 29 34Z" fill={c} />
          <path d="M31 50h6M34 64h5M38 77h4M69 46h-6M66 60h-5M62 73h-4" stroke={INK} strokeOpacity="0.3" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M34 38q4-4 10-5" stroke={WHITE} strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </g>
      );
    case 'strawberry': {
      // A heart-shaped strawberry with seeds and a leafy top.
      const seed = v('avatar-yellow');
      return (
        <g>
          <path d="M50 90C24 74 18 50 28 38C36 29 46 32 50 38C54 32 64 29 72 38C82 50 76 74 50 90Z" fill={c} />
          {(
            [
              [32, 46],
              [68, 46],
              [28, 58],
              [72, 58],
              [34, 70],
              [66, 70],
              [42, 78],
              [58, 78],
              [50, 84],
              [40, 40],
              [60, 40],
            ] as const
          ).map(([x, y]) => (
            <ellipse key={`${x}-${y}`} cx={x} cy={y} rx="1.2" ry="1.8" fill={seed} />
          ))}
          <path d="M50 37L40 30L46 31L42 24L50 30L58 24L54 31L60 30Z" fill={v('avatar-green')} />
          <path d="M50 30v-7" stroke={v('avatar-green')} strokeWidth="2.5" strokeLinecap="round" />
        </g>
      );
    }
    case 'fish':
      return (
        <g>
          <Shade d="M40 36q8-14 22-8l-4 10z" colour={c} />
          <path d="M80 56l14-14v28z" fill={c} />
          <path d="M84 52l6-6M84 60l6 6" stroke={WHITE} strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" />
          <path d="M14 56q36-44 66 0q-30 44-66 0z" fill={c} />
          <path d="M64 46q6 10 0 20M71 48q5 8 0 16" stroke={WHITE} strokeOpacity="0.35" strokeWidth="2" fill="none" />
        </g>
      );
    case 'octopus':
      // A round head with spots and curly tentacles.
      return (
        <g fill={c}>
          {[30, 40, 50, 60, 70].map((x, i) => (
            <path key={x} d={`M${x - 3.5} 56v22q0 6 5 6t4-4`} stroke={c} strokeWidth="7" strokeLinecap="round" fill="none" transform={i % 2 ? undefined : `translate(${x * 2} 0) scale(-1 1)`} />
          ))}
          <ellipse cx="50" cy="44" rx="27" ry="23" />
          <circle cx="34" cy="32" r="3" {...light} />
          <circle cx="66" cy="30" r="2.2" {...light} />
          <circle cx="60" cy="24" r="1.6" {...light} />
        </g>
      );
    case 'crab':
      // Claws with pincers, little legs and a wide shell.
      return (
        <g>
          <path d="M24 62l-10 6M24 70l-9 8M76 62l10 6M76 70l9 8" stroke={c} strokeWidth="3.5" strokeLinecap="round" />
          <path d="M30 52L24 44M70 52L76 44" stroke={c} strokeWidth="4" strokeLinecap="round" />
          <path d="M22 46a9 9 0 1 1 6-10l-7 4z" fill={c} />
          <path d="M78 46a9 9 0 1 0-6-10l7 4z" fill={c} />
          <ellipse cx="50" cy="61" rx="29" ry="21" fill={c} />
          <path d="M30 52q20-10 40 0" stroke={WHITE} strokeOpacity="0.3" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'unicorn': {
      // A horse's head from the front: ears, a mane in a second colour, a muzzle; the horn comes last.
      const mane = v(s.color === 'pink' ? 'avatar-purple' : 'avatar-pink');
      return (
        <g>
          <path d="M31 30Q16 52 26 86L38 80Q30 58 40 34Z" fill={mane} />
          <path d="M33 31l2-17 11 12zM67 31l-2-17-11 12z" fill={c} />
          <path d="M37 27l1-7 5 5zM63 27l-1-7-5 5z" fill={INK} opacity="0.2" />
          <ellipse cx="50" cy="52" rx="21" ry="27" fill={c} />
          <path d="M40 27Q50 17 60 27Q52 25 46 35Q44 30 40 27Z" fill={mane} />
          <ellipse cx="50" cy="68" rx="14" ry="10" {...light} />
          <ellipse cx="45" cy="68" rx="1.5" ry="2.2" fill={INK} />
          <ellipse cx="55" cy="68" rx="1.5" ry="2.2" fill={INK} />
        </g>
      );
    }
    case 'dragon':
      // From the front: bat wings, dark horns curving back, spiky ear fins, a crest fin, a snout with
      // nostrils and fangs, scales.
      return (
        <g>
          <Shade d="M32 66Q10 62 4 38Q14 45 18 40Q20 50 26 46Q28 56 34 54Z" colour={c} />
          <Shade d="M68 66Q90 62 96 38Q86 45 82 40Q80 50 74 46Q72 56 66 54Z" colour={c} />
          <ellipse cx="50" cy="90" rx="18" ry="16" fill={c} />
          <path d="M42 84h16M43 90h14M45 96h10" stroke={WHITE} strokeOpacity="0.4" strokeWidth="2" />
          <Shade d="M38 34Q24 26 22 8Q34 20 44 29Z" colour={c} amount={0.4} />
          <Shade d="M62 34Q76 26 78 8Q66 20 56 29Z" colour={c} amount={0.4} />
          <Shade d="M30 42L16 36L22 46L14 50L29 54ZM70 42L84 36L78 46L86 50L71 54Z" colour={c} amount={0.3} />
          <ellipse cx="50" cy="50" rx="22" ry="21" fill={c} />
          <Shade d="M45 31Q49 17 60 20Q53 24 53 31Z" colour={c} amount={0.35} />
          <ellipse cx="50" cy="63" rx="15" ry="10" {...light} />
          <ellipse cx="45" cy="59.5" rx="1.4" ry="1.9" fill={INK} />
          <ellipse cx="55" cy="59.5" rx="1.4" ry="1.9" fill={INK} />
          <path d="M31 52q3-3 6 0M30 57q3-3 6 0M63 52q3-3 6 0M64 57q3-3 6 0" stroke={INK} strokeOpacity="0.3" strokeWidth="1.2" fill="none" />
        </g>
      );
    case 'phoenix': {
      // A fire bird: flame crest, raised flame wings, long tail feathers; its beak is its mouth.
      const red = v('avatar-red');
      const orange = v('avatar-orange');
      const yellow = v('avatar-yellow');
      return (
        <g>
          <path d="M44 74Q32 90 32 100H42Q42 88 48 78Z" fill={red} />
          <path d="M56 74Q68 90 68 100H58Q58 88 52 78Z" fill={orange} />
          <path d="M47 76Q48 92 46 100H54Q52 92 53 76Z" fill={yellow} />
          <path d="M32 60Q12 56 5 32Q13 37 16 33Q18 41 22 39Q24 47 31 46Z" fill={orange} stroke={INK} strokeOpacity="0.3" />
          <path d="M68 60Q88 56 95 32Q87 37 84 33Q82 41 78 39Q76 47 69 46Z" fill={orange} stroke={INK} strokeOpacity="0.3" />
          <path d="M31 56Q20 52 16 42Q22 46 25 44Q27 50 32 50Z" fill={yellow} />
          <path d="M69 56Q80 52 84 42Q78 46 75 44Q73 50 68 50Z" fill={yellow} />
          <path d="M44 34Q33 26 36 14Q42 23 46 25Z" fill={orange} />
          <path d="M56 34Q67 26 64 14Q58 23 54 25Z" fill={orange} />
          <path d="M50 33Q39 21 46 4Q50 15 53 11Q61 22 50 33Z" fill={red} />
          <path d="M50 32Q45 23 48 15Q51 22 54 20Q55 27 50 32Z" fill={yellow} />
          <ellipse cx="50" cy="57" rx="20" ry="24" fill={c} />
          <ellipse cx="50" cy="70" rx="11" ry="9" {...light} />
        </g>
      );
    }
    case 'astronaut':
      // A space suit, a white helmet with a coloured visor, a glint and a little antenna.
      return (
        <g>
          <path d="M18 100q0-22 32-22t32 22z" fill={WHITE} stroke={INK} strokeOpacity="0.25" />
          <rect x="44" y="84" width="12" height="8" rx="2" fill={c} />
          <path d="M70 26l8-10" stroke={INK} strokeOpacity="0.5" strokeWidth="2" strokeLinecap="round" />
          <circle cx="78" cy="15" r="2.6" fill={v('avatar-red')} />
          <circle cx="50" cy="50" r="31" fill={WHITE} stroke={INK} strokeOpacity="0.3" />
          <rect x="15" y="44" width="6" height="14" rx="3" fill={INK} opacity="0.15" />
          <rect x="79" y="44" width="6" height="14" rx="3" fill={INK} opacity="0.15" />
          <circle cx="50" cy="52" r="23" fill={c} />
          <path d="M33 42q5-11 17-13" stroke={WHITE} strokeOpacity="0.75" strokeWidth="3" strokeLinecap="round" fill="none" />
          <circle cx="68" cy="66" r="2" fill={WHITE} opacity="0.6" />
        </g>
      );
    case 'pilot': {
      // A rocket pilot: a little rocket behind, a flying helmet with goggles pushed up, a scarf collar.
      const rocket = WHITE;
      return (
        <g>
          <g data-part="rocket" transform="rotate(35 22 74)">
            <path d="M16 92q6 8 12 0l-2 8h-8z" fill={v('avatar-orange')} />
            <path d="M18 90q4 4 8 0l-1 4h-6z" fill={v('avatar-yellow')} />
            <path d="M14 90l-4 4v-12l4-2zM30 90l4 4v-12l-4-2z" fill={v('avatar-red')} />
            <path d="M14 90V70q8-16 16 0v20z" fill={rocket} stroke={INK} strokeOpacity="0.35" />
            <circle cx="22" cy="76" r="3.2" fill={v('avatar-blue')} stroke={INK} strokeOpacity="0.4" />
          </g>
          <circle cx="50" cy="56" r="26" fill={c} />
          <path d="M24 54Q24 26 50 26T76 54Q74 44 64 40H36Q26 44 24 54Z" fill={v('avatar-brown')} />
          <path d="M24 54v12q0 4 4 4v-14zM76 54v12q0 4-4 4v-14z" fill={v('avatar-brown')} />
          <g data-part="goggles">
            <rect x="33" y="33" width="34" height="5" rx="2.5" fill={INK} opacity="0.55" />
            <circle cx="41" cy="35.5" r="5.5" fill={v('avatar-mint')} stroke={INK} strokeWidth="1.5" />
            <circle cx="59" cy="35.5" r="5.5" fill={v('avatar-mint')} stroke={INK} strokeWidth="1.5" />
            <path d="M38.5 34q1.5-2 3.5-2M56.5 34q1.5-2 3.5-2" stroke={WHITE} strokeWidth="1.3" strokeLinecap="round" fill="none" />
          </g>
        </g>
      );
    }
    case 'starKid': {
      // A star with rounded points and a twinkle.
      const star = 'M50 14l10 22 25 3-19 17 6 25-22-13-22 13 6-25-19-17 25-3z';
      return (
        <g>
          <path d={star} fill={c} stroke={c} strokeWidth="8" strokeLinejoin="round" />
          <path d="M40 30l4-8" stroke={WHITE} strokeOpacity="0.4" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M82 18l1.2 2.6 2.6 1.2-2.6 1.2-1.2 2.6-1.2-2.6-2.6-1.2 2.6-1.2z" fill={WHITE} opacity="0.8" />
        </g>
      );
    }
    case 'football': {
      // A white ball, the face on the white middle, patches in the colour around it, seams between.
      const patch = (x: number, y: number, r: number, turn = 0) => {
        const pts = Array.from({ length: 5 }, (_, i) => {
          const a = ((i * 72 - 90 + turn) * Math.PI) / 180;
          return `${(x + r * Math.cos(a)).toFixed(1)} ${(y + r * Math.sin(a)).toFixed(1)}`;
        });
        return `M${pts.join('L')}Z`;
      };
      return (
        <g>
          <circle cx="50" cy="54" r="29" fill={WHITE} stroke={INK} strokeOpacity="0.3" />
          <path d="M50 37v-8M36 47l-11-5M64 47l11-5M41 72l-7 8M59 72l7 8" stroke={INK} strokeOpacity="0.3" strokeWidth="1.2" />
          <path d={`${patch(50, 29, 6.5)}${patch(26, 46, 6, 36)}${patch(74, 46, 6, 36)}${patch(33, 78, 6, 36)}${patch(67, 78, 6, 36)}`} fill={c} stroke={INK} strokeOpacity="0.3" strokeWidth="1" />
          <path d="M36 46q14-10 28 0l-2 24H38z" fill="none" stroke={INK} strokeOpacity="0.15" strokeWidth="1.2" />
        </g>
      );
    }
    case 'basketball':
      return (
        <g>
          <circle cx="50" cy="54" r="28" fill={c} />
          <path d="M22 54h12M66 54h12M50 26v10M50 76v6M30 34q14 20 0 40M70 34q-14 20 0 40" stroke={INK} strokeOpacity="0.35" strokeWidth="1.5" fill="none" />
          <path d="M33 38q6-6 14-8" stroke={WHITE} strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </g>
      );
    case 'tennis':
      return (
        <g>
          <circle cx="50" cy="54" r="28" fill={c} />
          <path d="M26 40q16 14 0 30M74 40q-16 14 0 30" stroke={WHITE} strokeWidth="2.5" fill="none" />
          <path d="M34 34q8-6 16-7" stroke={WHITE} strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </g>
      );
    default:
      return <circle cx="50" cy="54" r="27" fill={c} />;
  }
}

/** The mouth that belongs to the species, following the spec's mouth option where it can (open or closed). */
function SpeciesMouth({ spot, kind, colour, k }: { spot: FaceSpot['mouth']; kind: string; colour: string; k: number }) {
  const { x, y, w } = spot;
  const open = OPEN.has(kind);
  switch (spot.style) {
    case 'beak': {
      // A beak, never a person's mouth; orange on a yellow bird so it always shows.
      const fill = v(colour === 'yellow' || colour === 'orange' ? 'avatar-red' : 'avatar-yellow');
      return (
        <g data-part="beak" transform={around(x, y, k * 0.85)}>
          <path d={`M${x - w / 2} ${y}H${x + w / 2}L${x} ${y + (open ? 7 : 10)}Z`} fill={fill} stroke={INK} strokeWidth="1" strokeLinejoin="round" />
          {open ? <path d={`M${x - w / 2 + 1} ${y + 2}H${x + w / 2 - 1}L${x} ${y + 11}Z`} fill={fill} stroke={INK} strokeWidth="1" strokeLinejoin="round" /> : null}
        </g>
      );
    }
    case 'jaw': {
      // A dinosaur jaw along the head, with a row of teeth; open shows the inside.
      const left = x - w / 2;
      const teeth = Array.from({ length: Math.floor(w / 6) }, (_, i) => `M${left + 3 + i * 6} ${y}l1.6 3.2 1.6-3.2z`).join('');
      return (
        <g data-part="jaw">
          {open ? <path d={`M${left} ${y - 1}L${left + w} ${y - 2}L${left + w - 2} ${y + 5}Q${x} ${y + 9} ${left + 1} ${y + 4}Z`} fill={INK} {...rimmed} /> : null}
          {open && kind === 'tongue' ? <path d={`M${x - 4} ${y + 4}q4 4 8 0`} fill={BLUSH} /> : null}
          <RimLine d={`M${left} ${y}H${left + w}`} width={2.4} />
          <path d={teeth} fill={WHITE} stroke={INK} strokeWidth="0.6" strokeLinejoin="round" />
        </g>
      );
    }
    case 'muzzle':
      return (
        <g data-part="muzzle" transform={around(x, y, k * 0.85)}>
          {open ? <path d={`M${x - w / 2} ${y - 1}q${w / 2} ${w * 0.6} ${w} 0z`} fill={INK} {...rimmed} /> : <RimLine d={`M${x - w / 2} ${y}q${w / 2} 3 ${w} 0`} />}
          {open && kind === 'tongue' ? <path d={`M${x - 2} ${y + 1.5}q2 3.5 4 0`} fill={BLUSH} /> : null}
        </g>
      );
    case 'snout': {
      // A wide snout (the dragon) always shows two small fangs: it is a dragon, not a cow.
      const fangs = w >= 12;
      return (
        <g data-part="snout" transform={around(x, y, fangs ? k * 0.85 : k * 0.75)}>
          {open ? <path d={`M${x - w / 2} ${y - 1}q${w / 2} ${w * 0.55} ${w} 0z`} fill={INK} {...rimmed} /> : <RimLine d={`M${x - w / 2} ${y}q${w / 2} ${Math.max(2, w * 0.3)} ${w} 0`} />}
          {fangs ? <path d={`M${x - 5} ${y + (open ? -0.5 : 1)}l1.5 3.4 1.5-3.4zM${x + 2} ${y + (open ? -0.5 : 1)}l1.5 3.4 1.5-3.4z`} fill={WHITE} stroke={INK} strokeWidth="0.5" /> : null}
        </g>
      );
    }
    default:
      return (
        <g data-part="mouth" transform={`translate(${x} ${y}) scale(${k}) translate(-50 ${-y})`}>
          <Mouth kind={kind} cy={y} />
        </g>
      );
  }
}

/** The unicorn's spiral horn, drawn after the hat so it always shows. */
function Horn() {
  return (
    <g data-part="horn">
      <path d="M50 1l-5.5 26h11z" fill={v('badge-gold')} stroke={INK} strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M46 22l8-2.4M46.8 16l6.6-2M47.8 10l4.6-1.4M48.8 5l2.4-.7" stroke={INK} strokeOpacity="0.45" strokeWidth="1" strokeLinecap="round" />
    </g>
  );
}

function Creature({ s }: { s: CreatureSpec }) {
  const f = faceOf(s);
  const e = f.eyes;
  const h = f.hat;
  // S17c: faces FACE_SCALE larger at the same anchors; the eye spacing stays where it was.
  const k = e.scale * FACE_SCALE;
  const hatMoved = h.x !== 50 || h.scale !== 1;
  const clash = coloursClash(s.color, s.bgColor);
  return (
    <g>
      <Background kind={s.bg} colour={s.bgColor} />
      {clash ? <Veil /> : null}
      {clash ? (
        <g data-part="rim" stroke={OUTLINE} strokeWidth="4" strokeLinejoin="round">
          <CreatureBody s={s} />
        </g>
      ) : null}
      <CreatureBody s={s} />
      <g transform={`translate(${e.x} ${e.y}) scale(${k}) translate(-50 ${-e.y})`}>
        <Eyes kind={s.eyes} cy={e.y} dx={e.dx / k} />
      </g>
      {s.species === 'threeEyes' ? (
        <g data-part="third-eye" transform={around(50, e.y - 13, k)}>
          <Eye kind="dots" x={50} y={e.y - 13} side={-1} />
        </g>
      ) : null}
      <SpeciesMouth spot={f.mouth} kind={s.mouth} colour={s.color} k={f.mouth.style === 'person' ? Math.max(1.15, k * 0.9) : k} />
      <g data-part="hat" transform={hatMoved ? `translate(${h.x} ${h.top}) scale(${h.scale}) translate(-50 ${-h.top})` : undefined}>
        <Hat kind={s.hat} colour={s.accentColor} top={h.top} />
      </g>
      {f.overHat === 'horn' || (f.overHat && s.hat !== 'none') ? <OverHatPart kind={f.overHat} s={s} /> : null}
      {s.accessory !== 'none' ? (
        <g data-part="accessory" transform={accessoryTransform(s.species, s.accessory)}>
          <Accessory kind={s.accessory} colour={s.accentColor} />
        </g>
      ) : null}
    </g>
  );
}

/** The avatar picture (decorative: the name is always next to it). */
export const AvatarArt = memo(function AvatarArt({ spec, size, title }: { spec: AvatarSpecValue; size?: number | string; title?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="cc-avatar-art" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title} focusable="false">
      {/* Clipped to a circle by CSS (.cc-avatar-art: border-radius + overflow), so no ids repeat on the page. */}
      {spec.type === 'person' ? <Person s={spec} /> : <Creature s={spec} />}
    </svg>
  );
});
