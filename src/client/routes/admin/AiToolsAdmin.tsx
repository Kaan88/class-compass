/** Admin → AI tools (S14h1, D-160, D-161): the two switches, the longest token lifetime, every token, call counts. */
import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import * as M from '../../../shared/contracts/mcp.ts';
import * as O from '../../../shared/contracts/oauth.ts';
import { AI_APP_RETURN_HOSTS, AI_NEVER_SHARED, AI_STUDENT_DATA_CATEGORIES, MCP_TOKEN_MAX_DAYS, type AiReturnHostApp } from '../../../shared/mcp.ts';
import { call } from '../../lib/api.ts';
import { errorText } from '../../lib/errors.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { showToast } from '../../lib/toast.ts';
import { useRun } from '../../lib/useRun.ts';
import { ConfirmDestructive } from '../../ui/Dialog.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { Button } from '../../ui/Button.tsx';
import { Select, TextArea, Toggle } from '../../ui/Fields.tsx';
import { InlineConfirmButton } from '../../ui/InlineConfirm.tsx';
import { IconAlert, IconCheck, IconDot, IconPlus } from '../../ui/icons.tsx';
import { DataTable } from '../../ui/Layout.tsx';
import { AI_SETUP_KEY } from '../AiConnect.tsx';
import { AI_ACCOUNT_KEY, AI_ADMIN_KEY, ConnectionsTable, DAY_CHOICES, statusText, useDateFormat } from '../AiTools.tsx';
import { AiConnectionsAdminSection } from '../AiConnections.tsx';

/**
 * OAuth (S14h2, D-160): the hosts an AI app's https redirect address may use (loopback is always
 * allowed). One host per line in a multi-line field (a single-line input would drop the line breaks
 * and run the hosts together); spaces and commas also separate hosts. Saved as typed, audited.
 */
function RedirectHosts({ hosts }: { hosts: string[] }) {
  const { t } = useI18n();
  const run = useRun();
  const [text, setText] = useState(hosts.join('\n'));
  const list = text
    .split(/[\s,]+/u)
    .map((h) => h.trim())
    .filter(Boolean);
  return (
    <section className="cc-card cc-stack" aria-labelledby="ai-hosts">
      <h2 id="ai-hosts" className="cc-h2">
        {t('aiTools.admin.redirectHosts')}
      </h2>
      <p className="cc-muted" style={{ margin: 0 }}>
        {t('aiTools.admin.redirectHostsIntro')}
      </p>
      <form
        className="cc-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => call(O.setOAuthRedirectHosts, { hosts: list }), { success: t('aiTools.admin.saved'), invalidate: [AI_ADMIN_KEY, AI_SETUP_KEY] });
        }}
      >
        <TextArea label={t('aiTools.admin.redirectHostsLabel')} description={t('aiTools.admin.redirectHostsHint')} value={text} onChange={setText} rows={4} />
        <div>
          <Button type="submit" variant="primary">
            {t('aiTools.admin.saveHosts')}
          </Button>
        </div>
      </form>
    </section>
  );
}

type CheckStatus = 'done' | 'todo' | 'info' | 'manual';

/** A status shown as an icon and a word, never by colour alone. */
function CheckBadge({ status }: { status: CheckStatus }) {
  const { t } = useI18n();
  return (
    <span className={`cc-ai-badge cc-ai-badge--${status}`}>
      {status === 'done' ? <IconCheck /> : status === 'todo' ? <IconDot /> : <IconAlert />}
      {t(`aiTools.admin.check.status.${status}` as const)}
    </span>
  );
}

function CheckItem({ id, status, title, children }: { id: string; status: CheckStatus; title: string; children?: ReactNode }) {
  return (
    <li className="cc-ai-checklist__item" data-testid={`ai-check-${id}`} data-status={status}>
      <div className="cc-ai-checklist__head">
        <CheckBadge status={status} />
        <span className="cc-ai-checklist__title">{title}</span>
      </div>
      {children ? <div className="cc-stack cc-ai-checklist__body">{children}</div> : null}
    </li>
  );
}

