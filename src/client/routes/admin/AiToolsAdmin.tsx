/** Admin → AI tools (S14h1, D-160, D-161): the two switches, the longest token lifetime, every token, call counts. */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import * as M from '../../../shared/contracts/mcp.ts';
import { AI_NEVER_SHARED, AI_STUDENT_DATA_CATEGORIES, MCP_TOKEN_MAX_DAYS } from '../../../shared/mcp.ts';
import { call } from '../../lib/api.ts';
import { errorText } from '../../lib/errors.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { showToast } from '../../lib/toast.ts';
import { useRun } from '../../lib/useRun.ts';
import { ConfirmDestructive } from '../../ui/Dialog.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { Select, Toggle } from '../../ui/Fields.tsx';
import { InlineConfirmButton } from '../../ui/InlineConfirm.tsx';
import { DataTable } from '../../ui/Layout.tsx';
import { AI_ACCOUNT_KEY, AI_ADMIN_KEY, DAY_CHOICES, statusText, useDateFormat } from '../AiTools.tsx';

/** Admin → AI tools: the switches (student data needs a typed confirmation), the lifetime cap, every token. */
export function AiToolsAdminPage() {
  const { t, locale } = useI18n();
  const run = useRun();
  const fmt = useDateFormat();
  const q = useQuery({ queryKey: AI_ADMIN_KEY, queryFn: () => call(M.aiToolsAdmin, {}) });
  const [confirming, setConfirming] = useState(false);
  const data = q.data;
  const save = (patch: z.input<typeof M.setAiToolsSettings.input>) =>
    run(() => call(M.setAiToolsSettings, patch), { success: t('aiTools.admin.saved'), invalidate: [AI_ADMIN_KEY, AI_ACCOUNT_KEY] });
  return (
    <main className="cc-page cc-stack" data-testid="admin-ai-tools">
      <h1 className="cc-h1">{t('aiTools.admin.title')}</h1>
      <p className="cc-muted">{t('aiTools.admin.intro')}</p>
      {q.error ? <Alert>{errorText(t, q.error)}</Alert> : null}
      {data ? (
        <>
          <section className="cc-card cc-stack" aria-labelledby="ai-switches">
            <h2 id="ai-switches" className="cc-h2">
              {t('aiTools.admin.switches')}
            </h2>
            <Toggle label={t('aiTools.admin.enabled')} description={t('aiTools.admin.enabledHint')} isSelected={data.settings.mcpEnabled} onChange={(v) => void save({ mcpEnabled: v })} />
            <Toggle
              label={t('aiTools.admin.studentData')}
              description={t('aiTools.admin.studentDataHint')}
              isSelected={data.settings.aiStudentDataAllowed}
              onChange={(v) => (v ? setConfirming(true) : void save({ aiStudentDataAllowed: false }))}
            />
            <Select
              label={t('aiTools.admin.maxDays')}
              value={String(data.settings.mcpTokenMaxDays)}
              onChange={(v) => void save({ mcpTokenMaxDays: Number(v) })}
              items={[...new Set([...DAY_CHOICES, data.settings.mcpTokenMaxDays])]
                .filter((d) => d <= MCP_TOKEN_MAX_DAYS)
                .sort((a, b) => a - b)
                .map((d) => ({ id: String(d), label: t('aiTools.days', { count: d }) }))}
            />
            <div className="cc-stack">
              <span className="cc-field__label">{t('aiTools.address')}</span>
              <code className="cc-ai-url">{data.url}</code>
            </div>
            <p className="cc-muted" style={{ margin: 0 }}>
              {t('aiTools.admin.calls', { total: data.calls.total, errors: data.calls.errors, denied: data.calls.denied })}
            </p>
          </section>
          <section className="cc-card cc-stack" aria-labelledby="ai-leaves">
            <h2 id="ai-leaves" className="cc-h2">
              {t('aiTools.admin.whatLeaves')}
            </h2>
            <p>{data.settings.aiStudentDataAllowed ? t('aiTools.admin.leavesNamed') : t('aiTools.admin.leavesPseudonymous')}</p>
            <h3 className="cc-h3">{t('aiTools.admin.never')}</h3>
            <ul className="cc-ai-categories">
              {AI_NEVER_SHARED.map((c) => (
                <li key={c}>{t(`aiTools.never.${c}` as const)}</li>
              ))}
            </ul>
          </section>
          <DataTable
            stack
            caption={t('aiTools.admin.tokens')}
            rows={data.tokens}
            rowKey={(r) => r.id}
            emptyText={t('aiTools.noTokens')}
            columns={[
              { key: 'user', header: t('aiTools.admin.account'), stackRole: 'title', render: (r) => `${r.userName} (${t(r.userRole === 'admin' ? 'role.admin' : 'role.teacher')})`, sortValue: (r) => r.userName },
              { key: 'name', header: t('aiTools.tokenName'), render: (r) => r.name },
              { key: 'scopes', header: t('aiTools.scopes'), render: (r) => r.scopes.map((s) => t(`aiTools.scope.${s}` as const)).join(', ') },
              { key: 'privacy', header: t('aiTools.privacy'), render: (r) => t(`aiTools.mode.${r.privacy}` as const) },
              { key: 'status', header: t('aiTools.statusHeader'), render: (r) => statusText(t, r.status) },
              { key: 'expires', header: t('aiTools.expiresOn'), render: (r) => fmt.format(r.expiresAt), sortValue: (r) => r.expiresAt },
              { key: 'used', header: t('aiTools.lastUsed'), render: (r) => (r.lastUsedAt ? fmt.format(r.lastUsedAt) : t('aiTools.never')) },
              {
                key: 'actions',
                header: t('common.actions'),
                render: (r) =>
                  r.status === 'active' ? (
                    <InlineConfirmButton
                      variant="danger-outline"
                      message={t('aiTools.revokeConfirm', { name: r.name })}
                      confirmLabel={t('aiTools.revoke')}
                      cancelLabel={t('common.cancel')}
                      onConfirm={() => void run(() => call(M.adminRevokeAiToken, { tokenId: r.id }), { success: t('aiTools.revoked'), invalidate: [AI_ADMIN_KEY] })}
                    >
                      {t('aiTools.revoke')}
                    </InlineConfirmButton>
                  ) : null,
              },
            ]}
          />
          <ConfirmDestructive
            isOpen={confirming}
            onOpenChange={setConfirming}
            title={t('aiTools.admin.studentDataConfirmTitle')}
            description={
              <div className="cc-stack">
                <p style={{ margin: 0 }}>{t('aiTools.admin.studentDataConfirm', { word: M.AI_STUDENT_DATA_CONFIRM })}</p>
                <ul className="cc-ai-categories">
                  {AI_STUDENT_DATA_CATEGORIES.map((c) => (
                    <li key={c}>{t(`aiTools.category.${c}` as const)}</li>
                  ))}
                </ul>
                <p style={{ margin: 0 }}>{t('aiTools.admin.kvkk')}</p>
              </div>
            }
            confirmText={M.AI_STUDENT_DATA_CONFIRM}
            actionLabel={t('aiTools.admin.studentDataOn')}
            onConfirm={async () => {
              await call(M.setAiToolsSettings, { aiStudentDataAllowed: true, confirm: M.AI_STUDENT_DATA_CONFIRM });
              await q.refetch();
              showToast({ message: t('aiTools.admin.saved'), kind: 'success' });
            }}
          />
          <div>
            <Link to="/help" search={{ guide: 'ai-tools', lang: locale }}>
              {t('aiTools.guideLink')}
            </Link>
          </div>
        </>
      ) : null}
    </main>
  );
}
