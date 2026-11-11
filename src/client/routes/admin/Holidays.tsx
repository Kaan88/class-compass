/**
 * Admin → School holidays (S25b, D-186): the holiday calendar of each school year. Named closures with a
 * date range (add, change, delete) and "Add Turkish public holidays for this school year" (the built-in
 * fixed-date national holidays only; religious holidays move every year and are added by hand). Reports,
 * the Daily Assistant and the demo history leave closure days out of school-day counts; the classroom
 * shows a calm note on such a day and still lets a teacher start a lesson.
 */
import '../../../shared/i18n/areas/holidays.ts';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import * as S from '../../../shared/contracts/school.ts';
import { formatDay, pickText } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { errorText } from '../../lib/errors.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { showToast } from '../../lib/toast.ts';
import { useRun } from '../../lib/useRun.ts';
import { Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select, TextField } from '../../ui/Fields.tsx';
import { IconCalendar, IconPlus } from '../../ui/icons.tsx';
import { InlineConfirmButton } from '../../ui/InlineConfirm.tsx';
import { DataTable } from '../../ui/Layout.tsx';
import { ADMIN } from './Admin.tsx';

type Year = z.infer<typeof S.SchoolYear>;
type Closure = S.Closure;

const YEARS_KEY = [...ADMIN, 'years'];
const closuresKey = (yearId: string) => [...ADMIN, 'closures', yearId];

/** The school year containing today, else the newest one that is not archived, else the newest. */
function defaultYear(years: readonly Year[]): Year | undefined {
  // Only picks which year the page opens on; nothing is decided by the device clock.
  const today = new Date().toISOString().slice(0, 10);
  return years.find((y) => y.startsOn <= today && today <= y.endsOn) ?? [...years].reverse().find((y) => !y.archived) ?? years[years.length - 1];
}

function Dates({ from, to }: { from: string; to: string }) {
  const { locale } = useI18n();
  if (from === to) return <span className="cc-nowrap">{formatDay(from, locale)}</span>;
  return (
    <span className="cc-date-range">
      <span className="cc-nowrap">{formatDay(from, locale)}</span> – <span className="cc-nowrap">{formatDay(to, locale)}</span>
    </span>
  );
}