/**
 * The setup checklist (S19c, D-181): AI tools on, the student data switch explained, the documented
 * return hosts of Claude and ChatGPT with one-click add, the Cloudflare Access note and whether a first
 * tool call has worked. Adding a host is the administrator's click; it is audited like any host change.
 */
function SetupChecklist({ data, onSwitchOn }: { data: M.AiToolsAdmin; onSwitchOn: () => void }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const fmt = new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const addHost = (host: string) =>
    void run(() => call(O.setOAuthRedirectHosts, { hosts: [...data.redirectHosts.filter((h) => h !== host), host] }), { success: t('aiTools.admin.check.hostAdded', { host }), invalidate: [AI_ADMIN_KEY, AI_SETUP_KEY] });
  const hostItem = (app: AiReturnHostApp) => {
    const host = AI_APP_RETURN_HOSTS[app];
    const ok = data.redirectHosts.includes(host);
    return (
      <CheckItem id={`host-${app}`} status={ok ? 'done' : 'todo'} title={t(`aiTools.admin.check.host.${app}` as const, { host })}>
        <p style={{ margin: 0 }}>{t(`aiTools.admin.check.hostHint.${app}` as const, { host })}</p>
        {ok ? null : (
          <div>
            <Button onPress={() => addHost(host)} data-testid={`ai-add-host-${app}`}>
              <IconPlus />
              {t('aiTools.admin.check.addHost', { host })}
            </Button>
          </div>
        )}
      </CheckItem>
    );
  };
  return (
    <section className="cc-card cc-stack" aria-labelledby="ai-checklist-title" data-testid="ai-checklist">
      <h2 id="ai-checklist-title" className="cc-h2">
        {t('aiTools.admin.check.title')}
      </h2>
      <p className="cc-muted" style={{ margin: 0 }}>
        {t('aiTools.admin.check.intro')}
      </p>
      <ol className="cc-ai-checklist">
        <CheckItem id="enabled" status={data.settings.mcpEnabled ? 'done' : 'todo'} title={t('aiTools.admin.check.enabled')}>
          <p style={{ margin: 0 }}>{data.settings.mcpEnabled ? t('aiTools.admin.check.enabledOn') : t('aiTools.admin.check.enabledOff')}</p>
          {data.settings.mcpEnabled ? null : (
            <div>
              <Button variant="primary" onPress={onSwitchOn} data-testid="ai-switch-on">
                {t('aiTools.admin.check.switchOn')}
              </Button>
            </div>
          )}
        </CheckItem>
        <CheckItem id="student-data" status="info" title={t('aiTools.admin.check.studentData')}>
          <p style={{ margin: 0 }}>{data.settings.aiStudentDataAllowed ? t('aiTools.admin.check.studentDataOn') : t('aiTools.admin.check.studentDataOff')}</p>
        </CheckItem>
        {hostItem('claude')}
        {hostItem('chatgpt')}
        <CheckItem id="access" status="manual" title={t('aiTools.admin.check.access')}>
          <p style={{ margin: 0 }}>{t('aiTools.admin.check.accessHint')}</p>
          <div>
            <Link to="/help" search={{ guide: 'ai-tools', lang: locale }} hash="cloudflare-access">
              {t('aiTools.admin.check.accessLink')}
            </Link>
          </div>
        </CheckItem>
        <CheckItem id="first-call" status={data.lastToolCallAt ? 'done' : 'todo'} title={t('aiTools.admin.check.firstCall')}>
          <p style={{ margin: 0 }}>{data.lastToolCallAt ? t('aiTools.admin.check.firstCallDone', { when: fmt.format(data.lastToolCallAt) }) : t('aiTools.admin.check.firstCallTodo')}</p>
        </CheckItem>
      </ol>
    </section>
  );
}

