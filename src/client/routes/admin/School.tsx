/**
 * School structure administration (ACC-2, ACC-12, DAT-1, THM-3, D-014, D-026): settings, years &
 * terms, subjects, classes (theme with live preview, timezone, sounds/animations, promotion),
 * teaching assignments, module & media policies.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import type { z } from 'zod';
import * as AdminC from '../../../shared/contracts/admin.ts';
import * as G from '../../../shared/contracts/goals.ts';
import * as S from '../../../shared/contracts/school.ts';
import * as St from '../../../shared/contracts/students.ts';
import { pickText } from '../../../shared/i18n/index.ts';
import { compareNames } from '../../../shared/text/turkish.ts';
import { call } from '../../lib/api.ts';
import type { ThemeKey as ThemeName } from '../../../shared/themes.ts';
import { DEFAULT_THEME } from '../../../shared/themes.ts';
import { errorText } from '../../lib/errors.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { showToast } from '../../lib/toast.ts';
import { useRun } from '../../lib/useRun.ts';
import { Button, buttonClass } from '../../ui/Button.tsx';
import { ConfirmDestructive, DialogActions, Modal } from '../../ui/Dialog.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select, TextField, Toggle } from '../../ui/Fields.tsx';
import { IconArchive, IconCheck } from '../../ui/icons.tsx';
import { DataTable } from '../../ui/Layout.tsx';
import { ClassLanguageSelect, StudentPageLanguageSelect, studentPageOverride } from '../../ui/ClassLanguageSelect.tsx';
import type { ClassLanguage } from '../../../shared/classLanguage.ts';
import { ThemePicker, ThemePreview, themeLabelKey } from '../../ui/ThemePreview.tsx';
import { moduleLabelKey } from '../teacher/Classes.tsx';
import { ADMIN } from './Admin.tsx';

const K = {
  settings: [...ADMIN, 'settings'],
  years: [...ADMIN, 'years'],
  subjects: [...ADMIN, 'subjects'],
  classes: [...ADMIN, 'classes'],
  contexts: [...ADMIN, 'contexts'],
  policies: [...ADMIN, 'policies'],
  users: [...ADMIN, 'users'],
  goalDefaults: [...ADMIN, 'goal-defaults'],
};

type Year = z.infer<typeof S.SchoolYear>;
type Subject = z.infer<typeof S.Subject>;
type SchoolClass = z.infer<typeof S.SchoolClass>;

const ArchivedChip = () => {
  const { t } = useI18n();
  return (
    <span className="cc-chip cc-chip--warning">
      <IconArchive />
      {t('common.archived')}
    </span>
  );
};

// ---------------------------------------------------------------- settings
const WEEKDAYS = ['weekday.0', 'weekday.1', 'weekday.2', 'weekday.3', 'weekday.4', 'weekday.5', 'weekday.6'] as const;

export function SettingsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: K.settings, queryFn: () => call(S.getSettings, {}) });
  const [draft, setDraft] = useState<Partial<z.infer<typeof S.SchoolSettings>>>({});
  const [error, setError] = useState<string | null>(null);
  const [latText, setLatText] = useState<string | null>(null);
  const [lonText, setLonText] = useState<string | null>(null);
  if (!settings.data) return <main className="cc-page">{t('common.loading')}</main>;
  const v = { ...settings.data, ...draft };
  const latValue = latText ?? String(v.weatherLatitude);
  const lonValue = lonText ?? String(v.weatherLongitude);
  return (
    <main className="cc-page cc-stack">
      <h1 className="cc-h1">{t('admin.settings')}</h1>
      <form
        className="cc-card cc-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const lat = Number(latValue.replace(',', '.'));
            const lon = Number(lonValue.replace(',', '.'));
            if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) return setError(t('settings.weatherBadCoords'));
            await call(S.updateSettings, {
              schoolName: v.schoolName,
              timezone: v.timezone,
              weekStartsOn: v.weekStartsOn,
              defaultLocale: v.defaultLocale,
              weatherEnabled: v.weatherEnabled,
              weatherLabel: v.weatherLabel,
              weatherLatitude: lat,
              weatherLongitude: lon,
            });
            setDraft({});
            setLatText(null);
            setLonText(null);
            void qc.invalidateQueries({ queryKey: K.settings });
            showToast({ message: t('save.saved'), kind: 'success' });
          } catch (err) {
            setError(errorText(t, err));
          }
        }}
      >
        <TextField label={t('settings.schoolName')} value={v.schoolName} onChange={(x) => setDraft((d) => ({ ...d, schoolName: x }))} isRequired />
        <TextField label={t('settings.timezone')} description={t('settings.timezoneHint')} value={v.timezone} onChange={(x) => setDraft((d) => ({ ...d, timezone: x }))} isRequired />
        <Select
          label={t('settings.weekStartsOn')}
          value={String(v.weekStartsOn)}
          onChange={(x) => setDraft((d) => ({ ...d, weekStartsOn: Number(x) }))}
          items={WEEKDAYS.map((k, i) => ({ id: String(i), label: t(k) }))}
        />
        <Select
          label={t('settings.defaultLocale')}
          description={t('settings.defaultLocaleHint')}
          value={v.defaultLocale}
          onChange={(x) => setDraft((d) => ({ ...d, defaultLocale: x === 'tr' ? 'tr' : 'en' }))}
          items={[
            { id: 'en', label: t('language.en') },
            { id: 'tr', label: t('language.tr') },
          ]}
        />
        <fieldset className="cc-stack cc-fieldset" data-testid="weather-settings">
          <legend className="cc-h3">{t('settings.weather')}</legend>
          <p className="cc-muted">{t('settings.weatherHint')}</p>
          <Toggle label={t('settings.weatherShow')} isSelected={v.weatherEnabled} onChange={(x) => setDraft((d) => ({ ...d, weatherEnabled: x }))} />
          <TextField label={t('settings.weatherPlace')} value={v.weatherLabel} onChange={(x) => setDraft((d) => ({ ...d, weatherLabel: x }))} isRequired />
          <div className="cc-row" style={{ alignItems: 'flex-start' }}>
            <TextField label={t('settings.weatherLatitude')} inputMode="decimal" value={latValue} onChange={setLatText} isRequired />
            <TextField label={t('settings.weatherLongitude')} inputMode="decimal" value={lonValue} onChange={setLonText} isRequired />
          </div>
        </fieldset>
        <p>
          <span className={`cc-chip ${v.emailResetEnabled ? 'cc-chip--success' : ''}`}>
            {v.emailResetEnabled ? t('settings.emailResetOn') : t('settings.emailResetOff')}
          </span>
        </p>
        {error ? <Alert>{error}</Alert> : null}
        <div>
          <Button type="submit" variant="primary">
            {t('common.save')}
          </Button>
        </div>
      </form>
    </main>
  );
}

// ---------------------------------------------------------------- years & terms
function YearForm({ year, onDone }: { year?: Year; onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState(year?.name ?? '');
  const [startsOn, setStartsOn] = useState(year?.startsOn ?? '');
  const [endsOn, setEndsOn] = useState(year?.endsOn ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="cc-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          if (year) await call(S.updateYear, { yearId: year.id, name, startsOn, endsOn });
          else await call(S.createYear, { name, startsOn, endsOn });
          void qc.invalidateQueries({ queryKey: K.years });
          onDone();
        } catch (err) {
          setError(errorText(t, err));
        }
      }}
    >
      <TextField label={t('years.name')} value={name} onChange={setName} isRequired placeholder="2026–2027" />
      <div className="cc-row">
        <TextField label={t('common.startDate')} type="date" value={startsOn} onChange={setStartsOn} isRequired />
        <TextField label={t('common.endDate')} type="date" value={endsOn} onChange={setEndsOn} isRequired />
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <DialogActions>
        <Button onPress={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary">
          {t('common.save')}
        </Button>
      </DialogActions>
    </form>
  );
}

function TermForm({ year, onDone }: { year: Year; onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [en, setEn] = useState('');
  const [tr, setTr] = useState('');
  const [startsOn, setStartsOn] = useState(year.startsOn);
  const [endsOn, setEndsOn] = useState(year.endsOn);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="cc-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await call(S.createTerm, { yearId: year.id, name: { en: en || undefined, tr: tr || undefined }, startsOn, endsOn });
          void qc.invalidateQueries({ queryKey: K.years });
          onDone();
        } catch (err) {
          setError(errorText(t, err));
        }
      }}
    >
      <div className="cc-row">
        <TextField label={t('common.nameEn')} value={en} onChange={setEn} />
        <TextField label={t('common.nameTr')} value={tr} onChange={setTr} />
      </div>
      <div className="cc-row">
        <TextField label={t('common.startDate')} type="date" value={startsOn} onChange={setStartsOn} isRequired />
        <TextField label={t('common.endDate')} type="date" value={endsOn} onChange={setEndsOn} isRequired />
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <DialogActions>
        <Button onPress={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary">
          {t('years.addTerm')}
        </Button>
      </DialogActions>
    </form>
  );
}

export function YearsPage() {
  const { t, locale } = useI18n();
  const run = useRun();
  const years = useQuery({ queryKey: K.years, queryFn: () => call(S.listYears, {}) });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Year | null>(null);
  const [addingTerm, setAddingTerm] = useState<Year | null>(null);
  const [archiving, setArchiving] = useState<Year | null>(null);
  const [deletingTerm, setDeletingTerm] = useState<{ id: string; name: string } | null>(null);
  return (
    <main className="cc-page cc-stack">
      <div className="cc-row">
        <h1 className="cc-h1" style={{ marginRight: 'auto' }}>
          {t('admin.years')}
        </h1>
        <Button variant="primary" onPress={() => setCreating(true)}>
          {t('years.create')}
        </Button>
      </div>
      <p className="cc-muted">{t('years.archiveHint')}</p>
      {(years.data?.years ?? []).map((y) => (
        <section key={y.id} className="cc-card cc-stack" aria-label={y.name}>
          <div className="cc-row">
            <h2 className="cc-h2" style={{ marginRight: 'auto' }}>
              {y.name} <span className="cc-muted">({y.startsOn} – {y.endsOn})</span>
            </h2>
            {y.archived ? <ArchivedChip /> : null}
            {y.archived ? (
              <Button size="small" onPress={() => void run(() => call(S.unarchiveYear, { yearId: y.id }), { invalidate: [K.years, K.classes] })}>
                {t('common.unarchive')}
              </Button>
            ) : (
              <>
                <Button size="small" onPress={() => setEditing(y)}>
                  {t('common.edit')}
                </Button>
                <Button size="small" onPress={() => setAddingTerm(y)}>
                  {t('years.addTerm')}
                </Button>
                <Button size="small" variant="danger" onPress={() => setArchiving(y)}>
                  {t('common.archive')}
                </Button>
              </>
            )}
          </div>
          <DataTable
            caption={t('years.terms')}
            rows={y.terms}
            rowKey={(term) => term.id}
            emptyText={t('years.noTerms')}
            columns={[
              { key: 'name', header: t('common.name'), render: (term) => pickText(term.name, locale) },
              { key: 'dates', header: t('common.dates'), render: (term) => `${term.startsOn} – ${term.endsOn}` },
              {
                key: 'actions',
                header: t('common.actions'),
                render: (term) =>
                  y.archived ? null : (
                    <Button size="small" onPress={() => setDeletingTerm({ id: term.id, name: pickText(term.name, locale) })}>
                      {t('common.delete')}
                    </Button>
                  ),
              },
            ]}
          />
        </section>
      ))}
      <Modal isOpen={creating} onOpenChange={setCreating} title={t('years.create')}>
        <YearForm onDone={() => setCreating(false)} />
      </Modal>
      <Modal isOpen={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={t('years.edit')}>
        {editing ? <YearForm year={editing} onDone={() => setEditing(null)} /> : null}
      </Modal>
      <Modal isOpen={addingTerm !== null} onOpenChange={(o) => !o && setAddingTerm(null)} title={t('years.addTerm')}>
        {addingTerm ? <TermForm year={addingTerm} onDone={() => setAddingTerm(null)} /> : null}
      </Modal>
      <ConfirmDestructive
        isOpen={archiving !== null}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={t('years.archiveTitle')}
        description={t('years.archiveExplain')}
        confirmText={archiving?.name ?? ''}
        actionLabel={t('common.archive')}
        onConfirm={() => run(() => call(S.archiveYear, { yearId: archiving!.id }), { invalidate: [K.years, K.classes], success: t('years.archived') })}
      />
      <ConfirmDestructive
        isOpen={deletingTerm !== null}
        onOpenChange={(o) => !o && setDeletingTerm(null)}
        title={t('years.deleteTerm')}
        description={t('years.deleteTermExplain')}
        confirmText={deletingTerm?.name ?? ''}
        actionLabel={t('common.delete')}
        onConfirm={() => run(() => call(S.deleteTerm, { termId: deletingTerm!.id }), { invalidate: [K.years] })}
      />
    </main>
  );
}

// ---------------------------------------------------------------- subjects
function SubjectForm({ subject, onDone }: { subject?: Subject; onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [en, setEn] = useState(subject?.name.en ?? '');
  const [tr, setTr] = useState(subject?.name.tr ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="cc-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const name = { en: en.trim() || undefined, tr: tr.trim() || undefined };
        try {
          if (subject) await call(S.updateSubject, { subjectId: subject.id, name });
          else await call(S.createSubject, { name });
          void qc.invalidateQueries({ queryKey: K.subjects });
          onDone();
        } catch (err) {
          setError(errorText(t, err));
        }
      }}
    >
      <TextField label={t('common.nameEn')} value={en} onChange={setEn} autoFocus />
      <TextField label={t('common.nameTr')} value={tr} onChange={setTr} />
      <p className="cc-muted">{t('subjects.nameHint')}</p>
      {error ? <Alert>{error}</Alert> : null}
      <DialogActions>
        <Button onPress={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary">
          {t('common.save')}
        </Button>
      </DialogActions>
    </form>
  );
}

export function SubjectsPage() {
  const { t, locale } = useI18n();
  const run = useRun();
  const subjects = useQuery({ queryKey: [...K.subjects, 'all'], queryFn: () => call(S.listSubjects, { includeArchived: true }) });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Subject | null>(null);
  const [archiving, setArchiving] = useState<Subject | null>(null);
  return (
    <main className="cc-page cc-stack">
      <div className="cc-row">
        <h1 className="cc-h1" style={{ marginRight: 'auto' }}>
          {t('admin.subjects')}
        </h1>
        <Button variant="primary" onPress={() => setCreating(true)}>
          {t('subjects.create')}
        </Button>
      </div>
      <DataTable
        caption={t('admin.subjects')}
        rows={subjects.data?.subjects ?? []}
        rowKey={(s) => s.id}
        emptyText={t('subjects.none')}
        columns={[
          { key: 'en', header: t('common.nameEn'), sortValue: (s) => s.name.en ?? '', render: (s) => s.name.en ?? '—' },
          { key: 'tr', header: t('common.nameTr'), sortValue: (s) => s.name.tr ?? '', render: (s) => s.name.tr ?? '—' },
          { key: 'state', header: t('users.status'), render: (s) => (s.archived ? <ArchivedChip /> : <span className="cc-chip cc-chip--success">{t('users.active')}</span>) },
          {
            key: 'actions',
            header: t('common.actions'),
            render: (s) => (
              <div className="cc-row" style={{ gap: '0.4rem' }}>
                <Button size="small" onPress={() => setEditing(s)}>
                  {t('common.rename')}
                </Button>
                {s.archived ? (
                  <Button size="small" onPress={() => void run(() => call(S.unarchiveSubject, { subjectId: s.id }), { invalidate: [K.subjects] })}>
                    {t('common.unarchive')}
                  </Button>
                ) : (
                  <Button size="small" variant="danger" onPress={() => setArchiving(s)}>
                    {t('common.archive')}
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      <Modal isOpen={creating} onOpenChange={setCreating} title={t('subjects.create')}>
        <SubjectForm onDone={() => setCreating(false)} />
      </Modal>
      <Modal isOpen={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={t('common.rename')}>
        {editing ? <SubjectForm subject={editing} onDone={() => setEditing(null)} /> : null}
      </Modal>
      <ConfirmDestructive
        isOpen={archiving !== null}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={t('subjects.archiveTitle')}
        description={t('subjects.archiveExplain')}
        confirmText={archiving ? pickText(archiving.name, locale) : ''}
        actionLabel={t('common.archive')}
        onConfirm={() => run(() => call(S.archiveSubject, { subjectId: archiving!.id }), { invalidate: [K.subjects] })}
      />
    </main>
  );
}

// ---------------------------------------------------------------- classes
interface ClassDraft {
  name: string;
  grade: string;
  theme: ThemeName;
  timezone: string;
  soundsEnabled: boolean;
  animationsEnabled: boolean;
  mainLanguage: 'en' | 'tr';
  secondLanguageEnabled: boolean;
  studentPage: ClassLanguage | null;
}

function ClassForm({ cls, years, onDone }: { cls?: SchoolClass; years: Year[]; onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const writableYears = years.filter((y) => !y.archived);
  const [yearId, setYearId] = useState(cls?.schoolYearId ?? writableYears[0]?.id ?? '');
  const [d, setD] = useState<ClassDraft>({
    name: cls?.name ?? '',
    grade: cls?.grade === null || cls?.grade === undefined ? '' : String(cls.grade),
    theme: cls?.theme ?? DEFAULT_THEME,
    timezone: cls?.timezone ?? '',
    soundsEnabled: cls?.soundsEnabled ?? true,
    animationsEnabled: cls?.animationsEnabled ?? true,
    mainLanguage: cls?.mainLanguage ?? 'en',
    secondLanguageEnabled: cls?.secondLanguageEnabled ?? false,
    studentPage: cls ? studentPageOverride(cls) : null,
  });
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<ClassDraft>) => setD((x) => ({ ...x, ...p }));
  return (
    <form
      className="cc-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const grade = d.grade.trim() === '' ? null : Number(d.grade);
        const body = {
          name: d.name,
          grade,
          theme: d.theme,
          timezone: d.timezone.trim() || null,
          soundsEnabled: d.soundsEnabled,
          animationsEnabled: d.animationsEnabled,
          mainLanguage: d.mainLanguage,
          secondLanguageEnabled: d.secondLanguageEnabled,
          studentPage: d.studentPage,
        };
        try {
          if (cls) await call(S.updateClass, { classId: cls.id, ...body });
          else await call(S.createClass, { schoolYearId: yearId, ...body });
          void qc.invalidateQueries({ queryKey: K.classes });
          showToast({ message: t('save.saved'), kind: 'success' });
          onDone();
        } catch (err) {
          setError(errorText(t, err));
        }
      }}
    >
      {cls ? null : <Select label={t('classes.year')} value={yearId} onChange={setYearId} items={writableYears.map((y) => ({ id: y.id, label: y.name }))} />}
      <div className="cc-row">
        <TextField label={t('classes.name')} value={d.name} onChange={(v) => set({ name: v })} isRequired placeholder="3-A" />
        <TextField label={t('classes.grade')} value={d.grade} onChange={(v) => set({ grade: v.replace(/\D/g, '') })} inputMode="numeric" />
      </div>
      <ThemePicker label={t('classes.theme')} value={d.theme} onChange={(v) => set({ theme: v })} />
      <ThemePreview theme={d.theme} />
      <TextField label={t('classes.timezone')} description={t('classes.timezoneHint')} value={d.timezone} onChange={(v) => set({ timezone: v })} placeholder="Europe/Istanbul" />
      <ClassLanguageSelect value={d} onChange={(v) => set(v)} />
      <StudentPageLanguageSelect value={d.studentPage} onChange={(v) => set({ studentPage: v })} />
      <Toggle label={t('classes.sounds')} isSelected={d.soundsEnabled} onChange={(v) => set({ soundsEnabled: v })} />
      <Toggle label={t('classes.animations')} description={t('classes.animationsHint')} isSelected={d.animationsEnabled} onChange={(v) => set({ animationsEnabled: v })} />
      {error ? <Alert>{error}</Alert> : null}
      <DialogActions>
        <Button onPress={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary">
          {t('common.save')}
        </Button>
      </DialogActions>
    </form>
  );
}

function PromoteDialog({ cls, classes, years, onDone }: { cls: SchoolClass; classes: SchoolClass[]; years: Year[]; onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const targets = classes.filter((c) => c.schoolYearId !== cls.schoolYearId && !c.archived && !c.yearArchived);
  const [to, setTo] = useState(targets[0]?.id ?? '');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<z.infer<typeof St.MoveReport> | null>(null);
  const yearName = (id: string) => years.find((y) => y.id === id)?.name ?? '';
  if (report) {
    return (
      <div className="cc-stack">
        <Alert kind="success">{t('students.moveReport', { moved: report.moved.length, skipped: report.skipped.length })}</Alert>
        <DialogActions>
          <Button variant="primary" onPress={onDone}>
            {t('common.close')}
          </Button>
        </DialogActions>
      </div>
    );
  }
  return (
    <form
      className="cc-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          const r = await call(St.promoteClass, { classId: cls.id, toClassId: to, ...(date ? { date } : {}) });
          void qc.invalidateQueries({ queryKey: ADMIN });
          setReport(r);
        } catch (err) {
          setError(errorText(t, err));
        }
      }}
    >
      <p>{t('classes.promoteExplain', { name: cls.name })}</p>
      {targets.length === 0 ? (
        <Alert kind="warning">{t('classes.promoteNoTarget')}</Alert>
      ) : (
        <Select label={t('classes.promoteTo')} value={to} onChange={setTo} items={targets.map((c) => ({ id: c.id, label: `${c.name} (${yearName(c.schoolYearId)})` }))} />
      )}
      <TextField label={t('students.moveDate')} description={t('students.moveDateHint')} type="date" value={date} onChange={setDate} />
      {error ? <Alert>{error}</Alert> : null}
      <DialogActions>
        <Button onPress={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" isDisabled={!to}>
          {t('classes.promote')}
        </Button>
      </DialogActions>
    </form>
  );
}

export function ClassesPage() {
  const { t } = useI18n();
  const run = useRun();
  const years = useQuery({ queryKey: K.years, queryFn: () => call(S.listYears, {}) });
  const classes = useQuery({ queryKey: [...K.classes, 'all'], queryFn: () => call(S.listClasses, { includeArchived: true }) });
  const search = useSearch({ strict: false }) as { new?: 1 };
  const [creating, setCreating] = useState(search.new === 1);
  const [editing, setEditing] = useState<SchoolClass | null>(null);
  const [archiving, setArchiving] = useState<SchoolClass | null>(null);
  const [promoting, setPromoting] = useState<SchoolClass | null>(null);
  const yearList = years.data?.years ?? [];
  const classList = [...(classes.data?.classes ?? [])].sort((a, b) => compareNames(a.name, b.name));
  const yearName = (id: string) => yearList.find((y) => y.id === id)?.name ?? '';
  return (
    <main className="cc-page cc-stack">
      <div className="cc-row">
        <h1 className="cc-h1" style={{ marginRight: 'auto' }}>
          {t('admin.classes')}
        </h1>
        <Button variant="primary" onPress={() => setCreating(true)} isDisabled={yearList.every((y) => y.archived)}>
          {t('classes.create')}
        </Button>
      </div>
      {classes.isSuccess && classList.length === 0 ? (
        <EmptyState
          title={t('classes.emptyTitle')}
          body={yearList.some((y) => !y.archived) ? t('classes.emptyBody') : t('classes.emptyNoYear')}
          action={
            yearList.some((y) => !y.archived) ? (
              <Button variant="primary" onPress={() => setCreating(true)}>
                {t('admin.addClassroom')}
              </Button>
            ) : (
              <Link to="/admin/years" className={buttonClass('primary')}>
                {t('admin.years')}
              </Link>
            )
          }
        />
      ) : null}
      <DataTable
        caption={t('admin.classes')}
        rows={classList}
        rowKey={(c) => c.id}
        emptyText={t('classes.none')}
        columns={[
          { key: 'name', header: t('classes.name'), sortValue: (c) => c.name, render: (c) => <strong>{c.name}</strong> },
          { key: 'year', header: t('classes.year'), sortValue: (c) => yearName(c.schoolYearId), render: (c) => yearName(c.schoolYearId) },
          { key: 'students', header: t('classes.students'), sortValue: (c) => c.studentCount, render: (c) => c.studentCount },
          { key: 'theme', header: t('classes.theme'), render: (c) => t(themeLabelKey(c.theme)) },
          { key: 'tz', header: t('classes.timezone'), render: (c) => c.timezone ?? t('classes.schoolTimezone') },
          {
            key: 'state',
            header: t('users.status'),
            render: (c) => (c.archived || c.yearArchived ? <ArchivedChip /> : <span className="cc-chip cc-chip--success">{t('users.active')}</span>),
          },
          {
            key: 'actions',
            header: t('common.actions'),
            render: (c) => (
              <div className="cc-row" style={{ gap: '0.4rem' }}>
                {c.archived || c.yearArchived ? null : (
                  <>
                    <Button size="small" onPress={() => setEditing(c)}>
                      {t('common.edit')}
                    </Button>
                    <Button size="small" onPress={() => setPromoting(c)}>
                      {t('classes.promote')}
                    </Button>
                  </>
                )}
                {c.archived ? (
                  <Button size="small" onPress={() => void run(() => call(S.unarchiveClass, { classId: c.id }), { invalidate: [K.classes] })}>
                    {t('common.unarchive')}
                  </Button>
                ) : c.yearArchived ? null : (
                  <Button size="small" variant="danger" onPress={() => setArchiving(c)}>
                    {t('common.archive')}
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      <Modal isOpen={creating} onOpenChange={setCreating} title={t('classes.create')}>
        <ClassForm years={yearList} onDone={() => setCreating(false)} />
      </Modal>
      <Modal isOpen={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={t('classes.edit')}>
        {editing ? <ClassForm cls={editing} years={yearList} onDone={() => setEditing(null)} /> : null}
      </Modal>
      <Modal isOpen={promoting !== null} onOpenChange={(o) => !o && setPromoting(null)} title={t('classes.promote')}>
        {promoting ? <PromoteDialog cls={promoting} classes={classList} years={yearList} onDone={() => setPromoting(null)} /> : null}
      </Modal>
      <ConfirmDestructive
        isOpen={archiving !== null}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={t('classes.archiveTitle')}
        description={t('classes.archiveExplain')}
        confirmText={archiving?.name ?? ''}
        actionLabel={t('common.archive')}
        onConfirm={() => run(() => call(S.archiveClass, { classId: archiving!.id }), { invalidate: [K.classes] })}
      />
    </main>
  );
}

// ---------------------------------------------------------------- teaching assignments
export function AssignmentsPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const run = useRun();
  const [includeEnded, setIncludeEnded] = useState(false);
  const contexts = useQuery({ queryKey: [...K.contexts, includeEnded], queryFn: () => call(S.listTeachingContexts, { includeEnded }) });
  const users = useQuery({ queryKey: K.users, queryFn: () => call(AdminC.listUsers, {}) });
  const classes = useQuery({ queryKey: [...K.classes, 'current'], queryFn: () => call(S.listClasses, {}) });
  const subjects = useQuery({ queryKey: K.subjects, queryFn: () => call(S.listSubjects, {}) });
  const teachers = (users.data?.users ?? []).filter((u) => u.role === 'teacher' && u.active);
  const [teacherId, setTeacherId] = useState('');
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState<z.infer<typeof S.TeachingContextAdmin> | null>(null);
  const classItems = (classes.data?.classes ?? []).filter((c) => !c.archived && !c.yearArchived).map((c) => ({ id: c.id, label: c.name }));
  return (
    <main className="cc-page cc-stack">
      <h1 className="cc-h1">{t('admin.assignments')}</h1>
      <form
        className="cc-card cc-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await call(S.assignTeachingContext, { teacherId, classId, subjectId });
            void qc.invalidateQueries({ queryKey: K.contexts });
            showToast({ message: t('assign.done'), kind: 'success' });
          } catch (err) {
            setError(errorText(t, err));
          }
        }}
      >
        <h2 className="cc-h2">{t('assign.new')}</h2>
        <p className="cc-muted">{t('assign.explain')}</p>
        <div className="cc-row" style={{ alignItems: 'flex-end' }}>
          <Select label={t('assign.teacher')} value={teacherId} onChange={setTeacherId} placeholder={t('common.choose')} items={teachers.map((u) => ({ id: u.id, label: u.displayName }))} />
          <Select label={t('assign.class')} value={classId} onChange={setClassId} placeholder={t('common.choose')} items={classItems} />
          <Select
            label={t('assign.subject')}
            value={subjectId}
            onChange={setSubjectId}
            placeholder={t('common.choose')}
            items={(subjects.data?.subjects ?? []).map((s) => ({ id: s.id, label: pickText(s.name, locale) }))}
          />
          <Button type="submit" variant="primary" isDisabled={!teacherId || !classId || !subjectId}>
            {t('assign.assign')}
          </Button>
        </div>
        {error ? <Alert>{error}</Alert> : null}
      </form>
      <Toggle label={t('assign.showEnded')} isSelected={includeEnded} onChange={setIncludeEnded} />
      <DataTable
        caption={t('admin.assignments')}
        rows={contexts.data?.contexts ?? []}
        rowKey={(c) => c.id}
        emptyText={t('assign.none')}
        columns={[
          { key: 'teacher', header: t('assign.teacher'), sortValue: (c) => c.teacherName, render: (c) => c.teacherName },
          { key: 'class', header: t('assign.class'), sortValue: (c) => c.className, render: (c) => c.className },
          { key: 'subject', header: t('assign.subject'), sortValue: (c) => pickText(c.subjectName, locale), render: (c) => pickText(c.subjectName, locale) },
          {
            key: 'state',
            header: t('users.status'),
            render: (c) => (c.endedAt ? <span className="cc-chip">{t('assign.ended')}</span> : <span className="cc-chip cc-chip--success">{t('users.active')}</span>),
          },
          {
            key: 'actions',
            header: t('common.actions'),
            render: (c) =>
              c.endedAt ? null : (
                <Button size="small" variant="danger" onPress={() => setEnding(c)}>
                  {t('assign.end')}
                </Button>
              ),
          },
        ]}
      />
      <ConfirmDestructive
        isOpen={ending !== null}
        onOpenChange={(o) => !o && setEnding(null)}
        title={t('assign.end')}
        description={t('assign.endExplain', { teacher: ending?.teacherName ?? '', className: ending?.className ?? '' })}
        confirmText={ending?.className ?? ''}
        actionLabel={t('assign.end')}
        onConfirm={() => run(() => call(S.endTeachingContext, { contextId: ending!.id }), { invalidate: [K.contexts] })}
      />
    </main>
  );
}

// ---------------------------------------------------------------- module & media policies
/**
 * The school's default goal categories and goals (D-116): an administrator archives one for every
 * class or restores it. Teachers can additionally hide a default for their own classes only.
 */
