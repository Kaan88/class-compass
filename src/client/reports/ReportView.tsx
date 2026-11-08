/**
 * Renders report sections (D-091) the same way everywhere: labelled metrics, tables of typed cells,
 * accessible SVG charts drawn FROM the table (the table below is the chart's data table), CSV links
 * and a printable A4 layout. RPT-5: "not recorded", "absent" and "not in the class" are words with
 * their own look, never 0; counts show what they are out of.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { ReportCell, ReportChart, ReportLabel, ReportSection, ReportTable } from '../../shared/contracts/reports.ts';
import { chartValue, reportCellText, reportLabelText } from '../../shared/reportText.ts';
import { useI18n } from '../lib/i18n.tsx';
import { ellipsis, labelLayout, rowLabels } from './chartLabels.ts';
import { formatDay } from '../../shared/i18n/index.ts';

export function useLabel() {
  const { locale } = useI18n();
  return (l: ReportLabel) => reportLabelText(l, locale);
}

/** One cell (RPT-5): a count with its denominator, or a word for not recorded / absent / not applicable. */
export function CellView({ cell }: { cell: ReportCell }) {
  const { locale } = useI18n();
  switch (cell.t) {
    case 'n':
      return (
        <span className="cc-metric" data-state="value">
          {cell.v}
          {cell.d !== undefined && cell.d !== null ? <span className="cc-metric__den"> / {cell.d}</span> : null}
        </span>
      );
    case 'nr':
      return (
        <span className="cc-metric" data-state="not-recorded">
          — {reportCellText(cell, locale)}
        </span>
      );
    case 'absent':
      return (
        <span className="cc-metric" data-state="absent">
          {reportCellText(cell, locale)}
        </span>
      );
    case 'na':
      return (
        <span className="cc-metric" data-state="not-applicable">
          {reportCellText(cell, locale)}
        </span>
      );
    case 'days':
      return (
        <span className="cc-metric" data-state={cell.v === null ? 'not-recorded' : 'value'}>
          {reportCellText(cell, locale)}
        </span>
      );
    default:
      return <>{reportCellText(cell, locale)}</>;
  }
}

/** Fills for up to four series: shape and pattern differ, not only colour (WCAG 1.4.1). */
const SERIES = ['solid', 'hatch', 'dots', 'outline'] as const;

function SeriesSwatch({ i, patternId }: { i: number; patternId: string }) {
  const kind = SERIES[i]!;
  return (
    <svg width="18" height="12" aria-hidden="true" focusable="false" className="cc-chart__swatch">
      <rect x="0.5" y="0.5" width="17" height="11" className={`cc-chart__bar cc-chart__bar--${kind}`} fill={kind === 'hatch' || kind === 'dots' ? `url(#${patternId}-${kind})` : undefined} />
    </svg>
  );
}

/** Width of an element in CSS px (the chart is drawn 1:1, so its text is never scaled below 12px). */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const TICK_PX = 12;

