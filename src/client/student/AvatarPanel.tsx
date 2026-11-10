/**
 * "My avatar" on the student page (S13c items 9 and 11, D-124): choose a ready-made avatar or build
 * one (a person or a creature) with a live large preview and a card-size preview. Randomise, a
 * "Surprise me" per part and Undo; parts that need a badge show which badge unlocks them. The server
 * checks the spec again (catalogue keys only) and refuses changes while the teacher has paused them.
 *
 * Built from native selects and buttons: small, fast on a cheap phone and accessible (axe-checked at
 * 375×812). The ready-made list is drawn in pages of 24.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AVATAR_COLOURS,
  AVATAR_UNLOCKS,
  COLOUR_NAMES,
  CREATURE_FAMILIES,
  CREATURE_FAMILY_KEYS,
  CREATURE_PARTS,
  HAIR_COLOURS,
  HAIR_COLOUR_NAMES,
  OPTION_NAMES,
  PART_LABELS,
  PERSON_PARTS,
  READY_MADE,
  SKIN_NAMES,
  SKIN_TONES,
  describeAvatar,
  randomCreature,
  randomPerson,
  type AvatarSpecValue,
} from '../../shared/avatars.ts';
import { DEFAULT_ACHIEVEMENTS } from '../../shared/achievements.ts';
import { studentSetAvatar, type StudentAvatarInfo } from '../../shared/contracts/avatars.ts';
import { pickText } from '../../shared/i18n/index.ts';
import { AvatarArt } from '../avatars/AvatarArt.tsx';
import { call } from '../lib/api.ts';
import { reasonOf } from '../lib/errors.ts';
import { showToast } from '../lib/toast.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from '../ui/Button.tsx';
import { orderByFamilies, orderFamilies } from '../../shared/themePackage/engine.ts';
import { useTheme } from '../themes/index.tsx';
import { STUDENT_PAGE_KEY } from './keys.ts';

type Part = { key: string; options: readonly string[]; names: (o: string) => string };
const PAGE = 24;

function partsOf(spec: AvatarSpecValue, locale: 'en' | 'tr', families: readonly string[] = CREATURE_FAMILY_KEYS): Part[] {
  const opt = (part: string) => (o: string) => OPTION_NAMES[`${part}.${o}`]?.[locale] ?? o;
  const colour = (o: string) => COLOUR_NAMES[o as keyof typeof COLOUR_NAMES]?.[locale] ?? o;
  if (spec.type === 'creature') {
    return [
      // The theme's families first (S17a, D-166: `sets.avatarFamiliesFirst`); every family stays.
      { key: 'family', options: families, names: opt('family') },
      { key: 'species', options: CREATURE_FAMILIES[spec.family], names: opt('species') },
      { key: 'color', options: AVATAR_COLOURS, names: colour },
      { key: 'eyes', options: CREATURE_PARTS.eyes, names: opt('eyes') },
      { key: 'mouth', options: CREATURE_PARTS.mouth, names: opt('mouth') },
      { key: 'hat', options: CREATURE_PARTS.hat, names: opt('hat') },
      { key: 'accessory', options: CREATURE_PARTS.accessory, names: opt('accessory') },
      { key: 'accentColor', options: AVATAR_COLOURS, names: colour },
      { key: 'bg', options: CREATURE_PARTS.bg, names: opt('bg') },
      { key: 'bgColor', options: AVATAR_COLOURS, names: colour },
    ];
  }
  const p = PERSON_PARTS;
  return [
    { key: 'skin', options: SKIN_TONES, names: (o) => SKIN_NAMES[o as keyof typeof SKIN_NAMES]?.[locale] ?? o },
    { key: 'face', options: p.face, names: opt('face') },
    { key: 'hair', options: p.hair, names: opt('hair') },
    { key: 'hairColor', options: HAIR_COLOURS, names: (o) => HAIR_COLOUR_NAMES[o as keyof typeof HAIR_COLOUR_NAMES]?.[locale] ?? o },
    { key: 'eyes', options: p.eyes, names: opt('eyes') },
    { key: 'brows', options: p.brows, names: opt('brows') },
    { key: 'mouth', options: p.mouth, names: opt('mouth') },
    { key: 'cheeks', options: p.cheeks, names: opt('cheeks') },
    { key: 'glasses', options: p.glasses, names: opt('glasses') },
    { key: 'body', options: p.body, names: opt('body') },
    { key: 'top', options: p.top, names: opt('top') },
    { key: 'topColor', options: AVATAR_COLOURS, names: colour },
    { key: 'hat', options: p.hat, names: opt('hat') },
    { key: 'accessory', options: p.accessory, names: opt('accessory') },
    { key: 'accentColor', options: AVATAR_COLOURS, names: colour },
    { key: 'pet', options: p.pet, names: opt('pet') },
    { key: 'bg', options: p.bg, names: opt('bg') },
    { key: 'bgColor', options: AVATAR_COLOURS, names: colour },
  ];
}

const badgeName = (key: string, locale: 'en' | 'tr') => {
  const d = DEFAULT_ACHIEVEMENTS.find((x) => x.key === key);
  return d ? pickText(d.name, locale) : key;
};

function setPart(spec: AvatarSpecValue, key: string, value: string): AvatarSpecValue {
  if (spec.type === 'creature' && key === 'family') {
    const family = value as keyof typeof CREATURE_FAMILIES;
    return { ...spec, family, species: CREATURE_FAMILIES[family][0] };
  }
  return { ...spec, [key]: value } as AvatarSpecValue;
}

/** `titleId`: the screen's h1 names the panel (S14d "My avatar" screen), so the panel has no heading of its own. */
export function AvatarPanel({ info, name, titleId }: { info: StudentAvatarInfo; name: string; titleId?: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'ready' | 'make'>('ready');
  const [draft, setDraft] = useState<AvatarSpecValue>(info.spec ?? info.generated);
  const [history, setHistory] = useState<AvatarSpecValue[]>([]);
  const [shown, setShown] = useState(PAGE);
  // Theme sets (S17a, D-166): only the order changes; nothing is hidden and saved avatars never change.
  const first = useTheme().sets?.avatarFamiliesFirst;
  const firstKey = first?.join(',') ?? '';
  const families = useMemo(() => orderFamilies(CREATURE_FAMILY_KEYS, first), [firstKey]);
  const readyMade = useMemo(() => orderByFamilies(READY_MADE, first), [firstKey]);
  const earned = new Set(info.earned);
  const change = (next: AvatarSpecValue) => {
    setHistory((h) => [...h.slice(-19), draft]);
    setDraft(next);
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
  const surprise = (p: Part) => {
    const ok = p.options.filter((o) => !isLocked(p.key, o) && o !== (draft as unknown as Record<string, string>)[p.key]);
    if (ok.length) change(setPart(draft, p.key, ok[Math.floor(Math.random() * ok.length)]!));
  };
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
              <ul className="cc-avatar-grid" aria-label={t('avatar.readyMade')}>
                {readyMade.slice(0, shown).map((spec, i) => {
                  const label = describeAvatar(spec, locale);
                  return (
                    <li key={i}>
                      <button type="button" className="cc-avatar-choice" aria-label={label} aria-pressed={JSON.stringify(spec) === JSON.stringify(draft)} onClick={() => change(spec)} data-testid="avatar-ready">
                        <AvatarArt spec={spec} size="100%" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {shown < readyMade.length ? (
                <Button onPress={() => setShown((n) => n + PAGE)}>{t('avatar.showMore', { count: readyMade.length - shown })}</Button>
              ) : null}
            </>
          ) : (
            <div className="cc-stack">
              <div className="cc-row" role="group" aria-label={pickText(PART_LABELS.type, locale)}>
                <Button variant={draft.type === 'person' ? 'primary' : 'secondary'} aria-pressed={draft.type === 'person'} onPress={() => change(randomPerson(Math.random))} data-testid="avatar-type-person">
                  {t('avatar.person')}
                </Button>
                <Button variant={draft.type === 'creature' ? 'primary' : 'secondary'} aria-pressed={draft.type === 'creature'} onPress={() => change(randomCreature(Math.random))} data-testid="avatar-type-creature">
                  {t('avatar.creature')}
                </Button>
              </div>
              {partsOf(draft, locale, families).map((p) => {
                const id = `avatar-part-${p.key}`;
                const value = (draft as unknown as Record<string, string>)[p.key] ?? '';
                return (
                  <div key={p.key} className="cc-avatar-part">
                    <label htmlFor={id}>{pickText(PART_LABELS[p.key as keyof typeof PART_LABELS], locale)}</label>
                    <select id={id} className="cc-select" value={value} onChange={(e) => change(setPart(draft, p.key, e.target.value))} data-testid={id}>
                      {p.options.map((o) => {
                        const k = unlockOf(p.key, o);
                        const locked = isLocked(p.key, o);
                        return (
                          <option key={o} value={o} disabled={locked}>
                            {p.names(o)}
                            {k ? ` (${locked ? t('avatar.unlockWith', { badge: badgeName(k, locale) }) : t('avatar.unlocked')})` : ''}
                          </option>
                        );
                      })}
                    </select>
                    <Button size="small" variant="ghost" onPress={() => surprise(p)} aria-label={t('avatar.surprisePart', { part: pickText(PART_LABELS[p.key as keyof typeof PART_LABELS], locale) })}>
                      {t('avatar.surprise')}
                    </Button>
                  </div>
                );
              })}
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
