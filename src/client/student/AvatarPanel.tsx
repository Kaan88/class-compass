/**
 * "My avatar" on the student page (S13c items 9 and 11, D-124; picture picker S17c, D-169): choose a
 * ready-made avatar or build one (a person or a character) with a live large preview and a card-size
 * preview. Randomise, a "Surprise me" per part and Undo; parts that need an achievement say which one
 * unlocks them. The server checks the spec again (catalogue keys only) and refuses changes while the
 * teacher has paused them.
 *
 * S17c: the choices are pictures, not words. Families are buttons with a thumbnail, in the theme's
 * order (S17a `avatarFamiliesFirst`); the ready-made avatars are shown one family at a time; every
 * other part is a labelled radio group (native radios: arrow keys move, the screen reader reads the
 * part and the option) of colour swatches, pictures of the avatar with that option, or close-ups of the
 * face for eyes, mouth, brows, glasses and cheeks. Every choice is at least `--cc-touch` big and the
 * chosen one is marked by a tick and a frame, not by colour alone.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AVATAR_UNLOCKS, COLOUR_NAMES, CREATURE_FAMILIES, HAIR_COLOUR_NAMES, OPTION_NAMES, PART_LABELS, SKIN_NAMES, describeAvatar, randomCreature, randomPerson, type AvatarSpecValue, type CreatureFamily } from '../../shared/avatars.ts';
import { DEFAULT_ACHIEVEMENTS } from '../../shared/achievements.ts';
import { studentSetAvatar, type StudentAvatarInfo } from '../../shared/contracts/avatars.ts';
import { pickText } from '../../shared/i18n/index.ts';
import { AvatarArt } from '../avatars/AvatarArt.tsx';
import { call } from '../lib/api.ts';
import { reasonOf } from '../lib/errors.ts';
import { showToast } from '../lib/toast.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from '../ui/Button.tsx';
import { IconLock } from '../ui/icons.tsx';
import { useTheme } from '../themes/index.tsx';
import { STUDENT_PAGE_KEY } from './keys.ts';
import { familyOrder, pickerParts, readyMadeGroups, setPart, surpriseOptions, type PickerPart } from './avatarPicker.ts';

type Locale = 'en' | 'tr';
const partLabel = (key: string, locale: Locale) => pickText(PART_LABELS[key as keyof typeof PART_LABELS], locale);
const optionName = (p: PickerPart, o: string, locale: Locale): string => {
  if (p.kind === 'colour') return COLOUR_NAMES[o as keyof typeof COLOUR_NAMES]?.[locale] ?? o;
  if (p.kind === 'skin') return SKIN_NAMES[o as keyof typeof SKIN_NAMES]?.[locale] ?? o;
  if (p.kind === 'hair') return HAIR_COLOUR_NAMES[o as keyof typeof HAIR_COLOUR_NAMES]?.[locale] ?? o;
  return OPTION_NAMES[`${p.key}.${o}`]?.[locale] ?? o;
};
/** The swatch's avatar colour token (every one exists in every theme: `avatars-badges.test.tsx`). */
const token = (t: string) => `var(--cc-${t})`;
const swatchColour = (p: PickerPart, o: string) => token(p.kind === 'skin' ? `avatar-skin-${o.replace('skin', '')}` : p.kind === 'hair' ? `avatar-hair-${o}` : `avatar-${o}`);

const badgeName = (key: string, locale: Locale) => {
  const d = DEFAULT_ACHIEVEMENTS.find((x) => x.key === key);
  return d ? pickText(d.name, locale) : key;
};

/** Family buttons with a thumbnail (the first ready-made of the family), in the theme's order. */
function FamilyTabs({ families, value, onChange, idPrefix }: { families: readonly CreatureFamily[]; value: CreatureFamily; onChange: (f: CreatureFamily) => void; idPrefix: string }) {
  const { t, locale } = useI18n();
  const groups = readyMadeGroups(families);
  return (
    <div className="cc-avatar-families" role="group" aria-label={t('avatar.families')} data-testid={`${idPrefix}-families`}>
      {groups.map(({ family, avatars }) => (
        <button key={family} type="button" className="cc-avatar-family" aria-pressed={family === value} onClick={() => onChange(family)} data-testid={`${idPrefix}-family-${family}`}>
          <AvatarArt spec={avatars[0]!} size="100%" />
          <span>{OPTION_NAMES[`family.${family}`]?.[locale] ?? family}</span>
        </button>
      ))}
    </div>
  );
}

