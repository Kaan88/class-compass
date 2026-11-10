/**
 * Component catalog (/dev/catalog, signed-in users only; fictional data only). Renders every
 * design-system component in each theme × EN/TR at the chosen text size (THM-2..6, UX-3), plus
 * 20- and 34-student grids for layout checks (ENG-4, CRD-3).
 */
import { useEffect, useState } from 'react';
import { I18nProvider, useI18n } from '../lib/i18n.tsx';
import { setDisplay, useDisplay, type ThemeName } from '../lib/display.ts';
import { ILLUSTRATIONS, MASCOT_POSES } from '../themes/types.ts';
import { THEME_LIST, ThemeScope, useTheme, useThemeName, useThemeSound } from '../themes/index.tsx';
import { celebrate } from '../themes/Celebration.tsx';
import { SOUND_EVENTS } from '../themes/types.ts';
import { showToast, showUndoToast } from '../lib/toast.ts';
import { useMe } from '../lib/session.ts';
import { Button, BigButton, IconButton } from '../ui/Button.tsx';
import { ConfirmDestructive, DialogActions, Modal } from '../ui/Dialog.tsx';
import { InlineConfirmButton } from '../ui/InlineConfirm.tsx';
import { Alert, EmptyState, NeedsAttentionTray, SaveStateBadge } from '../ui/Feedback.tsx';
import { Select, TextArea, TextField, Toggle } from '../ui/Fields.tsx';
import { IconBook, IconLock, IconPlus, IconSettings, IconUndo } from '../ui/icons.tsx';
import { ClassBanner, ClassSwitcher, DataTable, DisplayBanner, PanelHead } from '../ui/Layout.tsx';
import { Mascot, ThemeBackdrop, ThemeDecoration, ThemeIllustration } from '../ui/Mascot.tsx';
import { PinPad } from '../ui/PinPad.tsx';
import { AttendanceChip, Avatar, CounterBar, MetricCell, StudentCard, StudentGrid } from '../ui/Students.tsx';
import { Tabs } from '../ui/Tabs.tsx';
import { StudentDnd, StudentDropList } from '../ui/StudentDnd.tsx';
import { UNPLACED } from '../../shared/contracts/grouping.ts';
import { TEXT_SCALES } from '../routes/teacher/Teacher.tsx';
import { ACHIEVEMENT_TIERS, BADGE_ICONS } from '../../shared/achievements.ts';
import { READY_MADE } from '../../shared/avatars.ts';
import { BadgeArt } from '../achievements/icons.tsx';
import { AvatarArt } from '../avatars/AvatarArt.tsx';
import { levelFor, sampleStudents } from './fixtures.ts';
import { DEFAULT_THEME } from '../../shared/themes.ts';
import { FRAME_CORNERS, FRAME_EDGES, FRAME_SURFACES, FRAME_TRIMS, type FrameCorners, type FrameEdge, type FrameTrim } from '../../shared/themePackage/engine.ts';
import { packageFromDefinition, previewKey, registerThemePackage } from '../themes/custom.tsx';
import { removeCustomTheme, THEMES } from '../themes/registry.ts';
import { ThemeProvider } from '../themes/index.tsx';
import { FrameOverlay } from '../ui/Frame.tsx';

