/**
 * Avatar renderer (S13c items 9 and 11, D-124, D-125). Original, flat geometric art drawn for Class
 * Compass: simple circles, rounded rectangles and short paths in a 100×100 box, coloured only with
 * theme tokens (`--cc-avatar-*`), so every theme can retune the palette. It deliberately does not
 * imitate any show, game or existing character set (D-125).
 *
 * One small inline SVG per avatar, no images and no fetch: cheap to draw on an old phone and safe on
 * the classroom display. Layers, back to front: background, pet, body/top, face, hair, features,
 * glasses, hat, accessory.
 */
import { memo } from 'react';
import type { AvatarSpecValue, CreatureSpec, PersonSpec } from '../../shared/avatars.ts';

const v = (t: string) => `var(--cc-${t})`;
const INK = v('avatar-ink');
const WHITE = v('avatar-white');
const col = (c: string) => v(`avatar-${c}`);
const skinOf = (s: string) => v(`avatar-skin-${s.replace('skin', '')}`);
const hairOf = (h: string) => v(`avatar-hair-${h}`);

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

function Eyes({ kind, cy = 44, dx = 8 }: { kind: string; cy?: number; dx?: number }) {
  const L = 50 - dx;
  const R = 50 + dx;
  switch (kind) {
    case 'round':
      return (
        <g>
          {[L, R].map((x) => (
            <g key={x}>
              <circle cx={x} cy={cy} r="4.2" fill={WHITE} stroke={INK} strokeWidth="1" />
              <circle cx={x} cy={cy + 0.5} r="2" fill={INK} />
            </g>
          ))}
        </g>
      );
    case 'happy':
      return <path d={`M${L - 3.5} ${cy + 1}q3.5-4 7 0M${R - 3.5} ${cy + 1}q3.5-4 7 0`} stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" />;
    case 'wink':
      return (
        <g>
          <circle cx={L} cy={cy} r="2.4" fill={INK} />
          <path d={`M${R - 3.5} ${cy}h7`} stroke={INK} strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case 'sparkle':
      return (
        <g>
          {[L, R].map((x) => (
            <g key={x}>
              <circle cx={x} cy={cy} r="3.4" fill={INK} />
              <circle cx={x + 1.2} cy={cy - 1.2} r="1.1" fill={WHITE} />
            </g>
          ))}
        </g>
      );
    case 'sleepy':
      return <path d={`M${L - 3.5} ${cy}q3.5 3 7 0M${R - 3.5} ${cy}q3.5 3 7 0`} stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" />;
    case 'big':
      return (
        <g>
          {[L, R].map((x) => (
            <g key={x}>
              <ellipse cx={x} cy={cy} rx="4.6" ry="5.4" fill={WHITE} stroke={INK} strokeWidth="1" />
              <circle cx={x} cy={cy + 1} r="2.6" fill={INK} />
              <circle cx={x + 1} cy={cy} r="0.9" fill={WHITE} />
            </g>
          ))}
        </g>
      );
    case 'lashes':
      return (
        <g>
          {[L, R].map((x) => (
            <g key={x}>
              <circle cx={x} cy={cy} r="2.6" fill={INK} />
              <path d={`M${x - 3} ${cy - 3}l-1.4-1.6M${x} ${cy - 3.6}v-2M${x + 3} ${cy - 3}l1.4-1.6`} stroke={INK} strokeWidth="1" strokeLinecap="round" />
            </g>
          ))}
        </g>
      );
    default:
      return (
        <g>
          <circle cx={L} cy={cy} r="2.4" fill={INK} />
          <circle cx={R} cy={cy} r="2.4" fill={INK} />
        </g>
      );
  }
}

function Mouth({ kind, cy = 55 }: { kind: string; cy?: number }) {
  const s = { stroke: INK, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const };
  switch (kind) {
    case 'grin':
      return <path d={`M42 ${cy - 1}q8 7 16 0z`} fill={INK} />;
    case 'laugh':
      return (
        <g>
          <path d={`M41 ${cy - 2}q9 11 18 0z`} fill={INK} />
          <path d={`M46 ${cy + 3}q4 2 8 0`} fill={v('avatar-blush')} />
        </g>
      );
    case 'small':
      return <path d={`M47 ${cy}q3 2 6 0`} {...s} />;
    case 'tongue':
      return (
        <g>
          <path d={`M43 ${cy - 1}q7 6 14 0`} {...s} />
          <path d={`M48 ${cy + 1.5}q2 4 4 0`} fill={v('avatar-blush')} />
        </g>
      );
    case 'calm':
      return <path d={`M45 ${cy}h10`} {...s} />;
    case 'teeth':
      return (
        <g>
          <rect x="43" y={cy - 3} width="14" height="6" rx="3" fill={INK} />
          <rect x="45" y={cy - 3} width="10" height="2.4" fill={WHITE} />
        </g>
      );
    case 'cat':
      return <path d={`M44 ${cy - 1}q3 3 6 0q3 3 6 0`} {...s} />;
    default:
      return <path d={`M43 ${cy - 1}q7 6 14 0`} {...s} />;
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
      return <path d="M36 70q14 7 28 0v6q-14 7-28 0z" fill={c} />;
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
      return <path d="M38 37h7M55 37h7" {...s} />;
    case 'raised':
      return <path d="M38 36l7-2M55 34l7 2" {...s} />;
    case 'curved':
      return <path d="M38 37q3.5-3 7 0M55 37q3.5-3 7 0" {...s} />;
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
          <ellipse cx="38" cy="51" rx="3.6" ry="2.2" />
          <ellipse cx="62" cy="51" rx="3.6" ry="2.2" />
        </g>
      ) : null}
      {freckles ? (
        <g fill={INK} opacity="0.35">
          {[
            [39, 48],
            [41, 50],
            [37, 50],
            [61, 48],
            [59, 50],
            [63, 50],
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
  return (
    <g>
      <Background kind={s.bg} colour={s.bgColor} />
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
      <Eyes kind={s.eyes} />
      <Brows kind={s.brows} fill={covered ? INK : hair} />
      <Mouth kind={s.mouth} />
      <HairFront kind={s.hair} fill={hair} scarf={scarf} />
      <Glasses kind={s.glasses} />
      {s.hair !== 'hijab' ? <Hat kind={s.hat} colour={s.accentColor === s.topColor ? 'yellow' : s.accentColor} /> : null}
      <Accessory kind={s.accessory} colour={s.accentColor} />
      <Pet kind={s.pet} />
    </g>
  );
}

// ---------------------------------------------------------------- creatures
function CreatureBody({ s }: { s: CreatureSpec }) {
  const c = col(s.color);
  const dark = { fill: INK, opacity: 0.18 };
  switch (s.species) {
    case 'cat':
      return (
        <g fill={c}>
          <path d="M28 34l4-18 14 12zM72 34l-4-18-14 12z" />
          <ellipse cx="50" cy="56" rx="26" ry="28" />
        </g>
      );
    case 'bear':
      return (
        <g fill={c}>
          <circle cx="30" cy="30" r="8" />
          <circle cx="70" cy="30" r="8" />
          <circle cx="50" cy="54" r="27" />
          <ellipse cx="50" cy="60" rx="10" ry="7" {...dark} />
        </g>
      );
    case 'bunny':
      return (
        <g fill={c}>
          <rect x="34" y="6" width="10" height="30" rx="5" />
          <rect x="56" y="6" width="10" height="30" rx="5" />
          <ellipse cx="50" cy="58" rx="25" ry="26" />
        </g>
      );
    case 'blob':
      return <path d="M24 84q-8-50 26-56t26 56q-26 8-52 0z" fill={c} />;
    case 'horns':
      return (
        <g fill={c}>
          <path d="M30 34l-6-16 14 10zM70 34l6-16-14 10z" fill={WHITE} />
          <rect x="26" y="28" width="48" height="56" rx="20" />
        </g>
      );
    case 'fluffy':
      return (
        <g fill={c}>
          {Array.from({ length: 10 }, (_, i) => (
            <circle key={i} cx={50 + 24 * Math.cos((i / 10) * Math.PI * 2)} cy={56 + 24 * Math.sin((i / 10) * Math.PI * 2)} r="9" />
          ))}
          <circle cx="50" cy="56" r="24" />
        </g>
      );
    case 'boxy':
      return (
        <g>
          <path d="M50 16v10" stroke={INK} strokeWidth="2" />
          <circle cx="50" cy="14" r="3" fill={v('avatar-red')} />
          <rect x="24" y="26" width="52" height="56" rx="8" fill={c} />
          <rect x="32" y="34" width="36" height="28" rx="5" fill={WHITE} opacity="0.5" />
        </g>
      );
    case 'round':
      return (
        <g>
          <circle cx="50" cy="54" r="28" fill={c} />
          <circle cx="50" cy="50" r="18" fill={WHITE} opacity="0.5" />
        </g>
      );
    case 'antenna':
      return (
        <g>
          <path d="M38 24l-6-12M62 24l6-12" stroke={INK} strokeWidth="2" />
          <circle cx="32" cy="11" r="3" fill={v('avatar-yellow')} />
          <circle cx="68" cy="11" r="3" fill={v('avatar-yellow')} />
          <rect x="26" y="24" width="48" height="58" rx="14" fill={c} />
        </g>
      );
    case 'antennae':
      return (
        <g>
          <path d="M42 26q-6-14-12-16M58 26q6-14 12-16" stroke={c} strokeWidth="3" fill="none" />
          <ellipse cx="50" cy="56" rx="26" ry="28" fill={c} />
        </g>
      );
    case 'threeEyes':
      return <ellipse cx="50" cy="56" rx="27" ry="28" fill={c} />;
    case 'bigHead':
      return <ellipse cx="50" cy="48" rx="32" ry="28" fill={c} />;
    case 'rex':
      return (
        <g fill={c}>
          <path d="M26 84V48q0-24 28-24t20 24l-2 8H50v28z" />
        </g>
      );
    case 'spikes':
      return (
        <g fill={c}>
          <path d="M30 34l6-12 6 10 8-12 8 12 6-10 6 12z" opacity="0.7" />
          <ellipse cx="50" cy="58" rx="26" ry="26" />
        </g>
      );
    case 'longNeck':
      return (
        <g fill={c}>
          <rect x="42" y="30" width="16" height="50" rx="8" />
          <ellipse cx="54" cy="30" rx="18" ry="14" />
          <ellipse cx="50" cy="84" rx="26" ry="12" />
        </g>
      );
    case 'apple':
      return (
        <g>
          <path d="M50 28q-2-8 4-12" stroke={v('avatar-brown')} strokeWidth="3" fill="none" />
          <path d="M54 22q8-6 12 0q-6 4-12 0z" fill={v('avatar-green')} />
          <path d="M50 32q-26-10-26 22t26 32q26 0 26-32t-26-22z" fill={c} />
        </g>
      );
    case 'carrot':
      return (
        <g>
          <path d="M44 18l6 10 6-10" stroke={v('avatar-green')} strokeWidth="4" fill="none" />
          <path d="M28 30h44l-22 58z" fill={c} />
        </g>
      );
    case 'strawberry':
      return (
        <g>
          <path d="M30 30q20-12 40 0z" fill={v('avatar-green')} />
          <path d="M26 34h48q0 30-24 52q-24-22-24-52z" fill={c} />
          {[36, 50, 64].map((x) => (
            <circle key={x} cx={x} cy="72" r="1.4" fill={v('avatar-yellow')} />
          ))}
        </g>
      );
    case 'fish':
      return (
        <g fill={c}>
          <path d="M14 56q36-44 66 0q-30 44-66 0z" />
          <path d="M80 56l14-14v28z" />
        </g>
      );
    case 'octopus':
      return (
        <g fill={c}>
          <ellipse cx="50" cy="44" rx="26" ry="22" />
          {[30, 40, 50, 60, 70].map((x) => (
            <rect key={x} x={x - 3.5} y="56" width="7" height="28" rx="3.5" />
          ))}
        </g>
      );
    case 'crab':
      return (
        <g fill={c}>
          <circle cx="22" cy="40" r="8" />
          <circle cx="78" cy="40" r="8" />
          <ellipse cx="50" cy="60" rx="28" ry="20" />
        </g>
      );
    case 'unicorn':
      return (
        <g>
          <path d="M50 4l-5 22h10z" fill={v('badge-gold')} />
          <ellipse cx="50" cy="54" rx="25" ry="28" fill={c} />
          <path d="M70 34q14 10 6 30" stroke={v('avatar-pink')} strokeWidth="5" fill="none" />
        </g>
      );
    case 'dragon':
      return (
        <g fill={c}>
          <path d="M20 40l12 10-2-18zM80 40l-12 10 2-18z" opacity="0.7" />
          <ellipse cx="50" cy="56" rx="26" ry="27" />
          <path d="M36 28l4-10 4 8 6-10 6 10 4-8 4 10z" fill={v('avatar-yellow')} />
        </g>
      );
    case 'phoenix':
      return (
        <g>
          <path d="M50 10q-10 10-4 20q4-8 4-20zM50 10q10 10 4 20q-4-8-4-20z" fill={v('avatar-yellow')} />
          <path d="M18 60q16-4 20 10zM82 60q-16-4-20 10z" fill={v('avatar-orange')} />
          <ellipse cx="50" cy="56" rx="22" ry="27" fill={c} />
        </g>
      );
    case 'astronaut':
      return (
        <g>
          <circle cx="50" cy="50" r="30" fill={WHITE} stroke={INK} strokeOpacity="0.3" />
          <circle cx="50" cy="50" r="22" fill={c} />
        </g>
      );
    case 'pilot':
      return (
        <g>
          <circle cx="50" cy="52" r="26" fill={c} />
          <path d="M26 44q24-30 48 0z" fill={v('avatar-brown')} />
        </g>
      );
    case 'starKid':
      return <path d="M50 12l10 24 26 2-20 17 6 26-22-14-22 14 6-26-20-17 26-2z" fill={c} />;
    case 'football':
      return (
        <g>
          <circle cx="50" cy="54" r="28" fill={WHITE} stroke={INK} strokeOpacity="0.3" />
          <path d="M50 42l9 6-3 10H44l-3-10z" fill={c} />
        </g>
      );
    case 'basketball':
      return (
        <g>
          <circle cx="50" cy="54" r="28" fill={c} />
          <path d="M22 54h56M50 26v56M30 34q14 20 0 40M70 34q-14 20 0 40" stroke={INK} strokeOpacity="0.35" strokeWidth="1.5" fill="none" />
        </g>
      );
    case 'tennis':
      return (
        <g>
          <circle cx="50" cy="54" r="28" fill={c} />
          <path d="M26 40q16 14 0 30M74 40q-16 14 0 30" stroke={WHITE} strokeWidth="2.5" fill="none" />
        </g>
      );
    default:
      return <circle cx="50" cy="54" r="27" fill={c} />;
  }
}

function Creature({ s }: { s: CreatureSpec }) {
  const eyeY = s.species === 'bigHead' ? 44 : s.species === 'longNeck' ? 28 : s.family === 'fruits' ? 58 : 50;
  const mouthY = eyeY + 11;
  return (
    <g>
      <Background kind={s.bg} colour={s.bgColor} />
      <CreatureBody s={s} />
      <Eyes kind={s.eyes} cy={eyeY} dx={s.species === 'longNeck' ? 6 : 9} />
      {s.species === 'threeEyes' ? <circle cx="50" cy={eyeY - 9} r="2.6" fill={INK} /> : null}
      <Mouth kind={s.mouth} cy={mouthY} />
      <Hat kind={s.hat} colour={s.accentColor} top={s.family === 'animals' || s.species === 'unicorn' ? 26 : 22} />
      <Accessory kind={s.accessory} colour={s.accentColor} />
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
