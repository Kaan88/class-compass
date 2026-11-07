/** Audit log viewer (ACC-9, DAT-5). Secrets are already stripped by the server. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Admin from '../../../shared/contracts/admin.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { TextField } from '../../ui/Fields.tsx';
import { DataTable } from '../../ui/Layout.tsx';
import { ADMIN } from './Admin.tsx';

const show = (v: unknown) => (v === null || v === undefined ? '' : JSON.stringify(v, null, 2));

export function AuditPage() {
  const { t, locale } = useI18n();
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const audit = useQuery({
    queryKey: [...ADMIN, 'audit', entity, action, page],
    queryFn: () => call(Admin.queryAudit, { entity: entity || undefined, action: action || undefined, page, pageSize }),
  });
  const fmt = new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'medium' });
  const total = audit.data?.total ?? 0;
  return (
    <main className="cc-page cc-stack">
      <h1 className="cc-h1">{t('admin.audit')}</h1>
      <p className="cc-muted">{t('audit.explain')}</p>
      <div className="cc-row">
        <TextField
          label={t('audit.entity')}
          value={entity}
          onChange={(v) => {
            setEntity(v);
            setPage(1);
          }}
          placeholder="user"
        />
        <TextField
          label={t('audit.action')}
          value={action}
          onChange={(v) => {
            setAction(v);
            setPage(1);
          }}
          placeholder="user.create"
        />
      </div>
      <DataTable
        caption={t('audit.caption', { count: total })}
        rows={audit.data?.items ?? []}
        rowKey={(i) => i.id}
        emptyText={audit.isLoading ? t('common.loading') : t('audit.none')}
        columns={[
          { key: 'at', header: t('audit.when'), render: (i) => fmt.format(i.at) },
          { key: 'actor', header: t('audit.who'), render: (i) => i.actorName ?? t(i.actorType === 'system' ? 'audit.system' : 'audit.unknown') },
          { key: 'action', header: t('audit.action'), render: (i) => <code>{i.action}</code> },
          { key: 'entity', header: t('audit.entity'), render: (i) => <code>{i.entity}</code> },
          {
            key: 'change',
            header: t('audit.change'),
            render: (i) =>
              i.before || i.after ? (
                <details>
                  <summary>{t('audit.details')}</summary>
                  {i.before ? (
                    <>
                      <strong>{t('audit.before')}</strong>
                      <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{show(i.before)}</pre>
                    </>
                  ) : null}
                  {i.after ? (
                    <>
                      <strong>{t('audit.after')}</strong>
                      <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{show(i.after)}</pre>
                    </>
                  ) : null}
                </details>
              ) : null,
          },
        ]}
      />
      <div className="cc-row">
        <Button isDisabled={page <= 1} onPress={() => setPage((p) => p - 1)}>
          {t('common.previous')}
        </Button>
        <span>{t('common.pageOf', { page, pages: Math.max(1, Math.ceil(total / pageSize)) })}</span>
        <Button isDisabled={page * pageSize >= total} onPress={() => setPage((p) => p + 1)}>
          {t('common.next')}
        </Button>
      </div>
    </main>
  );
}
