/**
 * Grouping in the teacher area (PIN-gated in classroom mode): GRP-1..8, D-072, D-073.
 * - Arrangements: the five defaults plus the teacher's own; generate again, change type and size,
 *   edit by hand (move a student, rename a group, set roles), save as a new arrangement, archive.
 *   Rules an arrangement breaks are listed with the reason (GRP-8).
 * - Levels: the subject levels used by level-based arrangements (GRP-3). Teacher-only (GRP-7).
 * - Pair rules: should / should not work together, with a private note (GRP-4).
 * S13a (D-098): the four default options with icons, "Use the 4 default options" for older classes,
 * and the same tap-to-move editor as the group screen, plus the levels column (teacher-only).
 * S14c (D-150): the editor moves names with `ui/StudentDnd.tsx` like the classroom group screen (drag
 * onto a group or "Not in a group", tap then "Move here", keyboard); the sticky move bar is gone.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { levelKey, levelOrder } from '../../../domain/grouping.ts';
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
import { IconArchive, IconChevronDown, IconChevronUp, IconList, IconPencil, IconPlus, IconSync, IconUndo, IconX } from '../../ui/icons.tsx';
import { MAX_LEVEL_LIST, UNPLACED } from '../../../shared/contracts/grouping.ts';
import { Tabs } from '../../ui/Tabs.tsx';
import { GroupPicto, OptionPicto } from '../../ui/pictos.tsx';
import { StudentDnd, StudentDropList } from '../../ui/StudentDnd.tsx';
import { StudentName, StudentStatsButton } from '../../ui/StudentName.tsx';
import { LangFields, useEditorLocales } from '../../ui/LangFields.tsx';

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
function TeacherGroups({ tpl, contextId, byId }: { tpl: GroupTemplate; contextId: string; byId: Map<string, Student> }) {
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
                  {s ? <StudentName id={id} name={s.fullName} contextId={contextId} /> : <span>{t('grouping.leftClass')}</span>}
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
  // Group and role names in the class's languages, main language first (S20d, D-172).
  const locales = useEditorLocales([contextId]);
  const [groups, setGroups] = useState<Draft[]>(() => toDraft(tpl, (id) => byId.has(id)));
  const [copyName, setCopyName] = useState('');
  // Tap a name, then "Move here" on a group, or drag it there (the classroom group screen's gestures, S14c).
  const [picked, setPicked] = useState<string | null>(null);
  const leftCount = tpl.groups.flatMap((g) => g.memberIds).filter((id) => !byId.has(id)).length;
  const placed = new Set(groups.flatMap((g) => g.memberIds));
  const unplaced = [...byId.values()].filter((s) => !placed.has(s.id));
  /** Into the group with id `to`, or out of every group with `UNPLACED` (a draft change until Save). */
  const move = useCallback((studentId: string, to: string) => {
    setPicked(null);
    setGroups((gs) => gs.map((g) => ({ ...g, memberIds: g.id === to ? [...g.memberIds.filter((x) => x !== studentId), studentId] : g.memberIds.filter((x) => x !== studentId) })));
  }, []);
  const asStudent = (id: string) => ({ id, name: byId.get(id)?.fullName ?? t('grouping.leftClass') });
  const renderStudent = (s: { id: string; name: string }) => {
    const level = byId.get(s.id)?.level;
    return (
      <span className="cc-group-editor__member">
        <span>{s.name}</span>
        {level ? (
          <span className="cc-chip" data-testid="editor-level">
            {t('grouping.levelChip', { level })}
          </span>
        ) : null}
      </span>
    );
  };
  const patch = (i: number, fn: (g: Draft) => Draft) => setGroups((gs) => gs.map((g, j) => (j === i ? fn(g) : g)));
  const valid = groups.every((g) => g.name.en.trim() || g.name.tr.trim());
  const groupItems = groups.map((g, i) => ({ id: String(i), label: pickText(g.name, locale) || t('grouping.groupN', { n: i + 1 }) }));
  const pickedName = picked ? (byId.get(picked)?.fullName ?? t('grouping.leftClass')) : '';
  return (
    <div className="cc-stack" data-testid="grouping-editor">
      {leftCount ? <Alert kind="warning">{t('grouping.leftRemoved', { count: leftCount })}</Alert> : null}
      <div className="cc-group-screen__hint">
        <p className={picked ? 'cc-group-screen__picked' : 'cc-muted'} role="status" data-testid="editor-move-hint">
          {picked ? t('grouping.tapGroupFor', { name: pickedName }) : t('grouping.editorTapHint')}
        </p>
        {picked ? (
          <Button size="small" variant="ghost" onPress={() => setPicked(null)}>
            <IconX />
            {t('grouping.cancelMove')}
          </Button>
        ) : null}
      </div>
      <StudentDnd picked={picked} onPick={setPicked} onMove={move}>
        <section className="cc-fieldset cc-stack" aria-labelledby="cc-editor-unplaced" data-testid="grouping-unplaced">
          <h3 id="cc-editor-unplaced" className="cc-h3">
            {t('grouping.unplaced')}
          </h3>
          {unplaced.length ? <p className="cc-muted">{t('grouping.unplacedHint')}</p> : null}
          <StudentDropList
            id={UNPLACED}
            name={t('grouping.unplaced')}
            students={unplaced.map((s) => asStudent(s.id))}
            renderStudent={renderStudent}
            emptyText={t('grouping.unplacedEmpty')}
            itemTestId="editor-member"
          />
        </section>
        {/* Side by side like the arrangements (cc-groups), not one long form. */}
        <ul className="cc-groups cc-groups--editor">
          {groups.map((g, i) => (
            <li key={g.id} className="cc-group cc-group-editor">
              <div className="cc-group__head" aria-hidden="true">
                <span className="cc-group__icon">
                  <GroupPicto icon={g.icon} />
                </span>
                <span className="cc-group__name">{groupItems[i]!.label}</span>
                <span className="cc-chip">{t('grouping.memberCount', { count: g.memberIds.length })}</span>
              </div>
              <StudentDropList
                id={g.id}
                name={groupItems[i]!.label}
                label={t('grouping.groupLabel', { name: groupItems[i]!.label, count: g.memberIds.length })}
                students={g.memberIds.map(asStudent)}
                renderStudent={renderStudent}
                itemTestId="editor-member"
              />
              <details className="cc-disclosure">
                <summary>{t('grouping.nameAndRoles')}</summary>
                <div className="cc-stack">
                  <LangFields label={t('grouping.groupName')} value={g.name} onChange={(v) => patch(i, (x) => ({ ...x, name: { en: v.en ?? '', tr: v.tr ?? '' } }))} locales={locales} testId="group-name" />
                  {g.memberIds.map((id) => {
                    const name = byId.get(id)?.fullName ?? t('grouping.leftClass');
                    const role = g.roles[id] ?? { en: '', tr: '' };
                    return (
                      <fieldset key={id} className="cc-fieldset cc-group-editor__role">
                        <legend>{name}</legend>
                        <LangFields label={t('grouping.roleOf', { name })} value={role} onChange={(v) => patch(i, (x) => ({ ...x, roles: { ...x.roles, [id]: { en: v.en ?? '', tr: v.tr ?? '' } } }))} locales={locales} />
                      </fieldset>
                    );
                  })}
                </div>
              </details>
              {!(g.name.en.trim() || g.name.tr.trim()) ? <p className="cc-field__error">{t('grouping.nameNeeded')}</p> : null}
            </li>
          ))}
        </ul>
      </StudentDnd>
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
            void run(() => call(G.createGroupTemplate, { contextId, name: { [locales[0] ?? locale]: copyName.trim() }, mode: 'custom', sizing: tpl.sizing, groups: fromDraft(groups) }), {
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
          <TeacherGroups tpl={tpl} contextId={contextId} byId={byId} />
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
  const locales = useEditorLocales([contextId]);
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
      <LangFields label={t('grouping.arrangementName')} description={t('grouping.nameShownHint')} value={name} onChange={(v) => setName({ en: v.en ?? '', tr: v.tr ?? '' })} locales={locales} testId="arrangement-name" />
      <div className="cc-row" style={{ alignItems: 'flex-end' }}>
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

/** A draft row of the level list editor: a stable key, so moving a row keeps its field and focus. */
type ListRow = { key: number; label: string };
let listRowSeq = 0;
const toRows = (labels: readonly string[]): ListRow[] => labels.map((label) => ({ key: listRowSeq++, label }));

/**
 * The class+subject's ordered level list (S25c, D-187): made from the levels used now (in the order
 * used today) or from scratch, reordered with up / down buttons (keyboard: Tab to a button, Enter),
 * removed again. Teacher-only like the levels (GRP-7).
 */
function LevelListEditor({ contextId, list, used }: { contextId: string; list: readonly string[]; used: ReadonlyArray<string | null> }) {
  const { t } = useI18n();
  const run = useRun();
  const [rows, setRows] = useState<ListRow[] | null>(null);
  const focusAfterMove = useRef<string | null>(null);
  useEffect(() => {
    if (!focusAfterMove.current) return;
    document.getElementById(focusAfterMove.current)?.focus();
    focusAfterMove.current = null;
  });
  const save = (labels: string[], success: string) => void run(() => call(G.setLevelList, { contextId, labels }), { success, invalidate: [ALL] }).then((r) => r && setRows(null));
  if (!rows) {
    const fromUsed = levelOrder(used).others;
    return (
      <section className="cc-card cc-stack" aria-labelledby="cc-level-list" data-testid="level-list">
        <h2 id="cc-level-list" className="cc-h2">
          {t('grouping.levelList.title')}
        </h2>
        <p className="cc-muted">{t('grouping.levelList.intro')}</p>
        {list.length ? (
          <ol data-testid="level-list-saved">
            {list.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ol>
        ) : (
          <p className="cc-muted">{t('grouping.levelList.none')}</p>
        )}
        <div className="cc-row">
          {list.length ? (
            <>
              <Button onPress={() => setRows(toRows(list))}>
                <IconPencil />
                {t('grouping.levelList.edit')}
              </Button>
              <Button onPress={() => save([], t('grouping.levelList.removed'))}>
                <IconX />
                {t('grouping.levelList.remove')}
              </Button>
            </>
          ) : (
            <>
              <Button isDisabled={!fromUsed.length} onPress={() => setRows(toRows(fromUsed.slice(0, MAX_LEVEL_LIST)))}>
                <IconList />
                {t('grouping.levelList.fromUsed')}
              </Button>
              <Button onPress={() => setRows(toRows(['']))}>
                <IconPlus />
                {t('grouping.levelList.startEmpty')}
              </Button>
            </>
          )}
        </div>
        {list.length ? <p className="cc-field__hint">{t('grouping.levelList.removeHint')}</p> : null}
      </section>
    );
  }
  const keys = rows.map((r) => levelKey(r.label));
  const valid = rows.length > 0 && keys.every((k) => k !== '') && new Set(keys).size === keys.length;
  const move = (i: number, by: -1 | 1) => {
    const next = [...rows];
    const [row] = next.splice(i, 1);
    const j = i + by;
    next.splice(j, 0, row!);
    // Keep the focus on the moved level: the same button, or the other one when it reached an end.
    const side = by < 0 ? (j > 0 ? 'up' : 'down') : j < next.length - 1 ? 'down' : 'up';
    focusAfterMove.current = `level-list-${side}-${row!.key}`;
    setRows(next);
  };
  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-level-list" data-testid="level-list">
      <h2 id="cc-level-list" className="cc-h2">
        {t('grouping.levelList.title')}
      </h2>
      <p className="cc-muted">{t('grouping.levelList.lowestFirst')}</p>
      <ol className="cc-stack">
        {rows.map((r, i) => (
          <li key={r.key} className="cc-row" data-testid="level-list-row">
            <TextField label={t('grouping.levelList.item', { n: i + 1 })} value={r.label} maxLength={40} onChange={(v) => setRows(rows.map((x) => (x.key === r.key ? { ...x, label: v } : x)))} />
            <Button size="small" id={`level-list-up-${r.key}`} aria-label={t('grouping.levelList.moveUp', { n: i + 1 })} isDisabled={i === 0} onPress={() => move(i, -1)}>
              <IconChevronUp />
            </Button>
            <Button size="small" id={`level-list-down-${r.key}`} aria-label={t('grouping.levelList.moveDown', { n: i + 1 })} isDisabled={i === rows.length - 1} onPress={() => move(i, 1)}>
              <IconChevronDown />
            </Button>
            <Button size="small" aria-label={t('grouping.levelList.removeItem', { n: i + 1 })} onPress={() => setRows(rows.filter((x) => x.key !== r.key))}>
              <IconX />
            </Button>
          </li>
        ))}
      </ol>
      <div>
        <Button isDisabled={rows.length >= MAX_LEVEL_LIST} onPress={() => setRows([...rows, ...toRows([''])])}>
          <IconPlus />
          {t('grouping.levelList.add')}
        </Button>
      </div>
      {!valid ? <p className="cc-field__hint">{t('grouping.levelList.needNames')}</p> : null}
      <div className="cc-row">
        <Button onPress={() => setRows(null)}>{t('common.cancel')}</Button>
        <Button variant="primary" isDisabled={!valid} onPress={() => save(rows.map((r) => r.label.trim()), t('grouping.levelList.saved'))}>
          {t('grouping.levelList.saveList')}
        </Button>
      </div>
    </section>
  );
}

/** Levels in use that are not in the list (D-187): kept and ranked after it, or changed to a level from the list. */
function NotInList({ contextId, list, students }: { contextId: string; list: readonly string[]; students: readonly Student[] }) {
  const { t } = useI18n();
  const run = useRun();
  const [target, setTarget] = useState<Record<string, string>>({});
  const others = levelOrder(
    students.map((s) => s.level),
    list,
  ).others;
  if (!list.length || !others.length) return null;
  const holders = (level: string) => students.filter((s) => s.level?.trim() && levelKey(s.level) === levelKey(level));
  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-not-in-list" data-testid="levels-not-in-list">
      <h2 id="cc-not-in-list" className="cc-h2">
        {t('grouping.notInList.title')}
      </h2>
      <p className="cc-muted">{t('grouping.notInList.intro')}</p>
      <ul className="cc-stack">
        {others.map((level) => (
          <li key={level} className="cc-row" style={{ alignItems: 'flex-end' }}>
            <span>{t('grouping.notInList.students', { level, count: holders(level).length })}</span>
            <Select
              label={t('grouping.notInList.changeTo', { level })}
              items={[{ id: '', label: t('grouping.notInList.keep') }, ...list.map((l) => ({ id: l, label: l }))]}
              value={target[level] ?? ''}
              onChange={(v) => setTarget({ ...target, [level]: v })}
            />
            <Button
              isDisabled={!target[level]}
              onPress={() =>
                void run(() => call(St.setContextLevels, { contextId, levels: holders(level).map((s) => ({ studentId: s.id, level: target[level]! })) }), { success: t('grouping.notInList.changed'), invalidate: [ALL] }).then(
                  (r) => r && setTarget({ ...target, [level]: '' }),
                )
              }
            >
              {t('grouping.notInList.change', { level })}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LevelsTab({ contextId }: { contextId: string }) {
  const { t } = useI18n();
  const run = useRun();
  const q = useQuery({ queryKey: overviewKey(contextId, false), queryFn: () => call(G.getGrouping, { contextId }) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const list = q.data.levelList;
  const changed = q.data.students.filter((s) => draft[s.id] !== undefined && draft[s.id]!.trim() !== (s.level ?? ''));
  // The order the solver will use for the levels as typed or picked now (GRP-3, D-187), so it is never a surprise.
  const order = levelOrder(
    q.data.students.map((s) => draft[s.id] ?? s.level),
    list,
  );
  // With a list, a level that matches an entry (case and accents ignored) shows as that entry.
  const inList = (level: string) => list.find((l) => levelKey(l) === levelKey(level));
  return (
    <div className="cc-stack">
      <p className="cc-muted">{t('grouping.levelsIntro')}</p>
      {list.length ? null : <p className="cc-muted">{t('grouping.levelsFormat')}</p>}
      {list.length ? (
        <div data-testid="level-order">
          <p>{t('grouping.levelOrderList', { order: order.listed.join(' < ') })}</p>
          {order.others.length ? <p>{t('grouping.levelOrderOthers', { order: order.others.join(' < ') })}</p> : null}
        </div>
      ) : order.others.length ? (
        <p data-testid="level-order">{t('grouping.levelOrder', { order: order.others.join(' < ') })}</p>
      ) : null}
      <LevelListEditor key={list.join('\n')} contextId={contextId} list={list} used={q.data.students.map((s) => s.level)} />
      <NotInList contextId={contextId} list={list} students={q.data.students} />
      <ul className="cc-stack">
        {q.data.students.map((s) => {
          const value = draft[s.id] ?? s.level ?? '';
          const picked = value.trim() ? (inList(value) ?? value) : '';
          return (
            <li key={s.id} className="cc-row">
              {list.length ? (
                <Select
                  label={t('grouping.levelFor', { name: s.fullName })}
                  items={[
                    { id: '', label: t('grouping.noLevel') },
                    ...list.map((l) => ({ id: l, label: l })),
                    ...(picked && !inList(picked) ? [{ id: picked, label: t('grouping.levelNotInList', { level: picked }) }] : []),
                  ]}
                  value={picked}
                  onChange={(v) => setDraft({ ...draft, [s.id]: v })}
                />
              ) : (
                <TextField label={t('grouping.levelFor', { name: s.fullName })} value={value} onChange={(v) => setDraft({ ...draft, [s.id]: v })} />
              )}
              {/* The name is the field's label here, so statistics have their own button (D-154). */}
              <StudentStatsButton id={s.id} name={s.fullName} contextId={contextId} />
            </li>
          );
        })}
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