const SUBJECT = { en: 'English', tr: 'İngilizce' };
const SWITCH = [
  { id: 'c1', className: '3-A', subjectName: SUBJECT },
  { id: 'c2', className: '3-B', subjectName: SUBJECT },
  { id: 'c3', className: '4-C', subjectName: { en: 'Science', tr: 'Fen Bilimleri' } },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="cc-stack" style={{ gap: '0.6rem' }}>
      <h3 className="cc-h2" style={{ fontSize: '1.1rem' }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Everything() {
  const { t } = useI18n();
  const [toggle, setToggle] = useState(true);
  const [select, setSelect] = useState('a');
  const [text, setText] = useState('');
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [active, setActive] = useState('c1');
  const [anim, setAnim] = useState(0);
  const sample = sampleStudents(4);
  return (
    <div className="cc-stack">
      <Section title={t('catalog.banner')}>
        <ClassSwitcher contexts={SWITCH} activeId={active} onSwitch={setActive} />
        <ClassBanner className="3-A" subjectName={SUBJECT} dayLabel={t('weekday.1')} dateLabel="9.11.2026" />
        <DisplayBanner onLock={() => undefined} onClassroom={() => undefined} />
        <section className="cc-card cc-stack" aria-labelledby="cc-catalog-panel" style={{ maxWidth: '22rem' }}>
          <PanelHead id="cc-catalog-panel" title={t('homework.title')} icon={<IconBook />}>
            <Button size="small">{t('homework.checkShort')}</Button>
          </PanelHead>
        </section>
      </Section>
      <Section title={t('catalog.buttons')}>
        <div className="cc-row">
          <Button variant="primary">{t('catalog.samplePrimary')}</Button>
          <Button>{t('catalog.sampleSecondary')}</Button>
          <Button variant="danger">{t('common.delete')}</Button>
          <Button variant="ghost">{t('common.cancel')}</Button>
          <Button isDisabled>{t('catalog.disabled')}</Button>
        </div>
        <div className="cc-row">
          <BigButton variant="primary">
            <IconPlus />
            {t('catalog.bigAction')}
          </BigButton>
          <IconButton icon={<IconSettings />} label={t('teacher.classSettings')} />
          <IconButton icon={<IconLock />} label={t('pin.lockNow')} hideLabel />
        </div>
      </Section>
      <Section title={t('catalog.fields')}>
        <div className="cc-row" style={{ alignItems: 'flex-start' }}>
          <TextField label={t('students.name')} value={text} onChange={setText} description={t('catalog.hint')} />
          <TextField label={t('auth.email')} value="" errorMessage={t('catalog.sampleError')} />
          <TextArea label={t('import.pasteLabel')} rows={3} description={t('import.pasteHint')} />
          <Select
            label={t('language.label')}
            value={select}
            onChange={setSelect}
            items={[
              { id: 'a', label: t('language.en') },
              { id: 'b', label: t('language.tr') },
            ]}
          />
        </div>
        <Toggle label={t('classes.sounds')} isSelected={toggle} onChange={setToggle} />
        <Toggle label={t('classes.animations')} isSelected={false} onChange={() => undefined} isDisabled description={t('teacher.moduleOffByAdmin')} />
      </Section>
      <Section title={t('catalog.tabs')}>
        <Tabs
          label={t('catalog.tabs')}
          items={[
            { id: 'one', label: t('module.counters'), content: <p>{t('classroom.slot.counter')}</p> },
            { id: 'two', label: t('module.homework'), content: <p>{t('classroom.slot.lesson')}</p> },
          ]}
        />
      </Section>
      <Section title={t('catalog.feedback')}>
        <div className="cc-row">
          <SaveStateBadge state={{ kind: 'saving' }} />
          <SaveStateBadge state={{ kind: 'saved' }} />
          <SaveStateBadge state={{ kind: 'offline', count: 3 }} />
          <SaveStateBadge state={{ kind: 'error', count: 1 }} />
        </div>
        <div className="cc-row">
          <Button onPress={() => showUndoToast(t('catalog.undoMessage'), () => void showToast({ message: t('catalog.undone') }))}>
            <IconUndo />
            {t('catalog.showUndo')}
          </Button>
          <Button onPress={() => setModal(true)}>{t('catalog.openDialog')}</Button>
          <Button variant="danger" onPress={() => setConfirm(true)}>
            {t('catalog.openConfirm')}
          </Button>
        </div>
        {/* S14d (D-151): the in-page confirmation used on the student page. */}
        <InlineConfirmButton message={t('student.confirm.delete')} confirmLabel={t('student.confirm.yes')} cancelLabel={t('student.confirm.no')} onConfirm={() => undefined}>
          {t('student.delete')}
        </InlineConfirmButton>
        <Alert kind="warning">{t('catalog.sampleWarning')}</Alert>
        <NeedsAttentionTray items={[{ id: 'x', title: t('catalog.sampleAction'), detail: t('error.CLASS_ARCHIVED') }]} onRetry={() => undefined} onDismiss={() => undefined} />
        <Modal isOpen={modal} onOpenChange={setModal} title={t('catalog.openDialog')}>
          <p>{t('catalog.hint')}</p>
          <DialogActions>
            <Button variant="primary" onPress={() => setModal(false)}>
              {t('common.close')}
            </Button>
          </DialogActions>
        </Modal>
        <ConfirmDestructive
          isOpen={confirm}
          onOpenChange={setConfirm}
          title={t('students.deactivateTitle')}
          description={t('students.deactivateExplain')}
          confirmText="3-A"
          actionLabel={t('users.deactivate')}
          onConfirm={() => undefined}
        />
      </Section>
      <Section title={t('catalog.badgesAvatars')}>
        {/* S13c review: every badge glyph (tiers in turn, some locked) and every ready-made avatar, in each theme, so the axe pass covers them. */}
        <div className="cc-row" style={{ flexWrap: 'wrap' }} data-testid="catalog-badges">
          {BADGE_ICONS.map((icon, i) => (
            <BadgeArt key={icon} icon={icon} tier={ACHIEVEMENT_TIERS[i % ACHIEVEMENT_TIERS.length]!} size={32} locked={i % 7 === 6} />
          ))}
        </div>
        <div className="cc-row" style={{ flexWrap: 'wrap' }} data-testid="catalog-avatars">
          {READY_MADE.map((spec, i) => (
            <AvatarArt key={i} spec={spec} size={40} title={t('catalog.avatarN', { n: i + 1 })} />
          ))}
        </div>
      </Section>
      <Section title={t('catalog.students')}>
        <div className="cc-row">
          {sample.map((s) => (
            <Avatar key={s.id} name={s.fullName} id={s.id} />
          ))}
          <Avatar name="Ada Yıldız" id="x" size="lg" />
        </div>
        <StudentGrid count={4} label={t('catalog.students')}>
          {/* S14e2: on the classroom board the name is a button that opens the positive-only card. */}
          <StudentCard student={sample[0]!} weeklyCount={0} level={0} onAdd={() => undefined} onOpen={() => undefined} />
          <StudentCard student={sample[1]!} weeklyCount={3} level={1} onAdd={() => undefined} />
          <StudentCard student={sample[2]!} weeklyCount={4} level={2} onAdd={() => undefined} />
          <StudentCard student={sample[4] ?? sample[2]!} weeklyCount={7} level={3} onAdd={() => undefined} />
          <StudentCard student={sample[3]!} weeklyCount={0} level={0} absent onAdd={() => undefined} />
        </StudentGrid>
        <div className="cc-row">
          <AttendanceChip status="present" />
          <AttendanceChip status="absent" />
          <AttendanceChip status="late" />
          <AttendanceChip status="excused" />
          <AttendanceChip status="not_recorded" />
          <AttendanceChip status="late" lessonOnly />
        </div>
      </Section>
      <Section title={t('catalog.studentDnd')}>
        <DndDemo />
      </Section>
      <Section title={t('catalog.counters')}>
        <CounterBar value={3} max={10} label={t('catalog.sampleCounter')} />
        <CounterBar value={10} max={10} label={t('catalog.sampleCounter')} />
        <CounterBar value={12} max={10} label={t('catalog.sampleCounter')} />
        <div className="cc-row">
          <MetricCell value={null} />
          <MetricCell value={0} />
          <MetricCell value={7} denominator={20} />
        </div>
        <DataTable
          caption={t('catalog.table')}
          rows={sample}
          rowKey={(s) => s.id}
          emptyText={t('students.none')}
          columns={[
            { key: 'n', header: t('students.name'), sortValue: (s) => s.fullName, render: (s) => s.fullName },
            { key: 'c', header: t('card.thisWeek'), sortValue: (s) => s.weeklyCount, render: (s) => <MetricCell value={s.absent ? null : s.weeklyCount} /> },
          ]}
        />
      </Section>
      <Section title={t('catalog.mascot')}>
        <ThemeSlots anim={anim} />
        <div className="cc-row">
          <Button onPress={() => setAnim((a) => a + 1)}>{t('catalog.playAnimation')}</Button>
          <SoundButtons />
        </div>
        <EmptyState title={t('classroom.noClasses.title')} body={t('classroom.noClasses.body')} />
      </Section>
      <Section title={t('catalog.pinpad')}>
        <PinPad onSubmit={() => undefined} error={t('pin.wrong')} autoFocus={false} />
      </Section>
    </div>
  );
}

export function CatalogPage() {
  const me = useMe();
  const { t } = useI18n();
  const display = useDisplay();
  const [themes, setThemes] = useState<'all' | ThemeName>('all');
  const [scale, setScale] = useState(String(me?.textScale ?? 100));
  useEffect(() => {
    setDisplay({ textScale: Number(scale) });
  }, [scale]);
  useEffect(() => () => setDisplay({ textScale: me?.textScale ?? 100 }), [me?.textScale]);
  const shown = themes === 'all' ? THEME_LIST.map((d) => d.key) : [themes];
  const grid20 = sampleStudents(20);
  const grid34 = sampleStudents(34);
  return (
    <main className="cc-page cc-stack" style={{ maxWidth: 'none' }} data-testid="catalog">
      <h1 className="cc-h1">{t('catalog.title')}</h1>
      <p className="cc-muted">{t('catalog.intro')}</p>
      <div className="cc-row">
        <Select
          label={t('catalog.theme')}
          value={themes}
          onChange={(v) => setThemes(v === 'all' ? 'all' : (v as ThemeName))}
          items={[{ id: 'all', label: t('catalog.allThemes') }, ...THEME_LIST.map((d) => ({ id: d.key, label: t(d.labelKey) }))]}
        />
        <Select label={t('profile.textSize')} value={scale} onChange={setScale} items={TEXT_SCALES.map((s) => ({ id: String(s), label: `${s}%` }))} />
        <Toggle label={t('classes.animations')} isSelected={display.classAnimations} onChange={(v) => setDisplay({ classAnimations: v })} />
      </div>
      {shown.map((th) =>
        (['en', 'tr'] as const).map((loc) => (
          <I18nProvider key={`${th}-${loc}`} locale={loc}>
            <ThemeScope.Provider value={th}>
              <PanelTitle theme={th} />
              <div className="cc-catalog-panel" data-theme={th} data-testid={`catalog-${th}-${loc}`} lang={loc}>
                <ThemeBackdrop />
                <ThemeDecoration size={200} />
                <Everything />
              </div>
            </ThemeScope.Provider>
          </I18nProvider>
        )),
      )}
      <h2 className="cc-h2">{t('catalog.grid', { count: 20 })}</h2>
      <div className="cc-catalog-panel" data-theme={shown[0]} data-testid="catalog-grid-20">
        <StudentGrid count={20} label={t('catalog.grid', { count: 20 })}>
          {grid20.map((s) => (
            <StudentCard key={s.id} student={s} weeklyCount={s.weeklyCount} level={levelFor(s.weeklyCount)} absent={s.absent} onAdd={() => undefined} />
          ))}
        </StudentGrid>
      </div>
      <h2 className="cc-h2">{t('catalog.grid', { count: 34 })}</h2>
      <div className="cc-catalog-panel" data-theme={shown[0]} data-testid="catalog-grid-34">
        <StudentGrid count={34} label={t('catalog.grid', { count: 34 })}>
          {grid34.map((s) => (
            <StudentCard key={s.id} student={s} weeklyCount={s.weeklyCount} level={levelFor(s.weeklyCount)} absent={s.absent} onAdd={() => undefined} />
          ))}
        </StudentGrid>
      </div>
      <FramesDemo />
    </main>
  );
}

const FRAMES_KEY = previewKey('catalog-frames');

/**
 * Theme frames (S17a, D-166): every edge, trim and corner preset on a board box and student cards, on
 * a preview copy of the default theme (built-in themes have no frame yet). Fictional data only.
 */
function FramesDemo() {
  const { t } = useI18n();
  const [edge, setEdge] = useState<FrameEdge>('snowDrift');
  const [trim, setTrim] = useState<FrameTrim>('candyStripe');
  const [corners, setCorners] = useState<FrameCorners>('frost');
  const def = useTheme(FRAMES_KEY);
  useEffect(() => {
    const base = packageFromDefinition(THEMES[DEFAULT_THEME], { key: 'catalog-frames', copyOf: (_l, name) => name });
    registerThemePackage({ ...base, frame: { edge, trim, corners, apply: [...FRAME_SURFACES] } }, 'preview', FRAMES_KEY);
  }, [edge, trim, corners]);
  useEffect(() => () => removeCustomTheme(FRAMES_KEY), []);
  const sample = sampleStudents(3);
  return (
    <section className="cc-stack" aria-labelledby="cc-catalog-frames">
      <h2 className="cc-h2" id="cc-catalog-frames">
        {t('catalog.frames')}
      </h2>
      <div className="cc-row">
        <Select label={t('themes.engine.frame.edge')} value={edge} onChange={(v) => setEdge(v as FrameEdge)} items={FRAME_EDGES.map((e) => ({ id: e, label: t(`themes.engine.edge.${e}`) }))} />
        <Select label={t('themes.engine.frame.trim')} value={trim} onChange={(v) => setTrim(v as FrameTrim)} items={FRAME_TRIMS.map((e) => ({ id: e, label: t(`themes.engine.trim.${e}`) }))} />
        <Select label={t('themes.engine.frame.corners')} value={corners} onChange={(v) => setCorners(v as FrameCorners)} items={FRAME_CORNERS.map((e) => ({ id: e, label: t(`themes.engine.corners.${e}`) }))} />
      </div>
      {def.key === FRAMES_KEY ? (
        <ThemeProvider theme={FRAMES_KEY} className="cc-catalog-panel cc-stack" testId="catalog-frames">
          <div className="cc-lesson-box cc-theme-sample__box" data-box="routine">
            <FrameOverlay surface="boardBoxes" boxKey="routine" />
            <div className="cc-card cc-stack cc-theme-sample__card">
              <strong>{t('themes.preview.sampleRoutine')}</strong>
              <CounterBar value={3} max={10} label={t('catalog.sampleCounter')} />
            </div>
          </div>
          <StudentGrid count={sample.length} label={t('catalog.frames')}>
            {sample.map((s) => (
              <StudentCard key={s.id} student={s} weeklyCount={s.weeklyCount} level={levelFor(s.weeklyCount)} onAdd={() => undefined} />
            ))}
          </StudentGrid>
        </ThemeProvider>
      ) : null}
    </section>
  );
}

/** Every slot of the active theme: mascot poses and illustrations (THM-2), with the one-shot motions. */
/** S14c (D-150): two groups and "Not in a group" with fictional names; drag, tap or keyboard. */
function DndDemo() {
  const { t } = useI18n();
  const sample = sampleStudents(5);
  const [lists, setLists] = useState<Record<string, string[]>>(() => ({ g1: [sample[0]!.id, sample[1]!.id], g2: [sample[2]!.id, sample[3]!.id], [UNPLACED]: [sample[4]!.id] }));
  const [picked, setPicked] = useState<string | null>(null);
  const name = (id: string) => sample.find((s) => s.id === id)?.fullName ?? id;
  const onMove = (studentId: string, to: string) => {
    setPicked(null);
    setLists((ls) => Object.fromEntries(Object.entries(ls).map(([k, v]) => [k, k === to ? [...v.filter((x) => x !== studentId), studentId] : v.filter((x) => x !== studentId)])));
  };
  const title = (id: string, i: number) => (id === UNPLACED ? t('grouping.unplaced') : t('grouping.groupN', { n: i + 1 }));
  return (
    <StudentDnd picked={picked} onPick={setPicked} onMove={onMove}>
      <div className="cc-groups cc-groups--editor" data-testid="catalog-dnd">
        {Object.keys(lists).map((id, i) => (
          <div key={id} className="cc-group">
            <h4 className="cc-group__name">{title(id, i)}</h4>
            <StudentDropList
              id={id}
              name={title(id, i)}
              students={lists[id]!.map((s) => ({ id: s, name: name(s) }))}
              renderStudent={(s) => (
                <span className="cc-group-member">
                  <Avatar name={s.name} id={s.id} size="sm" />
                  <span className="cc-group-member__name">{s.name}</span>
                </span>
              )}
            />
          </div>
        ))}
      </div>
    </StudentDnd>
  );
}

function ThemeSlots({ anim }: { anim: number }) {
  const { t } = useI18n();
  const def = useTheme();
  return (
    <div className="cc-stack" data-testid={`theme-slots-${def.key}`}>
      <p className="cc-muted" style={{ margin: 0 }}>
        {t(def.descriptionKey)} · {t(def.mascotNameKey)}
      </p>
      <div className="cc-row">
        {MASCOT_POSES.map((pose) => (
          <figure key={pose} className="cc-catalog-figure">
            <Mascot key={`${pose}-${anim}`} size={84} pose={pose} motion={anim > 0 && pose === 'celebrate' ? 'celebrate' : undefined} />
            <figcaption>{t(`catalog.pose.${pose}`)}</figcaption>
          </figure>
        ))}
      </div>
      <div className="cc-row">
        {ILLUSTRATIONS.map((name) => (
          <figure key={name} className="cc-catalog-figure">
            <ThemeIllustration
              key={`${name}-${anim}`}
              name={name}
              width={170}
              motion={anim > 0 ? (name === 'threshold' ? 'threshold' : name === 'celebration' ? 'celebrate' : undefined) : undefined}
            />
            <figcaption>{t(`catalog.illustration.${name}`)}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

/** Plays the theme sounds; silent when the class or device has sounds off (THM-5). */
function SoundButtons() {
  const { t } = useI18n();
  const play = useThemeSound();
  return (
    <>
      {SOUND_EVENTS.map((e) => (
        <Button key={e} onPress={() => play(e)}>
          {t(`sound.${e}`)}
        </Button>
      ))}
      <Button variant="primary" onPress={() => celebrate()}>
        {t('catalog.celebrate')}
      </Button>
    </>
  );
}

function PanelTitle({ theme }: { theme: ThemeName }) {
  const { t, locale } = useI18n();
  return (
    <h2 className="cc-h2">
      {useThemeName(theme)} · {locale === 'tr' ? t('language.tr') : t('language.en')}
    </h2>
  );
}
