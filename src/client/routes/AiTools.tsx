/**
 * AI tools (S14h1, D-160, D-161): the Profile section where an account makes, lists and revokes its
 * personal tokens for the `/mcp` endpoint, and the administrator's Admin → AI tools page (the two
 * switches, the longest token lifetime, every token, call counts). Both are behind the PIN gate; making
 * a token also asks for the password (or a fresh email sign-in). The secret is shown once.
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as M from '../../shared/contracts/mcp.ts';
import { READ_SCOPES, type AiPrivacyMode, type McpScope } from '../../shared/mcp.ts';
import { call } from '../lib/api.ts';
import { copyText, showManualCopy } from '../lib/clipboard.ts';
import { errorText } from '../lib/errors.ts';
import { useI18n } from '../lib/i18n.tsx';
import type { Me } from '../lib/session.ts';
import { useRun } from '../lib/useRun.ts';
import { Button } from '../ui/Button.tsx';
import { DialogActions, Modal } from '../ui/Dialog.tsx';
import { Alert } from '../ui/Feedback.tsx';
import { Select, TextField } from '../ui/Fields.tsx';
import { InlineConfirmButton } from '../ui/InlineConfirm.tsx';
import { IconCheck, IconCopy, IconPlus } from '../ui/icons.tsx';
import { DataTable } from '../ui/Layout.tsx';

export const AI_ACCOUNT_KEY = ['sensitive', 'ai-tools', 'account'] as const;
export const AI_ADMIN_KEY = ['sensitive', 'ai-tools', 'admin'] as const;
export const DAY_CHOICES = [7, 14, 30, 60, 90] as const;

export function useDateFormat() {
  const { locale } = useI18n();
  return new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium' });
}

/** A copy button that falls back to showing the text for copying by hand (D-140). */
function CopyButton({ text, label, testId }: { text: string; label: string; testId?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      data-testid={testId}
      onPress={async () => {
        if (await copyText(text)) setCopied(true);
        else showManualCopy({ title: label, label, text });
      }}
    >
      {copied ? <IconCheck /> : <IconCopy />}
      {copied ? t('users.copied') : label}
    </Button>
  );
}

/** The secret of a new token, shown exactly once. */
function SecretDialog({ value, url, onClose }: { value: { secret: string; name: string } | null; url: string; onClose: () => void }) {
  const { t } = useI18n();
  const command = value ? `claude mcp add --transport http class-compass ${url} --header "Authorization: Bearer ${value.secret}"` : '';
  return (
    <Modal isOpen={value !== null} onOpenChange={(open) => !open && onClose()} title={t('aiTools.secretTitle')} dismissable={false} testId="ai-secret-dialog">
      <Alert kind="warning">{t('aiTools.secretOnce', { name: value?.name ?? '' })}</Alert>
      <output className="cc-ai-secret" data-testid="ai-secret">
        {value?.secret}
      </output>
      <p className="cc-muted">{t('aiTools.claudeCodeHint')}</p>
      <output className="cc-ai-url" data-testid="ai-command">
        {command}
      </output>
      <DialogActions>
        <CopyButton text={value?.secret ?? ''} label={t('aiTools.copyToken')} testId="ai-copy-token" />
        <CopyButton text={command} label={t('aiTools.copyCommand')} />
        <Button variant="primary" onPress={onClose}>
          {t('users.storedIt')}
        </Button>
      </DialogActions>
    </Modal>
  );
}

