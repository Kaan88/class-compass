/**
 * Admin → Themes (S14g, D-158): the school's theme catalogue, theme package import with a validation
 * report and a live preview, export of any theme, and enable / disable / delete of imported themes.
 *
 * Import: choose a file or paste the JSON → Check package (the server's report, the same validator the
 * server stores with) → Preview (built on this page from the checked package, under a preview key, so
 * the live theme never changes) → Save as draft → Enable. A package with errors cannot be saved; fix
 * the file (or the text here) and check again. Nothing on this page runs CSS or markup from a package:
 * colours, presets and numbers become tokens, art goes through the SVG sanitiser and `SvgTree`.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import * as Th from '../../../shared/contracts/themes.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import { translate } from '../../../shared/i18n/index.ts';
import { DEFAULT_THEME } from '../../../shared/themes.ts';
import { AA, CONTRAST_PAIRS, pairContrast } from '../../../shared/themePackage/contrast.ts';
import { PACKAGE_LIMITS } from '../../../shared/themePackage/limits.ts';
import { call } from '../../lib/api.ts';
import { getDisplay } from '../../lib/display.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { showToast } from '../../lib/toast.ts';
import { useRun } from '../../lib/useRun.ts';
import { CelebrationPreview } from '../../themes/Celebration.tsx';
import { AVAILABLE_THEMES_KEY, packageFromDefinition, previewKey, registerThemePackage } from '../../themes/custom.tsx';
import { playThemeSound, THEME_LIST, ThemeProvider, themeOf, useThemeLabels } from '../../themes/index.tsx';
import { customThemesVersion, getCustomTheme, removeCustomTheme, subscribeCustomThemes } from '../../themes/registry.ts';
import { ILLUSTRATIONS, MASCOT_POSES, SOUND_EVENTS, type ThemeDefinition } from '../../themes/types.ts';
import { Button } from '../../ui/Button.tsx';
import { ConfirmDestructive } from '../../ui/Dialog.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { TextArea } from '../../ui/Fields.tsx';
import { IconCheck, IconFile, IconPlay, IconTrash, IconUpload } from '../../ui/icons.tsx';
import { DataTable } from '../../ui/Layout.tsx';
import { Mascot, ThemeBackdrop, ThemeDecoration, ThemeIllustration } from '../../ui/Mascot.tsx';
import { Avatar, CounterBar, StudentCard, StudentGrid } from '../../ui/Students.tsx';
import { ThemePreview } from '../../ui/ThemePreview.tsx';
import { ADMIN } from './Admin.tsx';

const THEMES_KEY = [...ADMIN, 'themes'];
type Summary = Th.CustomThemeSummary;
type Report = Th.ThemeReportDto;
type Issue = Report['errors'][number];

/** Fictional sample students for the previews only. */
const SAMPLE = [
  { id: 'sample-theme-1', fullName: 'Ada Yıldız', weeklyCount: 0 },
  { id: 'sample-theme-2', fullName: 'Deniz Kaya', weeklyCount: 2 },
  { id: 'sample-theme-3', fullName: 'Elif Demir', weeklyCount: 4 },
  { id: 'sample-theme-4', fullName: 'Can Aydın', weeklyCount: 6 },
] as const;
const levelOf = (n: number) => (n >= 6 ? 3 : n >= 4 ? 2 : n >= 2 ? 1 : 0) as 0 | 1 | 2 | 3;

