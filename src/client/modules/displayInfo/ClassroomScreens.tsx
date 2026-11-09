/** Admin → Maintenance → Classroom screens (S16c, D-165): the last screen each teacher's board saw. Read-only. */
import { useQuery } from '@tanstack/react-query';
import * as C from '../../../shared/contracts/displayInfo.ts';
import { dateTimeFormat } from '../../../shared/intl.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { DataTable } from '../../ui/Layout.tsx';

const size = (w: number, h: number) => `${w} × ${h}`;

export function ClassroomScreens() {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: ['sensitive', 'admin', 'displayInfo'], queryFn: () => call(C.adminDisplayInfo, {}) });
  const fmt = dateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const yesNo = (v: boolean) => (v ? t('displayInfo.yes') : t('displayInfo.no'));
  return (
    <section className="cc-stack" aria-labelledby="display-info-title" data-testid="display-info">
      <h2 className="cc-h2" id="display-info-title">
        {t('displayInfo.title')}
      </h2>
      <p className="cc-muted">{t('displayInfo.intro')}</p>
      {q.isError ? <Alert>{t('displayInfo.loadError')}</Alert> : null}
      <DataTable
        stack
        caption={t('displayInfo.caption')}
        emptyText={q.isLoading ? t('displayInfo.loading') : t('displayInfo.empty')}
        rows={q.data?.teachers ?? []}
        rowKey={(r) => r.userId}
        columns={[
          { key: 'name', header: t('displayInfo.col.teacher'), stackRole: 'title', render: (r) => r.displayName, sortValue: (r) => r.displayName },
          { key: 'seen', header: t('displayInfo.col.seen'), render: (r) => fmt.format(r.last.seenAt), sortValue: (r) => r.last.seenAt },
          { key: 'window', header: t('displayInfo.col.window'), render: (r) => size(r.last.innerWidth, r.last.innerHeight) },
          { key: 'screen', header: t('displayInfo.col.screen'), render: (r) => size(r.last.screenWidth, r.last.screenHeight) },
          { key: 'ratio', header: t('displayInfo.col.ratio'), render: (r) => String(r.last.pixelRatio) },
          { key: 'browser', header: t('displayInfo.col.browser'), render: (r) => `${r.last.browser} · ${r.last.os}` },
          { key: 'touch', header: t('displayInfo.col.touch'), render: (r) => yesNo(r.last.touch) },
          { key: 'text', header: t('displayInfo.col.textScale'), render: (r) => `${r.last.textScale} %` },
          {
            key: 'board',
            header: t('displayInfo.col.board'),
            render: (r) =>
              [
                r.last.density ? t(`displayInfo.density.${r.last.density}`) : null,
                r.last.layout ? t(`displayInfo.layout.${r.last.layout}`) : null,
                r.last.theme,
                r.last.reducedMotion ? t('displayInfo.reducedMotion') : null,
              ]
                .filter(Boolean)
                .join(' · '),
          },
          {
            key: 'recent',
            header: t('displayInfo.col.recent'),
            render: (r) => (
              <ul>
                {r.recent.map((s) => (
                  <li key={`${s.innerWidth}-${s.innerHeight}-${s.screenWidth}-${s.screenHeight}-${s.pixelRatio}`}>
                    {t('displayInfo.recentItem', { window: size(s.innerWidth, s.innerHeight), screen: size(s.screenWidth, s.screenHeight), ratio: String(s.pixelRatio), seen: fmt.format(s.seenAt) })}
                  </li>
                ))}
              </ul>
            ),
          },
        ]}
      />
    </section>
  );
}
