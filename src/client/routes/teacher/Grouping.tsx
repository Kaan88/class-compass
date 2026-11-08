/**
 * Grouping in the teacher area (PIN-gated in classroom mode): GRP-1..8, D-072, D-073.
 * - Arrangements: the five defaults plus the teacher's own; generate again, change type and size,
 *   edit by hand (move a student, rename a group, set roles), save as a new arrangement, archive.
 *   Rules an arrangement breaks are listed with the reason (GRP-8).
 * - Levels: the subject levels used by level-based arrangements (GRP-3). Teacher-only (GRP-7).
 * - Pair rules: should / should not work together, with a private note (GRP-4).
 * S13a (D-098): the four default options with icons, "Use the 4 default options" for older classes,
 * and the same tap-to-move editor as the group screen, plus the levels column (teacher-only).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { orderedLevels } from '../../../domain/grouping.ts';
import * as G from '../../../shared/contracts/grouping.ts';
import type { GroupTemplate, GroupingOverview, PairRule, Sizing } from '../../../shared/contracts/grouping.ts';
import * as School from '../../../shared/contracts/school.ts';
import * as St from '../../../shared/contracts/students.ts';
import { pickText, type MessageKey } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { useRun } from '../../lib/useRun.ts';
import { Button } from '../../ui/Button.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select, TextField, Toggle } from '../../ui/Fields.tsx';
import { IconArchive, IconPlus, IconSync, IconUndo, IconX } from '../../ui/icons.tsx';
import { Tabs } from '../../ui/Tabs.tsx';
import { GroupPicto, OptionPicto } from '../../ui/pictos.tsx';

const CONTEXTS_KEY = ['classroom', 'contexts'] as const;
const ALL = [SENSITIVE, 'teacher', 'grouping'] as const;
const overviewKey = (contextId: string, archived: boolean) => [...ALL, contextId, archived ? 'all' : 'live'] as const;

type T = ReturnType<typeof useI18n>['t'];
type Student = GroupingOverview['students'][number];

const sizingText = (t: T, s: Sizing) => ('groupCount' in s ? t('grouping.sizing.count', { count: s.groupCount }) : t('grouping.sizing.size', { count: s.targetSize }));

function UnsatisfiedList({ tpl, names }: { tpl: GroupTemplate; names: Map<string, string> }) {
  const { t } = useI18n();
  if (!tpl.unsatisfied.length) return null;
  return (
    <Alert kind="warning">
      <strong>{t('grouping.unsatisfiedTitle')}</strong>
      <ul>
        {tpl.unsatisfied.map((u) => (
          <li key={u.ruleId}>
            {t(u.kind === 'apart' ? 'grouping.rule.apartPair' : 'grouping.rule.togetherPair', { a: names.get(u.a) ?? '?', b: names.get(u.b) ?? '?' })}
            {' – '}
            {t(`grouping.reason.${u.reason}` as MessageKey)}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

/** Teacher view of the groups: like the display, plus each student's level (teacher-only, GRP-7). */
function TeacherGroups({ tpl, byId }: { tpl: GroupTemplate; byId: Map<string, Student> }) {
  const { t, locale } = useI18n();
  return (
    <ul className="cc-groups">
      {tpl.groups.map((g) => (
        <li key={g.id} className="cc-group">
          <div className="cc-group__head">
            <span className="cc-group__icon" aria-hidden="true">
              <GroupPicto icon={g.icon} />
            </span>
            <span className="cc-group__name">{pickText(g.name, locale)}</span>
            <span className="cc-chip">{t('grouping.memberCount', { count: g.memberIds.length })}</span>
          </div>
          <ul className="cc-group__members">
            {g.memberIds.map((id) => {
              const s = byId.get(id);
              const role = g.roles.find((r) => r.studentId === id);
              return (
                <li key={id} className="cc-row">
                  <span>{s?.fullName ?? t('grouping.leftClass')}</span>
                  {s?.level ? <span className="cc-chip">{t('grouping.levelChip', { level: s.level })}</span> : null}
                  {role ? <span className="cc-chip">{pickText(role.label, locale)}</span> : null}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

type Draft = { id: string; name: { en: string; tr: string }; icon: string; memberIds: string[]; roles: Record<string, { en: string; tr: string }> };

/** Editable copy of the groups: students who have left the class are taken out (GRP-3). */
function toDraft(tpl: GroupTemplate, inClass: (id: string) => boolean): Draft[] {
  return tpl.groups.map((g) => ({
    id: g.id,
    name: { en: g.name.en ?? '', tr: g.name.tr ?? '' },
    icon: g.icon,
    memberIds: g.memberIds.filter(inClass),
    roles: Object.fromEntries(g.roles.filter((r) => inClass(r.studentId)).map((r) => [r.studentId, { en: r.label.en ?? '', tr: r.label.tr ?? '' }])),
  }));
}
/** Leaves an empty language out, so the other one is shown instead of an empty label. */
const localized = (t: { en: string; tr: string }) => ({ ...(t.en.trim() ? { en: t.en.trim() } : {}), ...(t.tr.trim() ? { tr: t.tr.trim() } : {}) });
const fromDraft = (d: Draft[]) =>
  d.map((g) => ({
    id: g.id,
    name: localized(g.name),
    icon: g.icon,
    memberIds: g.memberIds,
    roles: g.memberIds.filter((id) => g.roles[id]?.en.trim() || g.roles[id]?.tr.trim()).map((id) => ({ studentId: id, label: localized(g.roles[id]!) })),
  }));

function Editor({ tpl, contextId, byId, onDone }: { tpl: GroupTemplate; contextId: string; byId: Map<string, Student>; onDone: () => void }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const [groups, setGroups] = useState<Draft[]>(() => toDraft(tpl, (id) => byId.has(id)));
  const [copyName, setCopyName] = useState('');
  // Tap a name, then "Move here" on a group (the same gesture as the classroom group screen, S13a).
  const [picked, setPicked] = useState<string | null>(null);
  const leftCount = tpl.groups.flatMap((g) => g.memberIds).filter((id) => !byId.has(id)).length;
  const placed = new Set(groups.flatMap((g) => g.memberIds));
  const unplaced = [...byId.values()].filter((s) => !placed.has(s.id));
  const move = (studentId: string, to: number) => {
    setPicked(null);
    setGroups((gs) => gs.map((g, i) => ({ ...g, memberIds: i === to ? [...g.memberIds.filter((x) => x !== studentId), studentId] : g.memberIds.filter((x) => x !== studentId) })));
  };
  const levelChip = (id: string) => {
    const level = byId.get(id)?.level;
    return level ? <span className="cc-chip" data-testid="editor-level">{t('grouping.levelChip', { level })}</span> : null;
  };
  /** A compact, tappable name chip (not a full-width bar that looks like an empty field). */
  const memberChip = (id: string, name: string) => (
    <li key={id} className="cc-group-editor__member">
      <Button size="small" className="cc-group-editor__chip" aria-pressed={picked === id} data-testid="editor-member" onPress={() => setPicked(picked === id ? null : id)}>
        {name}
      </Button>
      {levelChip(id)}
    </li>
  );
  const patch = (i: number, fn: (g: Draft) => Draft) => setGroups((gs) => gs.map((g, j) => (j === i ? fn(g) : g)));
  const valid = groups.every((g) => g.name.en.trim() || g.name.tr.trim());
  const groupItems = groups.map((g, i) => ({ id: String(i), label: pickText(g.name, locale) || t('grouping.groupN', { n: i + 1 }) }));
  const pickedName = picked ? (byId.get(picked)?.fullName ?? t('grouping.leftClass')) : '';
  const pickedGroup = picked ? groups.findIndex((g) => g.memberIds.includes(picked)) : -1;
  return (
    <div className="cc-stack" data-testid="grouping-editor">
      {leftCount ? <Alert kind="warning">{t('grouping.leftRemoved', { count: leftCount })}</Alert> : null}
      {/* Sticky: after tapping a name, every group is one tap away, wherever the page is scrolled (D-098). */}
      <div className="cc-group-editor__bar" role="status" data-testid="editor-move-bar">
        {picked ? (
          <>
            <span className="cc-group-editor__picked">{t('grouping.moveNameTo', { name: pickedName })}</span>
            {groups.map((g, i) =>
              i === pickedGroup ? null : (
                <Button key={g.id} size="small" variant="primary" data-testid="editor-move-here" onPress={() => move(picked, i)}>
                  {groupItems[i]!.label}
                </Button>
              ),
            )}
            <Button size="small" variant="ghost" onPress={() => setPicked(null)}>
              <IconX />
              {t('grouping.cancelMove')}
            </Button>
          </>
        ) : (
          <span className="cc-muted">{t('grouping.editorTapHint')}</span>
        )}
      </div>
      {unplaced.length ? (
        <fieldset className="cc-fieldset cc-stack" data-testid="grouping-unplaced">
          <legend>{t('grouping.unplaced')}</legend>
          <p className="cc-muted">{t('grouping.unplacedHint')}</p>
          <ul className="cc-group-editor__members">{unplaced.map((s) => memberChip(s.id, s.fullName))}</ul>
        </fieldset>
      ) : null}
      {/* Side by side like the arrangements (cc-groups), not one long form. */}
      <ul className="cc-groups cc-groups--editor">
        {groups.map((g, i) => (
          <li key={g.id} className="cc-group cc-group-editor" aria-label={groupItems[i]!.label}>
            <div className="cc-group__head">
              <span className="cc-group__icon" aria-hidden="true">
                <GroupPicto icon={g.icon} />
              </span>
              <span className="cc-group__name">{groupItems[i]!.label}</span>
              <span className="cc-chip">{t('grouping.memberCount', { count: g.memberIds.length })}</span>
            </div>
            <ul className="cc-group-editor__members">{g.memberIds.map((id) => memberChip(id, byId.get(id)?.fullName ?? t('grouping.leftClass')))}</ul>
            {picked && i !== pickedGroup ? (
              <Button size="small" className="cc-group__here" onPress={() => move(picked, i)}>
                {t('grouping.moveHere', { group: groupItems[i]!.label })}
              </Button>
            ) : null}
            <details className="cc-disclosure">
              <summary>{t('grouping.nameAndRoles')}</summary>
              <div className="cc-stack">
                <TextField label={t('grouping.groupNameEn')} value={g.name.en} onChange={(v) => patch(i, (x) => ({ ...x, name: { ...x.name, en: v } }))} />
                <TextField label={t('grouping.groupNameTr')} value={g.name.tr} onChange={(v) => patch(i, (x) => ({ ...x, name: { ...x.name, tr: v } }))} />
                {g.memberIds.map((id) => {
                  const name = byId.get(id)?.fullName ?? t('grouping.leftClass');
                  const role = g.roles[id] ?? { en: '', tr: '' };
                  return (
                    <fieldset key={id} className="cc-fieldset cc-group-editor__role">
                      <legend>{name}</legend>
                      <TextField label={t('grouping.roleEn', { name })} value={role.en} onChange={(v) => patch(i, (x) => ({ ...x, roles: { ...x.roles, [id]: { ...role, en: v } } }))} />
                      <TextField label={t('grouping.roleTr', { name })} value={role.tr} onChange={(v) => patch(i, (x) => ({ ...x, roles: { ...x.roles, [id]: { ...role, tr: v } } }))} />
                    </fieldset>
                  );
                })}
              </div>
            </details>
            {!(g.name.en.trim() || g.name.tr.trim()) ? <p className="cc-field__error">{t('grouping.nameNeeded')}</p> : null}
          </li>
        ))}
      </ul>
      <p className="cc-muted">{t('grouping.roleHint')}</p>
      <div className="cc-row">
        <Button
          variant="primary"
          isDisabled={!valid}
          onPress={() =>
            void run(() => call(G.updateGroupTemplate, { templateId: tpl.id, expectedVersion: tpl.version, groups: fromDraft(groups) }), { success: t('grouping.toast.saved'), invalidate: [ALL] }).then((r) => r && onDone())
          }
        >
          {t('common.save')}
        </Button>
        <Button onPress={onDone}>{t('common.cancel')}</Button>
      </div>
      <div className="cc-row" style={{ alignItems: 'flex-end' }}>
        <TextField label={t('grouping.saveAsName')} description={t('grouping.nameShownHint')} value={copyName} onChange={setCopyName} />
        <Button
          isDisabled={!valid || !copyName.trim()}
          onPress={() =>
            void run(() => call(G.createGroupTemplate, { contextId, name: { [locale]: copyName.trim() }, mode: 'custom', sizing: tpl.sizing, groups: fromDraft(groups) }), {
              success: t('grouping.toast.created'),
              invalidate: [ALL],
            }).then((r) => r && onDone())
          }
        >
          <IconPlus />
          {t('grouping.saveAs')}
        </Button>
      </div>
    </div>
  );
}

const OPTION_ICON_KEYS = {
  lion: 'grouping.icon.lion',
  eagle: 'grouping.icon.eagle',
  dolphin: 'grouping.icon.dolphin',
  tiger: 'grouping.icon.tiger',
  owl: 'grouping.icon.owl',
  fox: 'grouping.icon.fox',
  turtle: 'grouping.icon.turtle',
  bee: 'grouping.icon.bee',
} as const satisfies Record<G.OptionIcon, MessageKey>;

function TemplateCard({ tpl, contextId, byId }: { tpl: GroupTemplate; contextId: string; byId: Map<string, Student> }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const [editing, setEditing] = useState(false);
  const names = new Map([...byId].map(([id, s]) => [id, s.fullName]));
  const title = pickText(tpl.name, locale);
  return (
    <section className="cc-card cc-stack" aria-label={title} data-testid="arrangement">
      <div className="cc-row">
        <OptionPicto icon={tpl.icon} size="2rem" />
        <h2 className="cc-h2">{title}</h2>
        <span className="cc-chip">{t(`grouping.mode.${tpl.mode}`)}</span>
        <span className="cc-chip">{sizingText(t, tpl.sizing)}</span>
        {tpl.archived ? <span className="cc-chip">{t('grouping.archived')}</span> : null}
      </div>
      {editing ? (
        <Editor tpl={tpl} contextId={contextId} byId={byId} onDone={() => setEditing(false)} />
      ) : (
        <>
          <TeacherGroups tpl={tpl} byId={byId} />
          <UnsatisfiedList tpl={tpl} names={names} />
          <div className="cc-row">
            {!tpl.archived ? (
              <>
                <Button onPress={() => void run(() => call(G.generateGroupTemplate, { templateId: tpl.id, expectedVersion: tpl.version }), { success: t('grouping.toast.generated'), invalidate: [ALL] })}>
                  <IconSync />
                  {tpl.mode === 'custom' ? t('grouping.generateMixed') : t('grouping.generate')}
                </Button>
                <Button onPress={() => setEditing(true)}>{t('grouping.edit')}</Button>
                <TypeSize tpl={tpl} />
                <Select
                  label={t('grouping.optionIcon')}
                  value={tpl.icon ?? ''}
                  placeholder={t('grouping.noIcon')}
                  items={G.OPTION_ICONS.map((i) => ({ id: i, label: t(OPTION_ICON_KEYS[i]) }))}
                  onChange={(v) => void run(() => call(G.updateGroupTemplate, { templateId: tpl.id, expectedVersion: tpl.version, icon: v ? (v as G.OptionIcon) : null }), { invalidate: [ALL] })}
                />
              </>
            ) : null}
            <Button className="cc-push-right" onPress={() => void run(() => call(G.archiveGroupTemplate, { templateId: tpl.id, archived: !tpl.archived }), { invalidate: [ALL] })}>
              {tpl.archived ? <IconUndo /> : <IconArchive />}
              {tpl.archived ? t('grouping.restore') : t('grouping.archive')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

/** Change the type (level / mixed) or the size of an arrangement; the groups are generated again (GRP-2). */
function TypeSize({ tpl }: { tpl: GroupTemplate }) {
  const { t } = useI18n();
  const run = useRun();
  const kind = 'groupCount' in tpl.sizing ? 'count' : 'size';
  const n = 'groupCount' in tpl.sizing ? tpl.sizing.groupCount : tpl.sizing.targetSize;
  const save = (mode: 'level' | 'mixed', sizing: Sizing) => void run(() => call(G.updateGroupTemplate, { templateId: tpl.id, expectedVersion: tpl.version, mode, sizing }), { success: t('grouping.toast.saved'), invalidate: [ALL] });
  const mode = tpl.mode === 'custom' ? 'mixed' : tpl.mode;
  return (
    <>
      <Select label={t('grouping.type')} items={[{ id: 'level', label: t('grouping.mode.level') }, { id: 'mixed', label: t('grouping.mode.mixed') }]} value={mode} onChange={(v) => save(v as 'level' | 'mixed', tpl.sizing)} />
      <Select
        label={kind === 'count' ? t('grouping.groupsCount') : t('grouping.groupSize')}
        items={Array.from({ length: kind === 'count' ? G.MAX_GROUPS : G.MAX_GROUP_SIZE }, (_, i) => ({ id: String(i + 1), label: String(i + 1) }))}
        value={String(n)}
        onChange={(v) => save(mode, kind === 'count' ? { groupCount: Number(v) } : { targetSize: Number(v) })}
      />
    </>
  );
}

function NewArrangement({ contextId }: { contextId: string }) {
  const { t } = useI18n();
  const run = useRun();
  const [name, setName] = useState({ en: '', tr: '' });
  const [mode, setMode] = useState<'level' | 'mixed'>('mixed');
  const [kind, setKind] = useState<'count' | 'size'>('size');
  const [n, setN] = useState('4');
  const num = Number(n);
  const valid = Boolean(name.en.trim() || name.tr.trim()) && Number.isInteger(num) && num >= 1 && num <= (kind === 'count' ? G.MAX_GROUPS : G.MAX_GROUP_SIZE);
  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-new-arrangement">
      <h2 id="cc-new-arrangement" className="cc-h2">
        {t('grouping.new')}
      </h2>
      <div className="cc-row" style={{ alignItems: 'flex-end' }}>
        <TextField label={t('grouping.nameEn')} description={t('grouping.nameShownHint')} value={name.en} onChange={(v) => setName({ ...name, en: v })} />
        <TextField label={t('grouping.nameTr')} value={name.tr} onChange={(v) => setName({ ...name, tr: v })} />
        <Select label={t('grouping.type')} items={[{ id: 'mixed', label: t('grouping.mode.mixed') }, { id: 'level', label: t('grouping.mode.level') }]} value={mode} onChange={(v) => setMode(v as 'level' | 'mixed')} />
        <Select label={t('grouping.sizeBy')} items={[{ id: 'size', label: t('grouping.groupSize') }, { id: 'count', label: t('grouping.groupsCount') }]} value={kind} onChange={(v) => setKind(v as 'count' | 'size')} />
        <TextField label={kind === 'count' ? t('grouping.groupsCount') : t('grouping.groupSize')} inputMode="numeric" value={n} onChange={setN} />
        <Button
          variant="primary"
          isDisabled={!valid}
          onPress={() =>
            void run(() => call(G.createGroupTemplate, { contextId, name: localized(name), mode, sizing: kind === 'count' ? { groupCount: num } : { targetSize: num } }), { success: t('grouping.toast.created'), invalidate: [ALL] }).then(
              (r) => r && setName({ en: '', tr: '' }),
            )
          }
        >
          <IconPlus />
          {t('grouping.create')}
        </Button>
      </div>
    </section>
  );
}

function ArrangementsTab({ contextId }: { contextId: string }) {
  const { t } = useI18n();
  const run = useRun();
  const [archived, setArchived] = useState(false);
  const q = useQuery({ queryKey: overviewKey(contextId, archived), queryFn: () => call(G.getGrouping, { contextId, ...(archived ? { includeArchived: '1' as const } : {}) }) });
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const byId = new Map(q.data.students.map((s) => [s.id, s]));
  return (
    <div className="cc-stack">
      <p className="cc-muted">{t('grouping.teacherIntro')}</p>
      {q.data.canUseNewDefaults ? (
        <Alert kind="warning">
          <div className="cc-stack" data-testid="use-default-options">
            <span>{t('grouping.useDefaultsHint')}</span>
            <Button variant="primary" onPress={() => void run(() => call(G.useDefaultGroupOptions, { contextId }), { success: t('grouping.toast.defaultsUsed'), invalidate: [ALL] })}>
              {t('grouping.useDefaults')}
            </Button>
          </div>
        </Alert>
      ) : null}
      <Toggle label={t('grouping.showArchived')} isSelected={archived} onChange={setArchived} />
      {q.data.templates.map((tpl) => (
        <TemplateCard key={`${tpl.id}.${tpl.version}`} tpl={tpl} contextId={contextId} byId={byId} />
      ))}
      <NewArrangement contextId={contextId} />
    </div>
  );
}

function LevelsTab({ contextId }: { contextId: string }) {
  const { t } = useI18n();
  const run = useRun();
  const q = useQuery({ queryKey: overviewKey(contextId, false), queryFn: () => call(G.getGrouping, { contextId }) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const changed = q.data.students.filter((s) => draft[s.id] !== undefined && draft[s.id]!.trim() !== (s.level ?? ''));
  // The order the solver will use for the levels as typed now (GRP-3), so it is never a surprise.
  const order = orderedLevels(q.data.students.map((s) => draft[s.id] ?? s.level));
  return (
    <div className="cc-stack">
      <p className="cc-muted">{t('grouping.levelsIntro')}</p>
      <p className="cc-muted">{t('grouping.levelsFormat')}</p>
      {order.length ? (
        <p data-testid="level-order">
          {t('grouping.levelOrder', { order: order.join(' < ') })}
        </p>
      ) : null}
      <ul className="cc-stack">
        {q.data.students.map((s) => (
          <li key={s.id} className="cc-row">
            <TextField label={t('grouping.levelFor', { name: s.fullName })} value={draft[s.id] ?? s.level ?? ''} onChange={(v) => setDraft({ ...draft, [s.id]: v })} />
          </li>
        ))}
      </ul>
      <div>
        <Button
          variant="primary"
          isDisabled={!changed.length}
          onPress={() =>
            void run(() => call(St.setContextLevels, { contextId, levels: changed.map((s) => ({ studentId: s.id, level: draft[s.id]!.trim() || null })) }), { success: t('grouping.toast.levelsSaved'), invalidate: [ALL] }).then(
              (r) => r && setDraft({}),
            )
          }
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

function RulesTab({ contextId }: { contextId: string }) {
  const { t } = useI18n();
  const run = useRun();
  const q = useQuery({ queryKey: overviewKey(contextId, false), queryFn: () => call(G.getGrouping, { contextId }) });
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [kind, setKind] = useState<'apart' | 'together'>('apart');
  const [note, setNote] = useState('');
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const names = new Map(q.data.students.map((s) => [s.id, s.fullName]));
  const items = q.data.students.map((s) => ({ id: s.id, label: s.fullName }));
  const ruleText = (r: PairRule) => t(r.kind === 'apart' ? 'grouping.rule.apartPair' : 'grouping.rule.togetherPair', { a: names.get(r.studentA) ?? '?', b: names.get(r.studentB) ?? '?' });
  return (
    <div className="cc-stack">
      <p className="cc-muted">{t('grouping.rulesIntro')}</p>
      {q.data.rules.length === 0 ? <p className="cc-muted">{t('grouping.noRules')}</p> : null}
      <ul className="cc-stack">
        {q.data.rules.map((r) => (
          <li key={r.id} className="cc-row">
            <span>{ruleText(r)}</span>
            {r.note ? <span className="cc-muted">{r.note}</span> : null}
            <Button className="cc-push-right" onPress={() => void run(() => call(G.removePairRule, { ruleId: r.id }), { success: t('grouping.toast.ruleRemoved'), invalidate: [ALL] })}>
              <IconX />
              {t('grouping.removeRule', { rule: ruleText(r) })}
            </Button>
          </li>
        ))}
      </ul>
      <section className="cc-card cc-stack" aria-labelledby="cc-new-rule">
        <h2 id="cc-new-rule" className="cc-h2">
          {t('grouping.addRule')}
        </h2>
        <div className="cc-row" style={{ alignItems: 'flex-end' }}>
          <Select label={t('grouping.studentA')} items={items} value={a} placeholder={t('grouping.chooseStudent')} onChange={setA} />
          <Select label={t('grouping.ruleKind')} items={[{ id: 'apart', label: t('grouping.rule.apart') }, { id: 'together', label: t('grouping.rule.together') }]} value={kind} onChange={(v) => setKind(v as 'apart' | 'together')} />
          <Select label={t('grouping.studentB')} items={items} value={b} placeholder={t('grouping.chooseStudent')} onChange={setB} />
          <TextField label={t('grouping.ruleNote')} description={t('grouping.ruleNoteHint')} value={note} onChange={setNote} />
          <Button
            variant="primary"
            isDisabled={!a || !b || a === b}
            onPress={() =>
              void run(() => call(G.createPairRule, { contextId, studentA: a, studentB: b, kind, note: note.trim() || null }), { success: t('grouping.toast.ruleAdded'), invalidate: [ALL] }).then((r) => {
                if (r) {
                  setA('');
                  setB('');
                  setNote('');
                }
              })
            }
          >
            <IconPlus />
            {t('grouping.addRule')}
          </Button>
        </div>
      </section>
    </div>
  );
}

export function GroupingPage() {
  const { t, locale } = useI18n();
  const contexts = useQuery({ queryKey: CONTEXTS_KEY, queryFn: () => call(School.myContexts, {}) });
  const list = contexts.data?.contexts ?? [];
  const [picked, setPicked] = useState('');
  const ctx = list.find((c) => c.id === picked) ?? list[0];
  return (
    <main className="cc-page cc-page--wide cc-stack" data-testid="grouping-page">
      <h1 className="cc-h1">{t('teacher.grouping')}</h1>
      {contexts.isSuccess && !ctx ? <EmptyState title={t('classroom.noClasses.title')} /> : null}
      {ctx ? (
        <>
          <Select label={t('teacher.chooseClass')} items={list.map((c) => ({ id: c.id, label: `${c.className} · ${pickText(c.subjectName, locale)}` }))} value={ctx.id} onChange={setPicked} />
          {ctx.modules.grouping === false ? <Alert kind="warning">{t('grouping.moduleOff')}</Alert> : null}
          <Tabs
            key={ctx.id}
            label={t('teacher.grouping')}
            items={[
              { id: 'arrangements', label: t('grouping.tab.arrangements'), content: <ArrangementsTab contextId={ctx.id} /> },
              { id: 'levels', label: t('grouping.tab.levels'), content: <LevelsTab contextId={ctx.id} /> },
              { id: 'rules', label: t('grouping.tab.rules'), content: <RulesTab contextId={ctx.id} /> },
            ]}
          />
        </>
      ) : null}
    </main>
  );
}
