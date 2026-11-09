/**
 * Reports page (RPT-1..6) for the teacher area (own class+subject contexts) and the admin area
 * (every context, without the teacher's lesson notes). Filters: class+subject, student, period preset
 * (day / week / month / term / school year / custom). Each table has a CSV link; Print gives an A4
 * summary with a header. A chosen student also gets their timeline (teacher area).
 *
 * S14e1 (D-153): report views. A view (built-in or saved by this account) picks the sections and
 * tables; ★ marks the account's default view, which opens first. "Customise" shows the section and
 * table checkboxes (from the catalogue of this class+subject), with Save as / Update / Delete. Sections
 * fold (`<details>`, remembered on this device) and Print opens them all. Everything the page shows is
 * a deep link: `contextId`, `studentId`, `view`, `period`, `from`, `to` (`from` alone is the day of a
 * day/week/month/term period, `from` + `to` a custom period).
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { PERIOD_PRESETS, presetRange, type PeriodPreset } from '../../domain/periods.ts';
import * as R from '../../shared/contracts/reports.ts';
import { isIsoDate } from '../../shared/dates.ts';
import { formatDay, pickText, type MessageKey } from '../../shared/i18n/index.ts';
import {
  BUILTIN_VIEW_IDS,
  BUILTIN_VIEWS,
  builtinOf,
  builtinRef,
  DEFAULT_VIEW_REF,
  sectionsParam,
  type ReportViewSection,
  type ReportViewSpec,
} from '../../shared/reportViews.ts';
import { call, urlFor } from '../lib/api.ts';
import { errorText } from '../lib/errors.ts';
import { useI18n } from '../lib/i18n.tsx';
import { SENSITIVE } from '../lib/queryClient.ts';
import { useRun } from '../lib/useRun.ts';
import { Button } from '../ui/Button.tsx';
import { DialogActions, Modal } from '../ui/Dialog.tsx';
import { Alert, EmptyState } from '../ui/Feedback.tsx';
import { Select, TextField } from '../ui/Fields.tsx';
import { IconPrint, IconSettings, IconStar, IconTrash } from '../ui/icons.tsx';
import { SectionView, useLabel } from './ReportView.tsx';

/** Native date input (calendar picker on touch devices) with the usual field chrome. */
function DateInput({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="cc-field">
      <label htmlFor={id} className="cc-field__label">
        {label}
      </label>
      <input id={id} type="date" className="cc-input" value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${id}-h` : undefined} />
      {hint ? (
        <span id={`${id}-h`} className="cc-field__hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

type Viewer = 'teacher' | 'admin';
const presetKey = (p: PeriodPreset) => `report.preset.${p}` as MessageKey;
const builtinKey = (id: string) => `reportViews.builtin.${id}` as MessageKey;

// ---------------------------------------------------------------- deep link
/** The report's address: what is chosen on the page (all optional; strings as in the URL). */
export interface ReportLink {
  contextId?: string | undefined;
  studentId?: string | undefined;
  /** A built-in view id (`studentOverview`) or a saved view's id. */
  view?: string | undefined;
  period?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}
const LINK_KEYS = ['contextId', 'studentId', 'view', 'period', 'from', 'to'] as const;

/** A date from a link, or '' when it is missing or not a real 'YYYY-MM-DD' day (a typed or cut-off link). */
const linkDate = (v: string | undefined) => (v && isIsoDate(v) ? v : '');

/**
 * The link's parameters from a URL search (anything else is ignored). `from` and `to` are kept only
 * when they are real dates, so a mistyped link opens the default period instead of breaking the page.
 */
export function linkFromSearch(search: Readonly<Record<string, unknown>>): ReportLink {
  const out: ReportLink = {};
  for (const k of LINK_KEYS) {
    const v = search[k];
    if (typeof v !== 'string' || !v) continue;
    if ((k === 'from' || k === 'to') && !linkDate(v)) continue;
    out[k] = v;
  }
  return out;
}

/** Only the parameters that are set, for the URL. */
export function linkSearch(link: ReportLink): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of LINK_KEYS) {
    const v = link[k];
    if (v) out[k] = v;
  }
  return out;
}

/** A view reference from the URL: `studentOverview` (or `builtin:studentOverview`) or a saved view id. */
const refOfParam = (v: string) => (builtinOf(v) ? v : builtinOf(`builtin:${v}`) ? `builtin:${v}` : v);
/** The URL form of a view reference (built-in views by their plain id). */
const paramOfRef = (ref: string) => builtinOf(ref) ?? ref;

// ---------------------------------------------------------------- view selection helpers
/** The spec as explicit sections in catalogue order (null = every catalogue section); entries the catalogue does not have here are kept. */
function explicit(spec: ReportViewSpec | null, catalog: readonly R.ReportCatalogSection[]): ReportViewSection[] {
  if (!spec) return catalog.map((c) => ({ key: c.key, tables: null }));
  const known = catalog.flatMap((c) => spec.sections.filter((s) => s.key === c.key));
  return [...known, ...spec.sections.filter((s) => !catalog.some((c) => c.key === s.key))];
}
const sameSpec = (a: ReportViewSpec | null, b: ReportViewSpec | null) => JSON.stringify(a) === JSON.stringify(b);

/** Section and table checkboxes for this class+subject's catalogue. */
function ViewTree({ catalog, spec, onChange }: { catalog: readonly R.ReportCatalogSection[]; spec: ReportViewSpec | null; onChange: (s: ReportViewSection[]) => void }) {
  const { t } = useI18n();
  const label = useLabel();
  const sections = explicit(spec, catalog);
  const entry = (key: string) => sections.find((s) => s.key === key);
  const setSection = (key: string, on: boolean) => {
    const rest = sections.filter((s) => s.key !== key);
    onChange(on ? explicit({ sections: [...rest, { key, tables: null }] }, catalog) : rest);
  };
  const setTable = (c: R.ReportCatalogSection, table: string, on: boolean) => {
    const all = c.tables.map((x) => x.key);
    const e = entry(c.key);
    const now = e ? (e.tables ?? all) : [];
    const next = all.filter((k) => (k === table ? on : now.includes(k)));
    const rest = sections.filter((s) => s.key !== c.key);
    if (!next.length) return onChange(rest);
    onChange(explicit({ sections: [...rest, { key: c.key, tables: next.length === all.length ? null : next }] }, catalog));
  };
  return (
    <fieldset className="cc-fieldset cc-stack" data-testid="report-view-tree">
      <legend className="cc-field__label">{t('reportViews.treeLegend')}</legend>
      <ul className="cc-report-tree">
        {catalog.map((c) => {
          const e = entry(c.key);
          return (
            <li key={c.key}>
              <label className="cc-check">
                <input type="checkbox" checked={Boolean(e)} onChange={(ev) => setSection(c.key, ev.target.checked)} />
                <span>{c.tables.length > 1 ? t('reportViews.section', { title: label(c.title) }) : label(c.title)}</span>
              </label>
              {c.tables.length > 1 ? (
                <ul>
                  {c.tables.map((tb) => (
                    <li key={tb.key}>
                      <label className="cc-check">
                        <input type="checkbox" checked={Boolean(e) && (e!.tables === null || e!.tables.includes(tb.key))} onChange={(ev) => setTable(c, tb.key, ev.target.checked)} />
                        <span>{label(tb.title)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

// ---------------------------------------------------------------- folded sections (per device)
function useFolded(viewer: Viewer) {
  const storageKey = `cc.reports.folded.${viewer}`;
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown;
      return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  });
  const save = (next: ReadonlySet<string>) => {
    setFolded(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      // Private mode or storage off: folding still works on this page.
    }
  };
  return [folded, save] as const;
}

/** While printing, every section is open (print expands the selected sections). */
function usePrinting() {
  const [printing, setPrinting] = useState(false);
  const ref = useRef(false);
  useEffect(() => {
    const before = () => {
      ref.current = true;
      flushSync(() => setPrinting(true));
    };
    const after = () => {
      setPrinting(false);
      // The details' toggle events from closing again arrive after this; ignore them too.
      setTimeout(() => (ref.current = false), 0);
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  return [printing, ref] as const;
}

// ---------------------------------------------------------------- page
export function ReportsPage({ viewer, link: linkProp, onLinkChange }: { viewer: Viewer; link?: ReportLink | undefined; onLinkChange?: ((link: ReportLink) => void) | undefined }) {
  const { t, locale } = useI18n();
  const label = useLabel();
  const run = useRun();
  const qc = useQueryClient();
  const [ownLink, setOwnLink] = useState<ReportLink>(linkProp ?? {});
  const link = onLinkChange ? (linkProp ?? {}) : ownLink;
  const setLink = (patch: Partial<ReportLink>) => {
    const next = { ...link, ...patch };
    if (onLinkChange) onLinkChange(next);
    else setOwnLink(next);
  };

  const contexts = useQuery({
    queryKey: [SENSITIVE, viewer, 'reports', 'contexts'],
    queryFn: () => call(viewer === 'admin' ? R.adminReportContexts : R.reportContexts, {}),
  });
  const list = contexts.data?.contexts ?? [];
  const contextId = list.find((c) => c.id === link.contextId)?.id ?? list[0]?.id ?? '';
  const info = list.find((c) => c.id === contextId);
  const preset: PeriodPreset = (PERIOD_PRESETS as readonly string[]).includes(link.period ?? '') ? (link.period as PeriodPreset) : 'year';
  // Dates are checked again here: a link may also come from another screen, not only the URL.
  const anchor = preset !== 'custom' && preset !== 'year' ? linkDate(link.from) : '';
  const custom = preset === 'custom' ? { from: linkDate(link.from), to: linkDate(link.to) } : { from: '', to: '' };
  const studentId = link.studentId ?? '';

  const range = useMemo(() => {
    if (!info) return null;
    const cal = { today: info.today, weekStartsOn: info.weekStartsOn, year: { from: info.year.startsOn, to: info.year.endsOn }, terms: info.terms.map((x) => ({ from: x.startsOn, to: x.endsOn })) };
    const r = presetRange(preset, cal, anchor || undefined, custom.from && custom.to ? custom : undefined);
    // The school year runs to today at most (nothing is recorded in the future).
    return preset === 'year' && info.today >= r.from && info.today < r.to ? { from: r.from, to: info.today } : r;
  }, [info, preset, anchor, custom.from, custom.to]);

  // Views: the account's saved views and default (S14e1).
  const viewsKey = [SENSITIVE, viewer, 'reports', 'views'];
  const views = useQuery({ queryKey: viewsKey, queryFn: () => call(viewer === 'admin' ? R.adminReportViews : R.reportViews, {}) });
  const catalog = useQuery({
    queryKey: [SENSITIVE, viewer, 'reports', 'catalog', contextId],
    queryFn: () => call(viewer === 'admin' ? R.adminReportCatalog : R.reportCatalog, { contextId }),
    enabled: Boolean(contextId),
  });
  const saved = views.data?.views ?? [];
  const defaultRef = views.data?.defaultView ?? DEFAULT_VIEW_REF;
  const requestedRef = link.view ? refOfParam(link.view) : null;
  // The view in the link, else the default view. A saved view needs the list first; a deleted or
  // unknown one (an old link) opens the default view. null = still loading.
  let activeRef: string | null = null;
  if (requestedRef && builtinOf(requestedRef)) activeRef = requestedRef;
  else if (views.data) activeRef = requestedRef && saved.some((v) => v.id === requestedRef) ? requestedRef : defaultRef;
  else if (views.isError) activeRef = DEFAULT_VIEW_REF;
  const activeSaved = saved.find((v) => v.id === activeRef) ?? null;
  const activeBuiltin = activeRef ? builtinOf(activeRef) : null;
  const viewSpec: ReportViewSpec | null = activeSaved ? activeSaved.spec : activeBuiltin ? BUILTIN_VIEWS[activeBuiltin] : null;
  const [draft, setDraft] = useState<{ ref: string | null; spec: ReportViewSpec } | null>(null);
  const spec = draft && draft.ref === activeRef ? draft.spec : viewSpec;
  const changed = Boolean(draft && draft.ref === activeRef && !sameSpec(draft.spec, viewSpec));
  const noSections = spec !== null && spec.sections.length === 0;
  const [customising, setCustomising] = useState(false);
  const [savingAs, setSavingAs] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [folded, setFolded] = useFolded(viewer);
  const [printing, printingRef] = usePrinting();

  const input = { contextId, from: range?.from, to: range?.to, studentId: studentId || undefined };
  const sections = sectionsParam(spec);
  const report = useQuery({
    queryKey: [SENSITIVE, viewer, 'reports', input, sections ?? null],
    queryFn: () => call(viewer === 'admin' ? R.adminContextReport : R.contextReport, { ...input, sections }),
    // Wait for the default view before the first report, so it is fetched once.
    enabled: Boolean(contextId && range && activeRef !== null && !noSections),
  });
  const timeline = useQuery({
    queryKey: [SENSITIVE, viewer, 'reports', 'timeline', input],
    queryFn: () => call(R.studentTimeline, { contextId, studentId, from: range?.from, to: range?.to }),
    enabled: viewer === 'teacher' && Boolean(contextId && range && studentId),
  });
  const csvHref = (section: string) => (table: string) =>
    urlFor(viewer === 'admin' ? R.adminContextReportCsv : R.contextReportCsv, { ...input, section, table, delimiter: locale === 'tr' ? 'semicolon' : 'comma' });

  if (contexts.isLoading) return <p className="cc-muted">{t('common.loading')}</p>;
  if (!list.length) return <EmptyState title={t('report.ui.noContexts')} />;
  const data = report.data;
  const ctxLabel = (c: R.ReportContextInfo) => `${c.className} · ${pickText(c.subjectName, locale)}${viewer === 'admin' ? ` · ${c.teacherName}` : ''} · ${c.year.name}${c.ended ? ` (${t('report.ui.ended')})` : ''}`;
  const nameOf = (ref: string) => {
    const b = builtinOf(ref);
    return b ? t(builtinKey(b)) : (saved.find((v) => v.id === ref)?.name ?? t('reportViews.builtin.everything'));
  };
  const viewItems = [...BUILTIN_VIEW_IDS.map((id) => builtinRef(id)), ...saved.map((v) => v.id)].map((ref) => ({
    id: ref,
    label: ref === defaultRef ? t('reportViews.optionDefault', { name: nameOf(ref) }) : nameOf(ref),
  }));
  const selectedRef = activeRef ?? defaultRef;
  const api = viewer === 'admin'
    ? { create: R.adminCreateReportView, update: R.adminUpdateReportView, remove: R.adminDeleteReportView, setDefault: R.adminSetDefaultReportView }
    : { create: R.createReportView, update: R.updateReportView, remove: R.deleteReportView, setDefault: R.setDefaultReportView };
  const chooseView = (ref: string) => {
    setDraft(null);
    setLink({ view: paramOfRef(ref) });
  };
  const setFold = (key: string, open: boolean) => {
    // Toggle events from printing (open all, then back) and from React's own updates change nothing.
    if (printingRef.current || open === !folded.has(key)) return;
    const next = new Set(folded);
    if (open) next.delete(key);
    else next.add(key);
    setFolded(next);
  };
  const shown = data?.sections ?? [];
  return (
    <div className="cc-stack">
      <div className="cc-report-filters cc-noprint">
        <Select label={t('reportViews.view')} items={viewItems} value={selectedRef} onChange={chooseView} />
        <Select
          label={t('report.ui.context')}
          items={list.map((c) => ({ id: c.id, label: ctxLabel(c) }))}
          value={contextId}
          onChange={(v) => setLink({ contextId: v, studentId: undefined })}
        />
        <Select label={t('report.ui.period')} items={PERIOD_PRESETS.map((p) => ({ id: p, label: t(presetKey(p)) }))} value={preset} onChange={(v) => setLink({ period: v, from: undefined, to: undefined })} />
        {preset === 'custom' ? (
          <>
            <DateInput label={t('report.ui.from')} value={custom.from} onChange={(v) => setLink({ from: v || undefined })} />
            <DateInput label={t('report.ui.to')} value={custom.to} onChange={(v) => setLink({ to: v || undefined })} />
          </>
        ) : preset !== 'year' ? (
          <DateInput label={t('report.ui.anchor')} value={anchor} onChange={(v) => setLink({ from: v || undefined })} hint={t('report.ui.anchorHint')} />
        ) : null}
        <Select
          label={t('report.ui.student')}
          items={[{ id: '', label: t('report.ui.wholeClass') }, ...(data?.students ?? []).map((s) => ({ id: s.id, label: s.active ? s.fullName : `${s.fullName} (${t('report.ui.inactive')})` }))]}
          value={studentId}
          onChange={(v) => setLink({ studentId: v || undefined })}
        />
      </div>
      <div className="cc-report-viewbar cc-noprint">
        {selectedRef === defaultRef ? (
          <span className="cc-report-viewbar__default" data-testid="report-view-default">
            <IconStar />
            {t('reportViews.isDefault')}
          </span>
        ) : (
          <Button
            onPress={() =>
              void run(() => call(api.setDefault, { view: selectedRef }), { success: t('reportViews.defaultSet', { name: nameOf(selectedRef) }), invalidate: [viewsKey] })
            }
          >
            <IconStar />
            {t('reportViews.makeDefault')}
          </Button>
        )}
        <Button onPress={() => setCustomising((c) => !c)} aria-expanded={customising} aria-controls="report-customise">
          <IconSettings />
          {t('reportViews.customise')}
        </Button>
        {shown.length > 1 ? (
          <>
            <Button variant="ghost" onPress={() => setFolded(new Set())}>
              {t('reportViews.openAll')}
            </Button>
            <Button variant="ghost" onPress={() => setFolded(new Set([...folded, ...shown.map((s) => s.key)]))}>
              {t('reportViews.closeAll')}
            </Button>
          </>
        ) : null}
        {/* `beforeprint` opens every section (usePrinting). */}
        <Button className="cc-push-right" onPress={() => window.print()}>
          <IconPrint />
          {t('report.ui.print')}
        </Button>
      </div>
      {customising ? (
        <div id="report-customise" className="cc-card cc-stack cc-noprint">
          {catalog.data ? <ViewTree catalog={catalog.data.sections} spec={spec} onChange={(s) => setDraft({ ref: activeRef, spec: { sections: s } })} /> : <p className="cc-muted">{t('common.loading')}</p>}
          {noSections ? <p role="alert" className="cc-field__error">⚠ {t('reportViews.noSections')}</p> : changed ? <p className="cc-muted">{t('reportViews.changed')}</p> : null}
          <div className="cc-row">
            <Button isDisabled={noSections || saved.length >= (views.data?.max ?? Infinity)} onPress={() => setSavingAs(true)}>
              {t('reportViews.saveAs')}
            </Button>
            {activeSaved && changed && !noSections && spec ? (
              <Button
                variant="primary"
                onPress={async () => {
                  const r = await run(() => call(api.update, { viewId: activeSaved.id, spec }), { success: t('reportViews.updated', { name: activeSaved.name }), invalidate: [viewsKey] });
                  if (r) {
                    qc.setQueryData<R.ReportViews>(viewsKey, (old) => (old ? { ...old, views: old.views.map((x) => (x.id === r.id ? r : x)) } : old));
                    setDraft(null);
                  }
                }}
              >
                {t('reportViews.update', { name: activeSaved.name })}
              </Button>
            ) : null}
            {changed ? <Button onPress={() => setDraft(null)}>{t('reportViews.reset')}</Button> : null}
            {activeSaved ? (
              <Button variant="danger-outline" onPress={() => setDeleting(true)}>
                <IconTrash />
                {t('reportViews.delete')}
              </Button>
            ) : null}
            {views.data ? <span className="cc-muted cc-push-right">{t('reportViews.count', { count: saved.length, max: views.data.max })}</span> : null}
          </div>
        </div>
      ) : null}
      {savingAs ? (
        <SaveAsDialog
          onClose={() => setSavingAs(false)}
          onSave={async (name) => {
            const body = spec ?? { sections: explicit(null, catalog.data?.sections ?? []) };
            const v = await run(() => call(api.create, { name, spec: body }), { success: t('reportViews.saved', { name }), invalidate: [viewsKey] });
            if (!v) return false;
            // Known at once, so the new view is selected without waiting for the list.
            qc.setQueryData<R.ReportViews>(viewsKey, (old) => (old ? { ...old, views: [...old.views, v] } : old));
            setDraft(null);
            setLink({ view: v.id });
            return true;
          }}
        />
      ) : null}
      {deleting && activeSaved ? (
        <Modal isOpen onOpenChange={(o) => !o && setDeleting(false)} title={t('reportViews.deleteTitle', { name: activeSaved.name })} role="alertdialog">
          <p>{t('reportViews.deleteBody')}</p>
          <DialogActions>
            <Button onPress={() => setDeleting(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onPress={async () => {
                const r = await run(() => call(api.remove, { viewId: activeSaved.id }), { success: t('reportViews.deleted'), invalidate: [viewsKey] });
                setDeleting(false);
                if (r) {
                  setDraft(null);
                  setLink({ view: undefined });
                }
              }}
            >
              {t('reportViews.delete')}
            </Button>
          </DialogActions>
        </Modal>
      ) : null}
      {report.error ? <Alert>{errorText(t, report.error)}</Alert> : null}
      {data ? (
        <div className="cc-stack cc-print-sheet" data-testid="report">
          <header className="cc-stack">
            <p className="cc-print-only">{data.schoolName}</p>
            <h2 className="cc-h2">
              {data.context.className} · {pickText(data.context.subjectName, locale)}
              {data.student ? ` · ${data.student.fullName}` : ''}
            </h2>
            <p className="cc-muted">
              {t('report.ui.header', { from: formatDay(data.from, locale), to: formatDay(data.to, locale), teacher: data.context.teacherName, year: data.context.year.name })}
            </p>
            <p className="cc-muted" data-testid="report-view-name">
              {/* Printed too: a customised, unsaved choice of sections must not carry the view's name alone. */}
              {t('reportViews.view')}: {changed ? t('reportViews.viewChanged', { name: nameOf(selectedRef) }) : nameOf(selectedRef)}
            </p>
            <p className="cc-print-only cc-muted">{t('report.ui.generated', { at: new Date(data.generatedAt).toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-GB') })}</p>
            {data.context.classNames.some((n) => n !== data.context.className) ? <p className="cc-muted">{t('report.ui.renamedClass', { names: data.context.classNames.join(', '), now: data.context.className })}</p> : null}
            <p className="cc-muted">{t('report.ui.rpt5')}</p>
          </header>
          {spec && !shown.length ? <EmptyState title={t('reportViews.emptyView')} mascot={false} /> : null}
          {shown.map((s) => (
            <SectionView key={s.key} section={s} csvHref={csvHref(s.key)} open={printing || !folded.has(s.key)} onToggle={(open) => setFold(s.key, open)} />
          ))}
          {viewer === 'teacher' && studentId && timeline.data ? (
            <section className="cc-card cc-stack" aria-labelledby="sec-timeline">
              <h3 className="cc-h2" id="sec-timeline">
                {t('report.ui.timeline')}
              </h3>
              {timeline.data.truncated ? <p className="cc-muted">{t('report.ui.timelineTruncated')}</p> : null}
              {timeline.data.events.length ? (
                <ol className="cc-timeline">
                  {timeline.data.events.map((e, i) => (
                    <li key={i}>
                      <time dateTime={e.date}>{e.date}</time>
                      <strong>{label(e.what)}</strong>
                      {e.detail ? ` – ${label(e.detail)}` : ''}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="cc-muted">{t('report.ui.noEvents')}</p>
              )}
            </section>
          ) : null}
        </div>
      ) : report.isLoading || activeRef === null ? (
        <p className="cc-muted">{t('common.loading')}</p>
      ) : null}
    </div>
  );
}

function SaveAsDialog({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => Promise<boolean> }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const done = await onSave(name.trim());
    setBusy(false);
    if (done) onClose();
  };
  return (
    <Modal isOpen onOpenChange={(o) => !o && onClose()} title={t('reportViews.saveAsTitle')}>
      <form
        className="cc-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextField label={t('reportViews.name')} description={t('reportViews.nameHint')} value={name} onChange={setName} maxLength={60} autoFocus autoComplete="off" />
        <DialogActions>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isDisabled={!name.trim() || busy}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Modal>
  );
}

/** Teacher-area page (manifest teacher page `/teacher/reports`); the URL holds the report's deep link. */
export function TeacherReportsPage({ search }: { search: Readonly<Record<string, string | undefined>> }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <main className="cc-page cc-page--wide cc-stack">
      <h1 className="cc-h1">{t('teacher.reports')}</h1>
      <ReportsPage
        viewer="teacher"
        link={linkFromSearch(search)}
        onLinkChange={(l) => void navigate({ to: '/teacher/$page', params: { page: 'reports' }, search: linkSearch(l), replace: true })}
      />
    </main>
  );
}
