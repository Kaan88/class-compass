/** Shell pieces: ClassBanner (LES-4, DSH-1/2), DisplayBanner (PIN-5), ClassSwitcher (LES-4), DataTable. */
import { useMemo, useState, type ReactNode } from 'react';
import { pickText } from '../../shared/i18n/index.ts';
import type { LocalizedTextValue } from '../../shared/contracts/define.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from './Button.tsx';
import { IconBoard, IconCheck, IconLock, IconPlay } from './icons.tsx';
import { Mascot, ThemeDecoration } from './Mascot.tsx';

/**
 * Header of a classroom panel (usability pass, D-139): an optional icon and the title on one line, the
 * actions on the right; the actions wrap under the title only when the panel is too narrow.
 */
export function PanelHead({ id, title, icon, children }: { id: string; title: ReactNode; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className="cc-panel-head">
      <h2 id={id} className="cc-h2 cc-panel-head__title">
        {icon}
        <span>{title}</span>
      </h2>
      {children ? <div className="cc-panel-head__actions">{children}</div> : null}
    </div>
  );
}

/** Always names the active class AND subject, so nothing is recorded against the wrong class (LES-4). */
export function ClassBanner({
  className,
  subjectName,
  dateLabel,
  dayLabel,
  children,
  showMascot = true,
}: {
  className: string;
  subjectName: LocalizedTextValue;
  dateLabel?: string;
  dayLabel?: string;
  children?: ReactNode;
  showMascot?: boolean;
}) {
  const { t, locale } = useI18n();
  return (
    <header className="cc-classbanner" aria-label={t('classroom.activeClass')}>
      <ThemeDecoration size={180} />
      {showMascot ? <Mascot size={84} /> : null}
      <div>
        <div className="cc-classbanner__class" data-testid="class-banner-class">
          {className}
        </div>
        <div className="cc-classbanner__subject" data-testid="class-banner-subject">
          {pickText(subjectName, locale)}
        </div>
      </div>
      {children}
      {dateLabel ? (
        <div className="cc-classbanner__date">
          {dayLabel ? <div>{dayLabel}</div> : null}
          <div>{dateLabel}</div>
        </div>
      ) : null}
    </header>
  );
}

/** Persistent warning that the teacher area is visible on the classroom display (PIN-5). */
export function DisplayBanner({ onLock, onClassroom }: { onLock: () => void; onClassroom: () => void }) {
  const { t } = useI18n();
  return (
    <div className="cc-display-banner" role="region" aria-label={t('pin.visibleOnDisplay')} data-testid="display-banner">
      <IconBoard />
      <span className="cc-display-banner__text">{t('pin.visibleOnDisplay')}</span>
      <Button size="small" variant="primary" onPress={onLock}>
        <IconLock />
        {t('pin.lockNow')}
      </Button>
      <Button size="small" onPress={onClassroom}>
        {t('teacher.backToClassroom')}
      </Button>
    </div>
  );
}

export interface SwitchableContext {
  id: string;
  className: string;
  subjectName: LocalizedTextValue;
}

/**
 * Quick class switching (LES-4): one tap per class+subject, the active one marked by text and state.
 * `inProgress` marks contexts with a running lesson (icon + text, not colour alone).
 */
export function ClassSwitcher({
  contexts,
  activeId,
  onSwitch,
  inProgress,
}: {
  contexts: SwitchableContext[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  inProgress?: ReadonlySet<string>;
}) {
  const { t, locale } = useI18n();
  return (
    <nav className="cc-class-switcher" aria-label={t('classroom.switchClass')}>
      {contexts.map((c) => (
        <Button key={c.id} aria-pressed={c.id === activeId} onPress={() => onSwitch(c.id)}>
          {/* The active class is marked by an icon and visible text, not by colour alone (UX-7, LES-4). */}
          {c.id === activeId ? <IconCheck /> : null}
          {c.className} · {pickText(c.subjectName, locale)}
          {c.id === activeId ? <span className="cc-class-switcher__current">{t('classroom.current')}</span> : null}
          {inProgress?.has(c.id) ? (
            <span className="cc-class-switcher__live" data-testid="lesson-in-progress">
              <IconPlay />
              {t('lesson.inProgress')}
            </span>
          ) : null}
        </Button>
      ))}
    </nav>
  );
}

export interface Column<R> {
  key: string;
  header: string;
  render: (row: R) => ReactNode;
  /** When given, the header becomes a sort button. */
  sortValue?: (row: R) => string | number;
  /**
   * Only for `stack` tables, below 52rem: 'title' shows the cell as the card's heading line (no
   * label), 'hidden' leaves a column out of the card (a detail that only fits on a wide screen).
   */
  stackRole?: 'title' | 'hidden';
}

/**
 * Simple, keyboard-accessible data table: real <table>, sortable headers are buttons with aria-sort.
 * `stack`: below 52rem every row becomes a card of "label: value" lines with its actions at the bottom
 * (admin tables on phones and tablets), instead of a table that scrolls sideways out of view.
 */
export function DataTable<R>({
  columns,
  rows,
  rowKey,
  caption,
  emptyText,
  stack = false,
  compact = false,
}: {
  columns: Column<R>[];
  rows: R[];
  rowKey: (r: R) => string;
  caption: string;
  emptyText: string;
  stack?: boolean;
  /** With `stack`: short "label value" pairs flow side by side in the card (rows of small counts). */
  compact?: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    if (!sort || !col?.sortValue) return rows;
    const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : collator.compare(String(va), String(vb));
      return c * sort.dir;
    });
  }, [rows, columns, sort]);
  return (
    <div className={stack ? 'cc-table-wrap cc-table-wrap--stack' : 'cc-table-wrap'}>
      <table className={stack ? `cc-table cc-table--stack${compact ? ' cc-table--compact' : ''}` : 'cc-table'}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={[c.sortValue ? null : 'cc-table__th--plain', c.stackRole === 'hidden' ? 'cc-table__wide-only' : null].filter(Boolean).join(' ') || undefined} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                {c.sortValue ? (
                  <button type="button" className="cc-table__sort" onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === 1 ? -1 : 1 }))}>
                    {c.header}
                    <span aria-hidden="true">{sort?.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
                  </button>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="cc-muted">
                {emptyText}
              </td>
            </tr>
          ) : (
            sorted.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td key={c.key} data-label={c.header} className={c.key === 'actions' ? 'cc-table__actions' : c.stackRole === 'title' ? 'cc-table__title' : c.stackRole === 'hidden' ? 'cc-table__wide-only' : undefined}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