/** Registered AI apps (S14h2): registrations and metadata documents, with Revoke (which ends their connections). */
function ClientsTable({ rows }: { rows: M.OAuthClientView[] }) {
  const { t } = useI18n();
  const run = useRun();
  const fmt = useDateFormat();
  return (
    <DataTable
      stack
      caption={t('aiTools.admin.clients')}
      rows={rows}
      rowKey={(r) => r.id}
      emptyText={t('aiTools.admin.noClients')}
      columns={[
        { key: 'name', header: t('aiTools.app'), stackRole: 'title', render: (r) => r.name },
        { key: 'kind', header: t('aiTools.admin.clientKind'), render: (r) => t(r.kind === 'cimd' ? 'aiTools.admin.kind.cimd' : 'aiTools.admin.kind.dcr') },
        { key: 'hosts', header: t('aiTools.sendsTo'), render: (r) => r.redirectHosts.join(', ') },
        { key: 'status', header: t('aiTools.statusHeader'), render: (r) => statusText(t, r.status) },
        { key: 'connections', header: t('aiTools.admin.activeConnections'), render: (r) => String(r.activeConnections) },
        { key: 'created', header: t('aiTools.admin.registered'), render: (r) => fmt.format(r.createdAt), sortValue: (r) => r.createdAt },
        { key: 'used', header: t('aiTools.lastUsed'), render: (r) => (r.lastUsedAt ? fmt.format(r.lastUsedAt) : t('aiTools.never')) },
        {
          key: 'actions',
          header: t('common.actions'),
          render: (r) =>
            r.status === 'revoked' ? null : (
              <InlineConfirmButton
                variant="danger-outline"
                message={t('aiTools.admin.revokeClientConfirm', { name: r.name })}
                confirmLabel={t('aiTools.revoke')}
                cancelLabel={t('common.cancel')}
                onConfirm={() => void run(() => call(O.adminRevokeOAuthClient, { clientRowId: r.id }), { success: t('aiTools.revoked'), invalidate: [AI_ADMIN_KEY] })}
              >
                {t('aiTools.revoke')}
              </InlineConfirmButton>
            ),
        },
      ]}
    />
  );
}

/** Admin → AI tools: the switches (student data needs a typed confirmation), the lifetime cap, every token. */
export function AiToolsAdminPage() {
  const { t, locale } = useI18n();
  const run = useRun();
  const fmt = useDateFormat();
  const q = useQuery({ queryKey: AI_ADMIN_KEY, queryFn: () => call(M.aiToolsAdmin, {}) });
  const [confirming, setConfirming] = useState(false);
  const data = q.data;
  const save = (patch: z.input<typeof M.setAiToolsSettings.input>) =>
    run(() => call(M.setAiToolsSettings, patch), { success: t('aiTools.admin.saved'), invalidate: [AI_ADMIN_KEY, AI_ACCOUNT_KEY, AI_SETUP_KEY] });
  return (
    <main className="cc-page cc-stack" data-testid="admin-ai-tools">
      <h1 className="cc-h1">{t('aiTools.admin.title')}</h1>
      <p className="cc-muted">{t('aiTools.admin.intro')}</p>
      {q.error ? <Alert>{errorText(t, q.error)}</Alert> : null}
      {data ? (
        <>
          <SetupChecklist data={data} onSwitchOn={() => void save({ mcpEnabled: true })} />
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
          <ConnectionsTable
            admin
            rows={data.connections}
            onDisconnect={(r) => void run(() => call(O.adminRevokeAiConnection, { connectionId: r.id }), { success: t('aiTools.disconnected'), invalidate: [AI_ADMIN_KEY] })}
          />
          {/* The in-app assistant's connections to model providers (S19a, D-179). */}
          <AiConnectionsAdminSection />
          <ClientsTable rows={data.clients} />
          <RedirectHosts key={data.redirectHosts.join(' ')} hosts={data.redirectHosts} />
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