function ClosureForm({ year, closure, onDone }: { year: Year; closure?: Closure; onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [en, setEn] = useState(closure?.name.en ?? '');
  const [tr, setTr] = useState(closure?.name.tr ?? '');
  const [startsOn, setStartsOn] = useState(closure?.startsOn ?? '');
  const [endsOn, setEndsOn] = useState(closure?.endsOn ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="cc-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const name = { en: en.trim() || undefined, tr: tr.trim() || undefined };
        const end = endsOn || startsOn;
        try {
          if (closure) await call(S.updateClosure, { closureId: closure.id, name, startsOn, endsOn: end });
          else await call(S.createClosure, { yearId: year.id, name, startsOn, endsOn: end });
          void qc.invalidateQueries({ queryKey: closuresKey(year.id) });
          showToast({ message: t('holidays.saved'), kind: 'success' });
          onDone();
        } catch (err) {
          setError(errorText(t, err));
        }
      }}
    >
      <p className="cc-muted">{t('holidays.nameHint')}</p>
      <div className="cc-row">
        <TextField label={t('common.nameEn')} value={en} onChange={setEn} />
        <TextField label={t('common.nameTr')} value={tr} onChange={setTr} />
      </div>
      <div className="cc-row">
        <TextField label={t('common.startDate')} type="date" value={startsOn} onChange={setStartsOn} isRequired />
        <TextField label={t('common.endDate')} type="date" value={endsOn} onChange={setEndsOn} description={t('holidays.oneDay')} />
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

export function HolidaysPage() {
  const { t, locale } = useI18n();
  const run = useRun();
  const years = useQuery({ queryKey: YEARS_KEY, queryFn: () => call(S.listYears, {}) });
  const list = years.data?.years ?? [];
  const [yearId, setYearId] = useState<string>('');
  useEffect(() => {
    if (!yearId && list.length) setYearId(defaultYear(list)?.id ?? '');
  }, [yearId, list]);
  const year = list.find((y) => y.id === yearId);
  const closures = useQuery({ queryKey: closuresKey(yearId), queryFn: () => call(S.listClosures, { yearId }), enabled: Boolean(yearId) });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Closure | null>(null);
  const readOnly = year?.archived ?? true;

  const addedText = (added: number, skipped: number) => {
    const a = added === 1 ? t('holidays.public.added.one') : t('holidays.public.added', { count: added });
    if (!skipped) return a;
    return `${a} ${skipped === 1 ? t('holidays.public.skipped.one') : t('holidays.public.skipped', { count: skipped })}`;
  };
  const addPublic = async () => {
    if (!year) return;
    const r = await run(() => call(S.addPublicHolidays, { yearId: year.id }), { invalidate: [closuresKey(year.id)] });
    if (r) showToast({ message: r.added ? addedText(r.added, r.skipped) : t('holidays.public.nothing'), kind: 'success' });
  };
  const daysText = (n: number) => (n === 0 ? t('holidays.schoolDays.zero') : n === 1 ? t('holidays.schoolDays.one') : t('holidays.schoolDays', { count: n }));

  return (
    <main className="cc-page cc-stack">
      <h1 className="cc-h1">{t('holidays.title')}</h1>
      <p className="cc-muted">{t('holidays.intro')}</p>
      {years.isSuccess && !list.length ? <EmptyState title={t('holidays.title')} body={t('holidays.noYears')} /> : null}
      {list.length ? (
        <Select label={t('holidays.year')} items={list.map((y) => ({ id: y.id, label: y.name }))} value={yearId} onChange={setYearId} />
      ) : null}
      {year ? (
        <>
          {year.archived ? <Alert kind="warning">{t('holidays.archived')}</Alert> : null}
          {!readOnly ? (
            <section className="cc-card cc-stack" aria-labelledby="cc-holidays-public">
              <h2 id="cc-holidays-public" className="cc-h2">
                {t('holidays.public.title')}
              </h2>
              <p>{t('holidays.public.explain')}</p>
              <p className="cc-muted">{t('holidays.public.religious')}</p>
              <div className="cc-row">
                <Button onPress={() => void addPublic()}>
                  <IconCalendar />
                  {t('holidays.public.button')}
                </Button>
              </div>
            </section>
          ) : null}
          <section className="cc-card cc-stack" aria-label={t('holidays.listCaption', { year: year.name })}>
            {!readOnly ? (
              <div className="cc-row">
                <Button variant="primary" onPress={() => setAdding(true)}>
                  <IconPlus />
                  {t('holidays.add')}
                </Button>
              </div>
            ) : null}
            <DataTable
              stack
              caption={t('holidays.listCaption', { year: year.name })}
              rows={closures.data?.closures ?? []}
              rowKey={(c) => c.id}
              emptyText={t('holidays.none')}
              columns={[
                { key: 'name', header: t('holidays.col.name'), render: (c) => pickText(c.name, locale), stackRole: 'title' },
                { key: 'dates', header: t('holidays.col.dates'), render: (c) => <Dates from={c.startsOn} to={c.endsOn} />, sortValue: (c) => c.startsOn },
                { key: 'days', header: t('holidays.col.schoolDays'), render: (c) => daysText(c.schoolDays) },
                {
                  key: 'actions',
                  header: t('common.actions'),
                  render: (c) =>
                    readOnly ? null : (
                      <div className="cc-row">
                        <Button size="small" onPress={() => setEditing(c)}>
                          {t('common.edit')}
                        </Button>
                        <InlineConfirmButton
                          size="small"
                          variant="danger-outline"
                          message={t('holidays.deleteAsk', { name: pickText(c.name, locale) })}
                          confirmLabel={t('common.delete')}
                          cancelLabel={t('common.cancel')}
                          onConfirm={() => void run(() => call(S.deleteClosure, { closureId: c.id }), { invalidate: [closuresKey(year.id)], success: t('holidays.deleted') })}
                        >
                          {t('common.delete')}
                        </InlineConfirmButton>
                      </div>
                    ),
                },
              ]}
            />
          </section>
          <Modal isOpen={adding} onOpenChange={setAdding} title={t('holidays.add')}>
            <ClosureForm year={year} onDone={() => setAdding(false)} />
          </Modal>
          <Modal isOpen={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={t('holidays.edit')}>
            {editing ? <ClosureForm year={year} closure={editing} onDone={() => setEditing(null)} /> : null}
          </Modal>
        </>
      ) : null}
    </main>
  );
}