function GoalDefaultsSection() {
  const { t, locale } = useI18n();
  const run = useRun();
  const q = useQuery({ queryKey: K.goalDefaults, queryFn: () => call(G.adminGoalDefaults, {}) });
  const qc = useQueryClient();
  const d = q.data;
  const toggle = (kind: 'category' | 'preset', itemId: string, archived: boolean) =>
    void run(() => call(G.adminArchiveGoalDefault, { kind, itemId, archived }), { success: t('save.saved') }).then((r) => r && qc.setQueryData(K.goalDefaults, r));
  const button = (kind: 'category' | 'preset', item: { id: string; archived: boolean }, label: string) => (
    <Button size="small" variant="ghost" aria-label={`${item.archived ? t('goals.restore') : t('goals.archive')}: ${label}`} onPress={() => toggle(kind, item.id, !item.archived)}>
      {item.archived ? t('goals.restore') : t('goals.archive')}
    </Button>
  );
  return (
    <section className="cc-card cc-stack" aria-labelledby="goal-defaults-title" data-testid="admin-goal-defaults">
      <h2 id="goal-defaults-title" className="cc-h2">
        {t('goals.adminDefaultsTitle')}
      </h2>
      <p className="cc-muted">{t('goals.adminDefaultsHint')}</p>
      {!d ? <p className="cc-muted">{t('common.loading')}</p> : null}
      <ul className="cc-stack">
        {(d?.categories ?? []).map((c) => {
          const name = pickText(c.name, locale);
          return (
            <li key={c.id} className="cc-stack">
              <div className="cc-row">
                <h3 className="cc-h3">{name}</h3>
                {c.archived ? <span className="cc-chip">{t('goals.schoolArchived')}</span> : null}
                <span className="cc-push-right">{button('category', c, name)}</span>
              </div>
              <ul className="cc-stack">
                {(d?.presets ?? [])
                  .filter((p) => p.categoryId === c.id)
                  .map((p) => {
                    const text = pickText(p.text, locale);
                    return (
                      <li key={p.id} className="cc-row">
                        <span>{text}</span>
                        {p.archived ? <span className="cc-chip">{t('goals.schoolArchived')}</span> : null}
                        {button('preset', p, text)}
                      </li>
                    );
                  })}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ModulesPage() {
  const { t } = useI18n();
  const run = useRun();
  const policies = useQuery({ queryKey: K.policies, queryFn: () => call(S.getModulePolicies, {}) });
  const list = policies.data?.policies ?? [];
  const teacherModules = list.filter((p) => !p.module.startsWith('media.'));
  const media = list.filter((p) => p.module.startsWith('media.'));
  const toggle = (module: S.ModuleKey, on: boolean) =>
    void run(() => call(S.setModulePolicy, { module, availability: on ? 'enabled' : 'disabled' }), { invalidate: [K.policies], success: t('save.saved') });
  return (
    <main className="cc-page cc-stack">
      <h1 className="cc-h1">{t('admin.modules')}</h1>
      <section className="cc-card cc-stack">
        <h2 className="cc-h2">{t('modules.teacherTitle')}</h2>
        <p className="cc-muted">{t('modules.teacherExplain')}</p>
        {teacherModules.map((p) => (
          <Toggle key={p.module} label={t(moduleLabelKey(p.module))} isSelected={p.availability === 'enabled'} onChange={(v) => toggle(p.module, v)} />
        ))}
      </section>
      <section className="cc-card cc-stack" aria-labelledby="media-title">
        <h2 id="media-title" className="cc-h2">
          {t('modules.mediaTitle')}
        </h2>
        <Alert kind="warning">{t('modules.mediaConsent')}</Alert>
        {media.map((p) => (
          <Toggle
            key={p.module}
            label={t(moduleLabelKey(p.module))}
            description={p.module === 'media.evidenceDocuments' ? t('modules.documentsHint') : t('modules.disabledUntilConsent')}
            isSelected={p.availability === 'enabled'}
            onChange={(v) => toggle(p.module, v)}
          />
        ))}
      </section>
      <GoalDefaultsSection />
      <p className="cc-muted">
        <IconCheck /> {t('modules.keepsData')}
      </p>
    </main>
  );
}
