/**
 * Admin → Import students (S16a, D-163; IMP-1..7 for administrators). The same importer as the
 * teacher page (`Importer`), but the administrator picks any class of an open school year and sees
 * which classes are still empty, so every class can be filled before teachers start.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as S from '../../../shared/contracts/school.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { DataTable } from '../../ui/Layout.tsx';
import { IconAlert, IconCheck } from '../../ui/icons.tsx';
import { Importer } from '../teacher/Import.tsx';
import { ADMIN } from './Admin.tsx';

export function AdminImportPage() {
  const { t } = useI18n();
  const classes = useQuery({ queryKey: [...ADMIN, 'classes', 'current'], queryFn: () => call(S.listClasses, {}) });
  const settings = useQuery({ queryKey: [...ADMIN, 'settings'], queryFn: () => call(S.getSettings, {}) });
  const open = useMemo(() => (classes.data?.classes ?? []).filter((c) => !c.archived && !c.yearArchived), [classes.data]);
  const [classId, setClassId] = useState('');
  const empty = open.filter((c) => c.studentCount === 0);
  const items = open.map((c) => ({ id: c.id, name: c.name, label: t('admin.importClassLabel', { name: c.name, count: c.studentCount }) }));
  return (
    <main className="cc-page cc-stack" data-testid="admin-import-page">
      <h1 className="cc-h1">{t('admin.importTitle')}</h1>
      <p className="cc-muted">{t('admin.importIntro')}</p>
      {classes.isSuccess && open.length === 0 ? (
        <EmptyState title={t('admin.importNoClasses')} />
      ) : (
        <>
          <section className="cc-stack" aria-labelledby="adm-imp-classes">
            <h2 id="adm-imp-classes" className="cc-h2">
              {t('admin.importClasses')}
            </h2>
            {classes.isSuccess ? (
              <Alert kind={empty.length ? 'warning' : 'success'}>
                <span data-testid="admin-import-empty-count">{empty.length ? t('admin.importEmptyCount', { count: empty.length }) : t('admin.importAllFilled')}</span>
              </Alert>
            ) : null}
            <DataTable
              caption={t('admin.importClassesCaption')}
              rows={open}
              rowKey={(c) => c.id}
              stack
              emptyText={t('admin.importNoClasses')}
              columns={[
                { key: 'name', header: t('import.col.class'), sortValue: (c) => c.name, render: (c) => c.name },
                {
                  key: 'count',
                  header: t('admin.students'),
                  sortValue: (c) => c.studentCount,
                  render: (c) =>
                    c.studentCount === 0 ? (
                      <span className="cc-chip cc-chip--warning">
                        <IconAlert />
                        {t('admin.importEmpty')}
                      </span>
                    ) : (
                      <span className="cc-chip cc-chip--success">
                        <IconCheck />
                        {c.studentCount}
                      </span>
                    ),
                },
                {
                  key: 'actions',
                  header: t('common.actions'),
                  render: (c) => (
                    <Button size="small" onPress={() => setClassId(c.id)} isDisabled={classId === c.id}>
                      {t('admin.importChoose', { name: c.name })}
                    </Button>
                  ),
                },
              ]}
            />
          </section>
          <Importer classes={items} tz={settings.data?.timezone ?? 'UTC'} showCreator classId={classId} onClassChange={setClassId} />
        </>
      )}
    </main>
  );
}