function CreateTokenDialog({ isOpen, onClose, me, data, onCreated }: { isOpen: boolean; onClose: () => void; me: Me; data: M.AiToolsAccount; onCreated: (v: { secret: string; name: string }) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const byEmail = me.signInMethod === 'email_link';
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<McpScope[]>(() => data.scopes.filter((s) => READ_SCOPES.includes(s)));
  const [days, setDays] = useState(String(data.defaultDays));
  const [privacy, setPrivacy] = useState<AiPrivacyMode>('pseudonymous');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dayChoices = [...new Set([...DAY_CHOICES.filter((d) => d <= data.maxDays), data.maxDays])].sort((a, b) => a - b);
  const close = () => {
    setName('');
    setPassword('');
    setError(null);
    onClose();
  };
  const toggle = (s: McpScope, on: boolean) => setScopes((xs) => (on ? [...new Set([...xs, s])] : xs.filter((x) => x !== s)));
  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && close()} title={t('aiTools.newToken')} testId="ai-create-dialog">
      <form
        className="cc-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (!name.trim()) return setError(t('aiTools.nameRequired'));
          if (!scopes.length) return setError(t('aiTools.scopeRequired'));
          setBusy(true);
          try {
            const r = await call(M.createAiToken, { name: name.trim(), scopes, days: Number(days), privacy, ...(byEmail ? {} : { currentPassword: password }) });
            void qc.invalidateQueries({ queryKey: AI_ACCOUNT_KEY });
            close();
            onCreated({ secret: r.secret, name: r.token.name });
          } catch (err) {
            setError(errorText(t, err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField label={t('aiTools.tokenName')} description={t('aiTools.tokenNameHint')} value={name} onChange={setName} isRequired maxLength={60} />
        <fieldset className="cc-stack cc-fieldset">
          <legend className="cc-field__label">{t('aiTools.scopes')}</legend>
          <p className="cc-field__hint" style={{ margin: 0 }}>
            {t('aiTools.scopesHint')}
          </p>
          <div className="cc-ai-scopes">
            {data.scopes.map((s) => (
              <label key={s} className="cc-check">
                <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => toggle(s, e.target.checked)} />
                <span>{t(`aiTools.scope.${s}` as const)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Select label={t('aiTools.expires')} value={days} onChange={setDays} items={dayChoices.map((d) => ({ id: String(d), label: t('aiTools.days', { count: d }) }))} />
        {data.studentDataAllowed ? (
          <Select
            label={t('aiTools.privacy')}
            description={t('aiTools.privacyHint')}
            value={privacy}
            onChange={(v) => setPrivacy(v === 'named' ? 'named' : 'pseudonymous')}
            items={[
              { id: 'pseudonymous', label: t('aiTools.mode.pseudonymous') },
              { id: 'named', label: t('aiTools.mode.named') },
            ]}
          />
        ) : null}
        {byEmail ? (
          me.reauthFresh ? null : <Alert kind="warning">{t('error.REAUTH_REQUIRED')}</Alert>
        ) : (
          <TextField label={t('password.current')} description={t('aiTools.passwordHint')} type="password" autoComplete="current-password" isRequired value={password} onChange={setPassword} />
        )}
        {error ? <Alert>{error}</Alert> : null}
        <DialogActions>
          <Button onPress={close}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isDisabled={busy}>
            {t('aiTools.create')}
          </Button>
        </DialogActions>
      </form>
    </Modal>
  );
}

export const statusText = (t: ReturnType<typeof useI18n>['t'], s: M.AiToken['status']) => t(`aiTools.status.${s}` as const);

/** Profile → AI tools (teachers and administrators). */
export function AiToolsSection({ me }: { me: Me }) {
  const { t } = useI18n();
  const run = useRun();
  const fmt = useDateFormat();
  const q = useQuery({ queryKey: AI_ACCOUNT_KEY, queryFn: () => call(M.aiToolsAccount, {}) });
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ secret: string; name: string } | null>(null);
  const data = q.data;
  return (
    <section className="cc-card cc-stack" aria-labelledby="ai-tools-title" data-testid="ai-tools">
      <h2 id="ai-tools-title" className="cc-h2">
        {t('aiTools.title')}
      </h2>
      {q.error ? <Alert>{errorText(t, q.error)}</Alert> : null}
      {!data ? null : !data.enabled ? (
        <p className="cc-muted">{t('aiTools.off')}</p>
      ) : (
        <>
          <p className="cc-muted">{t('aiTools.intro')}</p>
          <Alert kind="warning">{data.studentDataAllowed ? t('aiTools.schoolAllowsNames') : t('aiTools.schoolPseudonymous')}</Alert>
          <div className="cc-stack">
            <span className="cc-field__label">{t('aiTools.address')}</span>
            <code className="cc-ai-url" data-testid="ai-url">
              {data.url}
            </code>
            <div>
              <CopyButton text={data.url} label={t('aiTools.copyAddress')} />
            </div>
          </div>
          <div>
            <Button variant="primary" onPress={() => setCreating(true)} data-testid="ai-new-token">
              <IconPlus />
              {t('aiTools.newToken')}
            </Button>
          </div>
          <DataTable
            stack
            caption={t('aiTools.tokens')}
            rows={data.tokens}
            rowKey={(r) => r.id}
            emptyText={t('aiTools.noTokens')}
            columns={[
              { key: 'name', header: t('aiTools.tokenName'), stackRole: 'title', render: (r) => r.name },
              { key: 'prefix', header: t('aiTools.prefix'), render: (r) => <code>{`${r.prefix}…`}</code> },
              { key: 'scopes', header: t('aiTools.scopes'), render: (r) => r.scopes.map((s) => t(`aiTools.scope.${s}` as const)).join(', ') },
              { key: 'privacy', header: t('aiTools.privacy'), render: (r) => t(`aiTools.mode.${r.privacy}` as const) },
              { key: 'status', header: t('aiTools.statusHeader'), render: (r) => statusText(t, r.status) },
              { key: 'expires', header: t('aiTools.expiresOn'), render: (r) => fmt.format(r.expiresAt) },
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
                      onConfirm={() => void run(() => call(M.revokeAiToken, { tokenId: r.id }), { success: t('aiTools.revoked'), invalidate: [AI_ACCOUNT_KEY] })}
                    >
                      {t('aiTools.revoke')}
                    </InlineConfirmButton>
                  ) : null,
              },
            ]}
          />
          <CreateTokenDialog isOpen={creating} onClose={() => setCreating(false)} me={me} data={data} onCreated={setSecret} />
          <SecretDialog value={secret} url={data.url} onClose={() => setSecret(null)} />
        </>
      )}
      <div>
        <Link to="/help" search={{ guide: 'ai-tools', lang: me.locale }}>
          {t('aiTools.guideLink')}
        </Link>
      </div>
    </section>
  );
}