/** Saves a text as a file on this device (export). */
function download(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const json = (pkg: unknown) => `${JSON.stringify(pkg, null, 2)}\n`;

function useCustomThemesVersion() {
  return useSyncExternalStore(subscribeCustomThemes, customThemesVersion, customThemesVersion);
}

/** One issue of the report in words (translated by code; technical details as they are). */
function IssueText({ issue }: { issue: Issue }) {
  const { t } = useI18n();
  const p = issue.params ?? {};
  const str = (k: string) => String(p[k] ?? '');
  let text: string;
  switch (issue.code) {
    case 'SOUND':
      text = t('themes.issue.SOUND', {
        event: t(`sound.${str('event')}` as MessageKey),
        problem: t(`themes.soundKind.${str('kind')}` as MessageKey),
        value: str('value'),
        limit: str('limit'),
      });
      break;
    case 'SVG':
      text = t('themes.issue.SVG', { reason: t(`themes.svgReason.${str('reason')}` as MessageKey), detail: str('detail') });
      break;
    case 'CONTRAST':
      text = t('themes.issue.CONTRAST', { fg: str('fg'), bg: str('bg'), ratio: str('ratio'), min: str('min') });
      break;
    case 'TOO_LARGE':
      text = t('themes.issue.TOO_LARGE', { bytes: str('bytes'), limit: str('limit') });
      break;
    case 'SCHEMA':
      text = t('themes.issue.SCHEMA', { detail: str('detail') });
      break;
    case 'KEY_BUILTIN':
      text = t('themes.issue.KEY_BUILTIN', { key: str('key') });
      break;
    case 'ART_FROM_BASE':
      text = t('themes.issue.ART_FROM_BASE', { items: str('items'), base: str('base') });
      break;
    default:
      text = t(`themes.issue.${issue.code}` as MessageKey);
  }
  return (
    <>
      {text}
      {issue.path ? (
        <>
          {' '}
          <span className="cc-muted">{t('themes.report.path', { path: issue.path })}</span>
        </>
      ) : null}
    </>
  );
}

function ReportView({ report }: { report: Report }) {
  const { t } = useI18n();
  return (
    <section className="cc-card cc-stack" aria-labelledby="theme-report-title" data-testid="theme-report">
      <h3 className="cc-h3" id="theme-report-title">
        {t('themes.report.heading')}
      </h3>
      {report.ok ? <Alert kind="success">{t('themes.report.ok')}</Alert> : <Alert kind="danger">{t('themes.report.errors', { count: report.errors.length })}</Alert>}
      {report.errors.length ? (
        <ul className="cc-theme-issues" data-testid="theme-report-errors">
          {report.errors.map((e, i) => (
            <li key={i} data-code={e.code}>
              <IssueText issue={e} />
            </li>
          ))}
        </ul>
      ) : null}
      {report.warnings.length ? (
        <>
          <h4 className="cc-h3">{t('themes.report.warnings')}</h4>
          <ul className="cc-theme-issues" data-testid="theme-report-warnings">
            {report.warnings.map((e, i) => (
              <li key={i} data-code={e.code}>
                <IssueText issue={e} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/** The classroom board in miniature: banner, class bar, four student cards, buttons. */
function ClassroomSample() {
  const { t } = useI18n();
  return (
    <div className="cc-theme-sample cc-stack" data-testid="theme-sample-classroom">
      <ThemeBackdrop />
      <div className="cc-row">
        <Mascot size={56} pose="idle" />
        <strong className="cc-theme-sample__title">{t('themes.preview.className')}</strong>
      </div>
      <CounterBar value={4} max={10} label={t('catalog.sampleCounter')} />
      <StudentGrid count={SAMPLE.length} label={t('themes.preview.classroom')}>
        {SAMPLE.map((s) => (
          <StudentCard key={s.id} student={s} weeklyCount={s.weeklyCount} level={levelOf(s.weeklyCount)} onAdd={() => undefined} />
        ))}
      </StudentGrid>
      <div className="cc-row">
        <Button variant="primary">{t('catalog.samplePrimary')}</Button>
        <Button>{t('catalog.sampleSecondary')}</Button>
      </div>
    </div>
  );
}

/** A student's home page in miniature: greeting, mascot and tiles. */
function StudentSample() {
  const { t } = useI18n();
  const tiles: MessageKey[] = ['themes.preview.tile.goals', 'themes.preview.tile.work', 'themes.preview.tile.achievements', 'themes.preview.tile.avatar'];
  return (
    <div className="cc-theme-sample cc-stack" data-testid="theme-sample-student">
      <div className="cc-row">
        <Avatar name={SAMPLE[0].fullName} id={SAMPLE[0].id} size="lg" />
        <strong className="cc-theme-sample__title">{t('themes.preview.hello', { name: 'Ada' })}</strong>
        <Mascot size={56} pose="cheer" />
      </div>
      <div className="cc-theme-sample__tiles">
        {tiles.map((k) => (
          <span key={k} className="cc-menu-tile">
            {t(k)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The Super Speakers board podium in miniature. */
function BoardSample() {
  const { t } = useI18n();
  const places = [
    { place: 2, s: SAMPLE[1], points: 14 },
    { place: 1, s: SAMPLE[0], points: 18 },
    { place: 3, s: SAMPLE[2], points: 11 },
  ];
  return (
    <div className="cc-theme-sample cc-stack" data-testid="theme-sample-board">
      <strong className="cc-theme-sample__title">{t('module.superSpeakers')}</strong>
      <ol className="cc-theme-podium">
        {places.map(({ place, s, points }) => (
          <li key={place} className="cc-theme-podium__place" data-place={place}>
            <Avatar name={s.fullName} id={s.id} size="md" />
            <span>{s.fullName}</span>
            <span className="cc-theme-podium__step">
              <strong>{t('themes.preview.place', { place })}</strong>
              <span>{t('themes.preview.points', { points })}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ContrastTable({ def }: { def: ThemeDefinition }) {
  const { t } = useI18n();
  const rows = CONTRAST_PAIRS.map((p) => ({ ...p, ratio: Math.round(pairContrast(def.colors[p.fg], def.colors[p.bg]) * 100) / 100 }));
  return (
    <DataTable
      stack
      caption={t('themes.preview.contrast')}
      emptyText={t('themes.preview.contrast')}
      rowKey={(r) => `${r.fg}-${r.bg}`}
      rows={rows}
      columns={[
        {
          key: 'sample',
          header: t('themes.contrast.sample'),
          stackRole: 'title',
          // Text pairs show sample text; 3:1 pairs are UI parts (borders, icons, bars), shown as a bar.
          render: (r) =>
            r.min >= AA ? (
              <span className="cc-theme-contrast__sample" style={{ color: `var(--cc-${r.fg})`, background: `var(--cc-${r.bg})` }}>
                {t('themes.contrast.aa')}
              </span>
            ) : (
              <span className="cc-theme-contrast__sample" style={{ background: `var(--cc-${r.bg})` }} aria-hidden="true">
                <span className="cc-theme-contrast__bar" style={{ background: `var(--cc-${r.fg})` }} />
              </span>
            ),
        },
        { key: 'pair', header: t('themes.contrast.pair'), render: (r) => <code>{`${r.fg} / ${r.bg}`}</code> },
        { key: 'ratio', header: t('themes.contrast.ratio'), render: (r) => `${r.ratio}:1`, sortValue: (r) => r.ratio },
        { key: 'min', header: t('themes.contrast.needs'), render: (r) => `${r.min}:1` },
        {
          key: 'ok',
          header: t('themes.contrast.result'),
          render: (r) => (r.ratio >= r.min ? <span className="cc-theme-contrast__ok">✓ {t('themes.contrast.pass')}</span> : <strong className="cc-theme-contrast__fail">⚠ {t('themes.contrast.fail')}</strong>),
        },
      ]}
    />
  );
}

/** Every preview of one theme: classroom, student home, board, mascot and art, celebration, sounds, contrast. */
export function ThemePackagePreview({ themeKey, onClose }: { themeKey: string; onClose?: () => void }) {
  const { t } = useI18n();
  useCustomThemesVersion();
  const def = themeOf(themeKey);
  const labels = useThemeLabels(def);
  const [celebrate, setCelebrate] = useState(0);
  const section = (id: string, title: string, children: ReactNode) => (
    <section className="cc-stack" aria-labelledby={`theme-preview-${id}`}>
      <h4 className="cc-h3" id={`theme-preview-${id}`}>
        {title}
      </h4>
      {children}
    </section>
  );
  return (
    <section className="cc-card cc-stack" aria-labelledby="theme-preview-title" data-testid="theme-package-preview">
      <div className="cc-row cc-theme-preview-head">
        <h3 className="cc-h3" id="theme-preview-title">
          {t('themes.preview.heading', { name: labels.name })}
        </h3>
        {onClose ? <Button onPress={onClose}>{t('themes.preview.close')}</Button> : null}
      </div>
      <p className="cc-muted">{labels.description}</p>
      <ThemeProvider theme={def.key} className="cc-theme-preview-area cc-stack" testId={`theme-preview-area-${def.key}`}>
        <ThemeDecoration size={140} />
        <div className="cc-theme-preview-grid">
          {section('class-board', t('themes.preview.classroom'), <ClassroomSample />)}
          {section('student', t('themes.preview.student'), <StudentSample />)}
          {section('board', t('themes.preview.board'), <BoardSample />)}
          {section('celebration', t('themes.preview.celebration'), (
            <>
              <CelebrationPreview play={celebrate} />
              <Button onPress={() => setCelebrate((n) => n + 1)}>
                <IconPlay />
                {t('themes.preview.playCelebration')}
              </Button>
            </>
          ))}
        </div>
        {section('mascot', t('themes.preview.mascot', { mascot: labels.mascot }), (
          <div className="cc-row">
            {MASCOT_POSES.map((pose) => (
              <figure key={pose} className="cc-catalog-figure">
                <Mascot size={84} pose={pose} />
                <figcaption>{t(`catalog.pose.${pose}`)}</figcaption>
              </figure>
            ))}
            {ILLUSTRATIONS.map((name) => (
              <figure key={name} className="cc-catalog-figure">
                <ThemeIllustration name={name} width={150} />
                <figcaption>{t(`catalog.illustration.${name}`)}</figcaption>
              </figure>
            ))}
          </div>
        ))}
        {section('sounds', t('themes.preview.sounds'), (
          def.sounds ? (
            <div className="cc-row">
              {SOUND_EVENTS.map((e) => (
                <Button key={e} size="small" onPress={() => playThemeSound(getDisplay(), def, e)}>
                  {t(`sound.${e}`)}
                </Button>
              ))}
            </div>
          ) : (
            <p className="cc-muted">{t('themes.issue.SILENT')}</p>
          )
        ))}
        {section('contrast', t('themes.preview.contrast'), <ContrastTable def={def} />)}
      </ThemeProvider>
    </section>
  );
}

function StatusWord({ status }: { status: Th.CustomThemeStatus }) {
  const { t } = useI18n();
  return (
    <span className="cc-theme-status" data-status={status}>
      {status === 'enabled' ? <IconCheck /> : null}
      {t(`themes.status.${status}`)}
    </span>
  );
}

/** Import: file or text → Check package → report → preview → Save as draft (or replace). */
function ImportPanel({ onSaved }: { onSaved: (key: string) => void }) {
  const { t } = useI18n();
  const run = useRun();
  const [source, setSource] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ source: string; report: Report; pkg: Th.PackageDto | null; exists: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = checked?.pkg ? previewKey(checked.pkg.key) : null;

  const check = async () => {
    setBusy(true);
    const r = await run(() => call(Th.validateCustomTheme, { source }));
    setBusy(false);
    if (!r) return;
    setChecked({ source, report: r.report, pkg: r.package, exists: r.exists });
    if (r.package) registerThemePackage(r.package, 'preview', previewKey(r.package.key));
  };
  const save = async () => {
    if (!checked?.pkg) return;
    const key = checked.pkg.key;
    const done = checked.exists
      ? await run(() => call(Th.replaceCustomTheme, { key, source: checked.source }), { success: t('themes.toast.replaced'), invalidate: [THEMES_KEY, AVAILABLE_THEMES_KEY] })
      : await run(() => call(Th.createCustomTheme, { source: checked.source }), { success: t('themes.toast.saved'), invalidate: [THEMES_KEY] });
    if (done) {
      setChecked(null);
      setSource('');
      onSaved(key);
    }
  };
  const stale = checked !== null && checked.source !== source;
  return (
    <section className="cc-card cc-stack" aria-labelledby="theme-import-title">
      <h2 className="cc-h2" id="theme-import-title">
        {t('themes.import.heading')}
      </h2>
      <p className="cc-muted">{t('themes.import.intro')}</p>
      <label className="cc-field">
        <span className="cc-field__label">{t('themes.import.file')}</span>
        <input
          type="file"
          className="cc-file-input"
          accept=".json,application/json"
          data-testid="theme-file"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            setFileError(null);
            if (!file) return;
            if (file.size > PACKAGE_LIMITS.maxBytes) {
              setFileError(t('themes.import.fileTooBig', { limit: Math.round(PACKAGE_LIMITS.maxBytes / 1024) }));
              return;
            }
            setSource(await file.text());
            setChecked(null);
          }}
        />
      </label>
      {fileError ? <Alert kind="danger">{fileError}</Alert> : null}
      <TextArea label={t('themes.import.paste')} description={t('themes.import.pasteHint')} value={source} onChange={setSource} rows={10} />
      <div className="cc-row">
        <Button variant="primary" isDisabled={busy || source.trim() === ''} onPress={() => void check()}>
          <IconCheck />
          {t('themes.import.check')}
        </Button>
        {checked?.pkg && !stale ? (
          <Button variant="primary" onPress={() => void save()} data-testid="theme-save">
            <IconUpload />
            {checked.exists ? t('themes.import.replace', { key: checked.pkg.key }) : t('themes.import.saveDraft')}
          </Button>
        ) : null}
      </div>
      {stale ? <Alert kind="warning">{t('themes.import.changed')}</Alert> : null}
      {checked ? <ReportView report={checked.report} /> : null}
      {preview && getCustomTheme(preview) && !stale ? <ThemePackagePreview themeKey={preview} /> : null}
    </section>
  );
}

export function ThemesPage() {
  const { t, locale } = useI18n();
  const run = useRun();
  const qc = useQueryClient();
  useCustomThemesVersion();
  const q = useQuery({ queryKey: THEMES_KEY, queryFn: () => call(Th.listCustomThemes, {}) });
  const [shown, setShown] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Summary | null>(null);

  const showPreview = async (key: string) => {
    const r = await run(() => call(Th.getCustomTheme, { key }));
    if (r && registerThemePackage(r.package, 'preview', previewKey(key))) setShown(previewKey(key));
  };
  const exportBuiltin = (def: ThemeDefinition) => {
    const key = `${def.key}-copy`;
    download(`${key}.theme.json`, json(packageFromDefinition(def, { key, copyOf: (l, name) => translate(l, 'themes.export.copyName', { name }) })));
  };
  const exportCustom = async (key: string) => {
    const r = await run(() => call(Th.getCustomTheme, { key }));
    if (r) download(`${key}.theme.json`, json(r.package));
  };
  const setStatus = async (s: Summary, enable: boolean) => {
    const ep = enable ? Th.enableCustomTheme : Th.disableCustomTheme;
    const done = await run(() => call(ep, { key: s.key }), { success: t(enable ? 'themes.toast.enabled' : 'themes.toast.disabled'), invalidate: [THEMES_KEY, AVAILABLE_THEMES_KEY] });
    if (done && !enable) removeCustomTheme(s.key);
  };
  const themes = q.data?.themes ?? [];
  return (
    <main className="cc-page cc-stack" data-testid="admin-themes">
      <h1 className="cc-h1">{t('themes.title')}</h1>
      <p className="cc-muted">{t('themes.intro')}</p>

      <section className="cc-card cc-stack" aria-labelledby="builtin-themes-title">
        <h2 className="cc-h2" id="builtin-themes-title">
          {t('themes.builtin.heading')}
        </h2>
        <ul className="cc-theme-catalogue">
          {THEME_LIST.map((def) => (
            <li key={def.key} className="cc-stack">
              <ThemePreview theme={def.key} compact />
              <div className="cc-row">
                <span className="cc-muted">{t(def.key === DEFAULT_THEME ? 'themes.builtin.default' : 'themes.builtin.badge')}</span>
                <Button size="small" onPress={() => setShown(def.key)}>
                  {t('themes.action.preview')}
                </Button>
                <Button size="small" onPress={() => exportBuiltin(def)}>
                  <IconFile />
                  {t('themes.action.export')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="cc-card cc-stack" aria-labelledby="custom-themes-title">
        <h2 className="cc-h2" id="custom-themes-title">
          {t('themes.imported.heading')}
        </h2>
        <p className="cc-muted">{t('themes.imported.intro', { limit: q.data?.limit ?? PACKAGE_LIMITS.maxCustomThemes })}</p>
        <DataTable
          stack
          caption={t('themes.imported.heading')}
          emptyText={t('themes.imported.empty')}
          rows={themes}
          rowKey={(r) => r.key}
          columns={[
            { key: 'name', header: t('themes.col.name'), stackRole: 'title', render: (r) => r.name[locale], sortValue: (r) => r.name[locale] },
            { key: 'key', header: t('themes.col.key'), render: (r) => <code>{r.key}</code> },
            { key: 'status', header: t('themes.col.status'), render: (r) => <StatusWord status={r.status} /> },
            {
              key: 'used',
              header: t('themes.col.usedBy'),
              render: (r) => [t('themes.usedBy.classes', { count: r.classCount }), r.board ? t('themes.usedBy.board') : null].filter(Boolean).join(' · '),
            },
            {
              key: 'actions',
              header: t('themes.col.actions'),
              render: (r) => (
                <div className="cc-row">
                  <Button size="small" onPress={() => void showPreview(r.key)}>
                    {t('themes.action.preview')}
                  </Button>
                  {r.status === 'enabled' ? (
                    <Button size="small" variant="danger-outline" onPress={() => void setStatus(r, false)}>
                      {t('themes.action.disable')}
                    </Button>
                  ) : (
                    <Button size="small" variant="primary" onPress={() => void setStatus(r, true)} data-testid={`theme-enable-${r.key}`}>
                      {t('themes.action.enable')}
                    </Button>
                  )}
                  <Button size="small" onPress={() => void exportCustom(r.key)}>
                    <IconFile />
                    {t('themes.action.export')}
                  </Button>
                  <Button size="small" variant="danger" onPress={() => setDeleting(r)}>
                    <IconTrash />
                    {t('themes.action.delete')}
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </section>

      {shown ? <ThemePackagePreview themeKey={shown} onClose={() => setShown(null)} /> : null}

      <ImportPanel onSaved={(key) => void showPreview(key)} />

      <ConfirmDestructive
        isOpen={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('themes.delete.title', { name: deleting?.name[locale] ?? '' })}
        description={t(deleting?.board ? 'themes.delete.descriptionBoard' : 'themes.delete.description', { count: deleting?.classCount ?? 0, theme: translate(locale, `theme.${DEFAULT_THEME}`) })}
        confirmText={deleting?.key ?? ''}
        actionLabel={t('themes.action.delete')}
        onConfirm={async () => {
          if (!deleting) return;
          const key = deleting.key;
          await call(Th.deleteCustomTheme, { key, confirm: key });
          removeCustomTheme(key);
          removeCustomTheme(previewKey(key));
          if (shown === previewKey(key)) setShown(null);
          setDeleting(null);
          await qc.invalidateQueries({ queryKey: THEMES_KEY });
          await qc.invalidateQueries({ queryKey: AVAILABLE_THEMES_KEY });
          showToast({ message: t('themes.toast.deleted'), kind: 'success' });
        }}
      />
    </main>
  );
}