/** Bar or line chart of a table (count cells only; gaps for not recorded / absent / not applicable). */
export function ChartView({ table, chart }: { table: ReportTable; chart: ReportChart }) {
  const label = useLabel();
  const { locale } = useI18n();
  const uid = useId().replace(/:/gu, '');
  const [figRef, measured] = useWidth<HTMLElement>(640);
  const labelIdx = table.columns.findIndex((c) => c.key === chart.labelColumn);
  const valueIdx = chart.valueColumns.map((k) => table.columns.findIndex((c) => c.key === k)).filter((i) => i >= 0);
  const rows = table.rows.slice(0, 60);
  if (labelIdx < 0 || !valueIdx.length || !rows.length) return null;
  const values = rows.map((r) => valueIdx.map((i) => chartValue(r.cells[i])));
  const max = Math.max(1, ...values.flat().map((v) => v ?? 0));
  const W = Math.max(280, Math.min(measured, 768));
  const axis = rowLabels(table, rows, labelIdx, locale);
  const layout = labelLayout(axis, W - 44, TICK_PX);
  const H = 200 + (layout.rotate ? Math.round(layout.maxChars * TICK_PX * 0.45) : 0);
  const pad = { l: 36, r: 8, t: 10, b: layout.rotate ? H - 170 : 30 };
  const band = (W - pad.l - pad.r) / rows.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const names = valueIdx.map((i) => label(table.columns[i]!.label));
  const title = `${table.about ? `${label(table.about)} – ` : ''}${label(table.title)}`;
  const ticks = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <figure className="cc-chart" ref={figRef}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-labelledby={`${uid}-t`} className="cc-chart__svg" preserveAspectRatio="xMinYMin meet">
        <title id={`${uid}-t`}>{title}</title>
        <defs>
          <pattern id={`${uid}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="cc-chart__pattern" strokeWidth="3" />
          </pattern>
          <pattern id={`${uid}-dots`} width="5" height="5" patternUnits="userSpaceOnUse">
            <circle cx="2.5" cy="2.5" r="1.4" className="cc-chart__dot" />
          </pattern>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="cc-chart__grid" />
            <text x={pad.l - 4} y={y(v) + 4} textAnchor="end" className="cc-chart__tick">
              {v}
            </text>
          </g>
        ))}
        {chart.kind === 'bar'
          ? rows.map((r, ri) => {
              const w = (band * 0.8) / valueIdx.length;
              return values[ri]!.map((v, si) => {
                if (v === null) return null;
                const kind = SERIES[si]!;
                const x = pad.l + ri * band + band * 0.1 + si * w;
                return (
                  <rect
                    key={`${r.key}-${si}`}
                    x={x}
                    y={y(v)}
                    width={Math.max(1, w - 1)}
                    height={Math.max(0, H - pad.b - y(v))}
                    className={`cc-chart__bar cc-chart__bar--${kind}`}
                    fill={kind === 'hatch' || kind === 'dots' ? `url(#${uid}-${kind})` : undefined}
                  >
                    <title>{`${axis[ri]} – ${names[si]}: ${v}`}</title>
                  </rect>
                );
              });
            })
          : valueIdx.map((_, si) => {
              const pts = rows.map((r, ri) => ({ v: values[ri]![si] ?? null, x: pad.l + ri * band + band / 2, r }));
              const segments: string[] = [];
              let cur = '';
              for (const p of pts) {
                if (p.v === null) {
                  if (cur) segments.push(cur);
                  cur = '';
                } else cur += `${cur ? 'L' : 'M'}${p.x.toFixed(1)},${y(p.v).toFixed(1)}`;
              }
              if (cur) segments.push(cur);
              return (
                <g key={si} className={`cc-chart__series cc-chart__series--${SERIES[si]}`}>
                  {segments.map((d) => (
                    <path key={d} d={d} className="cc-chart__line" />
                  ))}
                  {pts.map((p) =>
                    p.v === null ? null : (
                      <circle key={p.r.key} cx={p.x} cy={y(p.v)} r="3.5" className="cc-chart__point">
                        <title>{`${axis[rows.indexOf(p.r)]} – ${names[si]}: ${p.v}`}</title>
                      </circle>
                    ),
                  )}
                </g>
              );
            })}
        {rows.map((r, ri) => {
          if (ri % layout.step !== 0) return null;
          const x = pad.l + ri * band + band / 2;
          const y0 = H - pad.b + 16;
          const full = axis[ri]!;
          return (
            <text
              key={r.key}
              x={x}
              y={y0}
              textAnchor={layout.rotate ? 'end' : 'middle'}
              transform={layout.rotate ? `rotate(-40 ${x} ${y0})` : undefined}
              className="cc-chart__tick"
            >
              {ellipsis(full, layout.maxChars)}
              <title>{full}</title>
            </text>
          );
        })}
      </svg>
      {names.length > 1 ? (
        <figcaption className="cc-chart__legend">
          {names.map((n, i) => (
            <span key={n} className="cc-chart__key">
              <SeriesSwatch i={i} patternId={uid} />
              {n}
            </span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** A column header; a week column ("2026-10-05 – 2026-10-11") reads "5 Oct – 11 Oct", each date unbroken. */
function ColumnLabel({ l }: { l: ReportLabel }) {
  const label = useLabel();
  const { locale } = useI18n();
  if ('k' in l && l.k === 'report.col.weekRange' && typeof l.p?.from === 'string' && typeof l.p.to === 'string') {
    return (
      <>
        <span className="cc-nowrap">{formatDay(l.p.from, locale, { year: false })}</span> – <span className="cc-nowrap">{formatDay(l.p.to, locale, { year: false })}</span>
      </>
    );
  }
  return <>{label(l)}</>;
}

export function TableView({ table, csvHref }: { table: ReportTable; csvHref?: string | undefined }) {
  const label = useLabel();
  const { t } = useI18n();
  return (
    <div className="cc-report-table cc-stack">
      <div className="cc-row">
        <h4 className="cc-h3">
          {table.about ? <span className="cc-report__about">{label(table.about)} · </span> : null}
          {label(table.title)}
        </h4>
        {csvHref ? (
          <a className="cc-btn cc-btn--ghost cc-push-right cc-noprint" href={csvHref} download>
            {t('report.ui.csv')}
          </a>
        ) : null}
      </div>
      {table.note ? <p className="cc-muted">{label(table.note)}</p> : null}
      {table.chart ? <ChartView table={table} chart={table.chart} /> : null}
      <div className="cc-table-wrap">
        <table className="cc-table">
          <caption className="cc-visually-hidden">{label(table.title)}</caption>
          <thead>
            <tr>
              {table.columns.map((c) => (
                <th key={c.key} scope="col" className={c.numeric ? 'cc-num' : undefined}>
                  <ColumnLabel l={c.label} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 ? (
              <tr>
                <td colSpan={table.columns.length} className="cc-muted">
                  {t('report.ui.noRows')}
                </td>
              </tr>
            ) : (
              table.rows.map((r) => (
                <tr key={r.key}>
                  {r.cells.map((c, i) =>
                    i === 0 ? (
                      <th key={i} scope="row">
                        <CellView cell={c} />
                      </th>
                    ) : (
                      <td key={i} className={table.columns[i]?.numeric ? 'cc-num' : undefined}>
                        <CellView cell={c} />
                      </td>
                    ),
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SectionView({ section, csvHref }: { section: ReportSection; csvHref?: ((table: string) => string) | undefined }) {
  const label = useLabel();
  return (
    <section className="cc-card cc-stack cc-report-section" aria-labelledby={`sec-${section.key}`}>
      <h3 className="cc-h2" id={`sec-${section.key}`}>
        {label(section.title)}
      </h3>
      {section.intro ? <p className="cc-muted">{label(section.intro)}</p> : null}
      {section.metrics.length ? (
        <dl className="cc-report-metrics">
          {section.metrics.map((m) => (
            <div key={m.key} className="cc-report-metric">
              <dt>{label(m.label)}</dt>
              <dd>
                <CellView cell={m.cell} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {section.tables.map((tb) => (
        <TableView key={tb.key} table={tb} csvHref={csvHref?.(tb.key)} />
      ))}
      {section.notes.length ? (
        <ul className="cc-report-notes">
          {section.notes.map((n, i) => (
            <li key={i}>{label(n)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