/** One part as a labelled radio group of swatches or pictures. */
function PartChoice({ part, draft, onChoose, isLocked, unlockOf, onSurprise }: { part: PickerPart; draft: AvatarSpecValue; onChoose: (v: string) => void; isLocked: (p: string, o: string) => boolean; unlockOf: (p: string, o: string) => string | undefined; onSurprise: () => void }) {
  const { t, locale } = useI18n();
  const label = partLabel(part.key, locale);
  const value = (draft as unknown as Record<string, string>)[part.key];
  const locked = part.options.filter((o) => unlockOf(part.key, o));
  return (
    <fieldset className="cc-avatar-part" data-testid={`avatar-part-${part.key}`}>
      <legend className="cc-avatar-part__legend">{label}</legend>
      <Button size="small" variant="ghost" className="cc-avatar-part__surprise" onPress={onSurprise} aria-label={t('avatar.surprisePart', { part: label })}>
        {t('avatar.surprise')}
      </Button>
      <div className={`cc-avatar-options cc-avatar-options--${part.kind === 'picture' || part.kind === 'face' ? 'pictures' : 'swatches'}`}>
        {part.options.map((o) => {
          const name = optionName(part, o, locale);
          const off = isLocked(part.key, o);
          return (
            <label key={o} className="cc-avatar-opt">
              <input type="radio" className="cc-visually-hidden" name={`avatar-${part.key}`} value={o} checked={value === o} disabled={off} onChange={() => onChoose(o)} />
              <span className="cc-avatar-opt__pic" aria-hidden="true">
                {part.kind === 'picture' || part.kind === 'face' ? (
                  <AvatarArt spec={setPart(draft, part.key, o)} size="100%" zoom={part.kind === 'face' ? 'face' : undefined} />
                ) : (
                  <span className="cc-avatar-swatch" style={{ background: swatchColour(part, o) }} />
                )}
                {off ? (
                  <span className="cc-avatar-opt__lock">
                    <IconLock />
                  </span>
                ) : null}
              </span>
              <span className="cc-visually-hidden">{name}</span>
            </label>
          );
        })}
      </div>
      {locked.length ? (
        <ul className="cc-avatar-unlocks cc-muted">
          {locked.map((o) => {
            const k = unlockOf(part.key, o)!;
            return <li key={o}>{`${optionName(part, o, locale)}: ${isLocked(part.key, o) ? t('avatar.unlockWith', { badge: badgeName(k, locale) }) : t('avatar.unlocked')}`}</li>;
          })}
        </ul>
      ) : null}
    </fieldset>
  );
}

/** `titleId`: the screen's h1 names the panel (S14d "My avatar" screen), so the panel has no heading of its own. */
export function AvatarPanel({ info, name, titleId }: { info: StudentAvatarInfo; name: string; titleId?: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'ready' | 'make'>('ready');
  const [draft, setDraft] = useState<AvatarSpecValue>(info.spec ?? info.generated);
  const [history, setHistory] = useState<AvatarSpecValue[]>([]);
  // Theme sets (S17a, D-166): only the order changes; nothing is hidden and saved avatars never change.
  const first = useTheme().sets?.avatarFamiliesFirst;
  const firstKey = first?.join(',') ?? '';
  const families = useMemo(() => familyOrder(first), [firstKey]);
  const groups = useMemo(() => readyMadeGroups(first), [firstKey]);
  const [readyFamily, setReadyFamily] = useState<CreatureFamily>(families[0]!);
  const [makeFamily, setMakeFamily] = useState<CreatureFamily>(draft.type === 'creature' ? draft.family : families[0]!);
  const earned = new Set(info.earned);
  const change = (next: AvatarSpecValue) => {
    setHistory((h) => [...h.slice(-19), draft]);
    setDraft(next);
    if (next.type === 'creature') setMakeFamily(next.family);
  };
  const save = useMutation({
    mutationFn: (spec: AvatarSpecValue) => call(studentSetAvatar, { spec }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: STUDENT_PAGE_KEY });
      showToast({ message: t('avatar.saved'), kind: 'success' });
      setOpen(false);
    },
    onError: (e) => showToast({ message: reasonOf(e) === 'AVATAR_LOCKED' ? t('avatar.lockedByTeacher') : reasonOf(e) === 'AVATAR_PART_LOCKED' ? t('avatar.partLocked') : t('common.error'), kind: 'error' }),
  });
  const current = info.spec ?? (info.fallback === 'generated' ? info.generated : null);
  const unlockOf = (part: string, o: string) => AVATAR_UNLOCKS[`${part}.${o}`];
  const isLocked = (part: string, o: string) => {
    const k = unlockOf(part, o);
    return k !== undefined && !earned.has(k);
  };
  const surprise = (p: PickerPart) => {
    const ok = surpriseOptions(draft, p, isLocked);
    if (ok.length) change(setPart(draft, p.key, ok[Math.floor(Math.random() * ok.length)]!));
  };
  const readyAvatars = groups.find((g) => g.family === readyFamily)?.avatars ?? [];
  const speciesPart: PickerPart = { key: 'species', kind: 'picture', options: CREATURE_FAMILIES[makeFamily] };
  return (
    <section className="cc-card cc-stack cc-avatar-panel" aria-labelledby={titleId ?? 'my-avatar'} data-testid="student-avatar">
      <div className="cc-row">
        {current ? <AvatarArt spec={current} size={titleId ? 96 : 64} title={describeAvatar(current, locale)} /> : null}
        <div className="cc-stack">
          {titleId ? null : (
            <h2 id="my-avatar" className="cc-h2">
              {t('avatar.title')}
            </h2>
          )}
          {info.locked ? <p className="cc-muted">{t('avatar.lockedByTeacher')}</p> : null}
        </div>
        {!info.locked ? (
          <Button className="cc-push-right" onPress={() => setOpen((o) => !o)} aria-expanded={open} data-testid="avatar-change">
            {open ? t('common.close') : t('avatar.change')}
          </Button>
        ) : null}
      </div>
      {open && !info.locked ? (
        <div className="cc-stack" data-testid="avatar-creator">
          <div className="cc-row" role="group" aria-label={t('avatar.how')}>
            <Button variant={tab === 'ready' ? 'primary' : 'secondary'} aria-pressed={tab === 'ready'} onPress={() => setTab('ready')} data-testid="avatar-tab-ready">
              {t('avatar.readyMade')}
            </Button>
            <Button variant={tab === 'make' ? 'primary' : 'secondary'} aria-pressed={tab === 'make'} onPress={() => setTab('make')} data-testid="avatar-tab-make">
              {t('avatar.makeOwn')}
            </Button>
          </div>
          <div className="cc-avatar-preview">
            <AvatarArt spec={draft} size={160} title={describeAvatar(draft, locale)} />
            <div className="cc-stack cc-avatar-preview__card" aria-hidden="true">
              <span className="cc-avatar cc-avatar--art">
                <AvatarArt spec={draft} size="100%" />
              </span>
              <span className="cc-muted">{name}</span>
            </div>
          </div>
          {tab === 'ready' ? (
            <>
              <FamilyTabs families={families} value={readyFamily} onChange={setReadyFamily} idPrefix="avatar-ready" />
              <ul className="cc-avatar-grid" aria-label={`${t('avatar.readyMade')}: ${OPTION_NAMES[`family.${readyFamily}`]?.[locale] ?? readyFamily}`} data-testid="avatar-ready-list">
                {readyAvatars.map((spec, i) => (
                  <li key={i}>
                    <button type="button" className="cc-avatar-choice" aria-label={describeAvatar(spec, locale)} aria-pressed={JSON.stringify(spec) === JSON.stringify(draft)} onClick={() => change(spec)} data-testid="avatar-ready">
                      <AvatarArt spec={spec} size="100%" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="cc-stack">
              <div className="cc-row" role="group" aria-label={partLabel('type', locale)}>
                <Button variant={draft.type === 'person' ? 'primary' : 'secondary'} aria-pressed={draft.type === 'person'} onPress={() => change(randomPerson(Math.random))} data-testid="avatar-type-person">
                  {t('avatar.person')}
                </Button>
                <Button variant={draft.type === 'creature' ? 'primary' : 'secondary'} aria-pressed={draft.type === 'creature'} onPress={() => change(randomCreature(Math.random))} data-testid="avatar-type-creature">
                  {t('avatar.creature')}
                </Button>
              </div>
              {draft.type === 'creature' ? (
                <>
                  {/* A family only shows its characters; the avatar changes when a character is chosen. */}
                  <FamilyTabs families={families} value={makeFamily} onChange={setMakeFamily} idPrefix="avatar-make" />
                  <PartChoice part={speciesPart} draft={draft} onChoose={(o) => change(setPart(draft, 'species', o))} isLocked={isLocked} unlockOf={unlockOf} onSurprise={() => surprise(speciesPart)} />
                </>
              ) : null}
              {pickerParts(draft).map((p) => (
                <PartChoice key={p.key} part={p} draft={draft} onChoose={(o) => change(setPart(draft, p.key, o))} isLocked={isLocked} unlockOf={unlockOf} onSurprise={() => surprise(p)} />
              ))}
            </div>
          )}
          <div className="cc-row">
            <Button onPress={() => change(draft.type === 'person' ? randomPerson(Math.random) : randomCreature(Math.random))} data-testid="avatar-randomise">
              {t('avatar.randomise')}
            </Button>
            <Button
              isDisabled={!history.length}
              onPress={() => {
                const prev = history[history.length - 1];
                if (!prev) return;
                setHistory((h) => h.slice(0, -1));
                setDraft(prev);
              }}
              data-testid="avatar-undo"
            >
              {t('avatar.undo')}
            </Button>
            <Button variant="primary" className="cc-push-right" isDisabled={save.isPending} onPress={() => save.mutate(draft)} data-testid="avatar-save">
              {t('avatar.save')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
