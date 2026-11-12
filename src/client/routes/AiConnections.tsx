/**
 * Assistant connections (S19a, D-179): the school's connections on Admin → AI tools, a teacher's own
 * connections on the Profile (only while the administrator allows them), and the page a provider's
 * sign-in returns to. A key is typed once and never shown again: the lists say only whether one is
 * stored. "Test" runs two tiny requests (text, then one tool call) and marks the model.
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import '../../shared/i18n/areas/aiConnections.ts';
import { KEY_TYPES, OAUTH_TYPES, PERSONAL_CONNECTION_TYPES, SECRET_REQUIRED, type AiConnectionType } from '../../shared/aiConnections.ts';
import * as C from '../../shared/contracts/aiConnections.ts';
import { call } from '../lib/api.ts';
import { errorText } from '../lib/errors.ts';
import { useI18n } from '../lib/i18n.tsx';
import { showToast } from '../lib/toast.ts';
import { useRun } from '../lib/useRun.ts';
import { Button } from '../ui/Button.tsx';
import { DialogActions, Modal } from '../ui/Dialog.tsx';
import { Alert } from '../ui/Feedback.tsx';
import { Select, TextArea, TextField, Toggle } from '../ui/Fields.tsx';
import { InlineConfirmButton } from '../ui/InlineConfirm.tsx';
import { IconPlus } from '../ui/icons.tsx';
import { DataTable } from '../ui/Layout.tsx';
import { ConsentGate } from './Lock.tsx';

export const AI_CONN_ADMIN_KEY = ['sensitive', 'ai-connections', 'admin'] as const;
export const AI_CONN_OWN_KEY = ['sensitive', 'ai-connections', 'own'] as const;

type Scope = 'school' | 'personal';
type T = ReturnType<typeof useI18n>['t'];

const API = {
  school: { key: AI_CONN_ADMIN_KEY, create: C.createAiConnection, update: C.updateAiConnection, del: C.deleteAiConnection, test: C.testAiConnection, oauth: C.startAiConnectionOAuth },
  personal: { key: AI_CONN_OWN_KEY, create: C.createOwnAiConnection, update: C.updateOwnAiConnection, del: C.deleteOwnAiConnection, test: C.testOwnAiConnection, oauth: C.startOwnAiConnectionOAuth },
} as const;

const fmtNumber = (locale: string, n: number) => new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-GB').format(n);

/** A whole number above 0, or null for an empty field; undefined when the text is not valid. */
function limitOf(text: string): number | null | undefined {
  const s = text.trim().replace(/[\s.,]/gu, '');
  if (!s) return null;
  if (!/^\d+$/u.test(s) || Number(s) < 1) return undefined;
  return Number(s);
}

function modelMark(t: T, m: C.AiModelView): string {
  if (m.testedAt === null) return t('aiConn.model.untested');
  if (m.tools) return t('aiConn.model.toolsOk');
  if (m.text) return t('aiConn.model.textOnly');
  return t('aiConn.model.failed');
}

export function testResultText(t: T, model: string, r: C.AiTestResult): string {
  if (r.ok) return t('aiConn.testOk', { model });
  // Text worked; the tool request either got no tool call or failed (e.g. a server without tool support).
  if (r.text && !r.tools) return r.failure ? t('aiConn.testToolsFailed', { model, reason: t(`aiConn.failure.${r.failure}` as const) }) : t('aiConn.testTextOnly', { model });
  return t('aiConn.testFailed', { model, reason: r.failure ? t(`aiConn.failure.${r.failure}` as const) : '' });
}

// ---------------------------------------------------------------- the form (add and edit)
function ConnectionForm({
  scope,
  editing,
  isOpen,
  onClose,
  chatgptAvailable,
}: {
  scope: Scope;
  editing: C.AiConnectionView | null;
  isOpen: boolean;
  onClose: () => void;
  chatgptAvailable: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const types = (scope === 'school' ? C.AiConnectionTypeSchema.options : PERSONAL_CONNECTION_TYPES).filter((x) => x !== 'chatgpt' || chatgptAvailable);
  const [type, setType] = useState<AiConnectionType>(editing?.type ?? 'anthropic');
  const [name, setName] = useState(editing?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? '');
  const [localNetwork, setLocalNetwork] = useState(editing?.localNetwork ?? false);
  const [apiKey, setApiKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [models, setModels] = useState(editing?.models.map((m) => m.name).join('\n') ?? '');
  const [budget, setBudget] = useState(editing?.monthlyTokenBudget ? String(editing.monthlyTokenBudget) : '');
  const [daily, setDaily] = useState(editing?.dailyMessageLimit ? String(editing.dailyMessageLimit) : '');
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [kvkk, setKvkk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const api = API[scope];
  const takesKey = KEY_TYPES.includes(type);
  const keyLabel = editing
    ? t('aiConn.form.replaceKey')
    : type === 'openaiCompatible'
      ? t('aiConn.form.apiKeyOptional')
      : type === 'openrouter'
        ? t('aiConn.form.apiKeyOpenRouter')
        : t('aiConn.form.apiKey');
  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()} title={editing ? t('aiConn.editTitle', { name: editing.name }) : t('aiConn.addTitle')} testId="ai-conn-dialog" closeButton>
      <form
        className="cc-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          const list = models
            .split(/\r?\n/u)
            .map((m) => m.trim())
            .filter(Boolean);
          const b = limitOf(budget);
          const d = limitOf(daily);
          if (!name.trim()) return setError(t('aiConn.form.nameRequired'));
          if (!list.length) return setError(t('aiConn.form.modelsRequired'));
          if (b === undefined || d === undefined) return setError(t('aiConn.form.numberInvalid'));
          if (!editing && !kvkk) return setError(t('aiConn.form.kvkkRequired'));
          setBusy(true);
          try {
            const common = { name: name.trim(), models: list, monthlyTokenBudget: b, dailyMessageLimit: d, ...(takesKey && apiKey.trim() ? { apiKey: apiKey.trim() } : {}) };
            const url = type === 'openaiCompatible' ? { baseUrl: baseUrl.trim(), localNetwork } : {};
            if (editing) await call(api.update, { connectionId: editing.id, ...common, ...url, enabled, ...(removeKey && !apiKey.trim() ? { removeSecret: true } : {}) } as never);
            else await call(api.create, { type, ...common, ...url, kvkkConfirmed: true } as never);
            void qc.invalidateQueries({ queryKey: api.key });
            showToast({ message: editing ? t('aiConn.saved') : t('aiConn.added'), kind: 'success' });
            onClose();
          } catch (err) {
            setError(errorText(t, err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {editing ? null : (
          <Select label={t('aiConn.form.type')} value={type} onChange={(v) => setType(v as AiConnectionType)} items={types.map((x) => ({ id: x, label: t(`aiConn.type.${x}` as const) }))} />
        )}
        <TextField label={t('aiConn.form.name')} description={t('aiConn.form.nameHint')} value={name} onChange={setName} isRequired maxLength={60} />
        {type === 'openaiCompatible' ? (
          <>
            <TextField label={t('aiConn.form.baseUrl')} description={t('aiConn.form.baseUrlHint')} value={baseUrl} onChange={setBaseUrl} isRequired type="url" inputMode="url" maxLength={300} />
            <label className="cc-check cc-ai-check">
              <input type="checkbox" checked={localNetwork} onChange={(e) => setLocalNetwork(e.target.checked)} />
              <span>{t('aiConn.form.localNetwork')}</span>
            </label>
            <p className="cc-field__hint" style={{ margin: 0 }}>
              {t('aiConn.form.localNetworkHint')}
            </p>
          </>
        ) : null}
        {takesKey ? <TextField label={keyLabel} description={t('aiConn.form.apiKeyHint')} type="password" autoComplete="off" value={apiKey} onChange={setApiKey} maxLength={1000} /> : null}
        {editing?.hasSecret && type === 'openaiCompatible' && !apiKey.trim() && (baseUrl.trim() !== (editing.baseUrl ?? '') || localNetwork !== editing.localNetwork) ? (
          <p className="cc-field__hint" role="status" data-testid="ai-conn-address-drops-key" style={{ margin: 0 }}>
            {t('aiConn.form.addressDropsKey')}
          </p>
        ) : null}
        {editing?.hasSecret && takesKey ? (
          <label className="cc-check cc-ai-check">
            <input type="checkbox" checked={removeKey} onChange={(e) => setRemoveKey(e.target.checked)} />
            <span>{t('aiConn.form.removeKey')}</span>
          </label>
        ) : null}
        <TextArea label={t('aiConn.form.models')} description={t('aiConn.form.modelsHint')} value={models} onChange={setModels} rows={3} />
        {scope === 'school' ? <TextField label={t('aiConn.form.budget')} description={t('aiConn.form.budgetHint')} inputMode="numeric" value={budget} onChange={setBudget} /> : null}
        <TextField label={scope === 'school' ? t('aiConn.form.daily') : t('aiConn.form.dailyOwn')} description={t('aiConn.form.dailyHint')} inputMode="numeric" value={daily} onChange={setDaily} />
        {editing ? <Toggle label={t('aiConn.form.enabled')} description={t('aiConn.form.enabledHint')} isSelected={enabled} onChange={setEnabled} /> : null}
        {editing ? null : (
          <div className="cc-stack">
            <label className="cc-check cc-ai-check">
              <input type="checkbox" checked={kvkk} onChange={(e) => setKvkk(e.target.checked)} data-testid="ai-conn-kvkk" />
              <span>{t('aiConn.form.kvkk', { processor: t(`aiConn.processor.${type}` as const) })}</span>
            </label>
            <p className="cc-field__hint" style={{ margin: 0 }}>
              {t('aiConn.form.kvkkHint')}
            </p>
          </div>
        )}
        {error ? <Alert>{error}</Alert> : null}
        <DialogActions>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isDisabled={busy}>
            {t('aiConn.form.save')}
          </Button>
        </DialogActions>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- the list
function keyText(t: T, c: C.AiConnectionView) {
  if (!c.hasSecret) return SECRET_REQUIRED.includes(c.type) ? t('aiConn.key.none') : t('aiConn.key.notNeeded');
  return c.secretSource === 'oauth' ? t('aiConn.key.oauth') : t('aiConn.key.pasted');
}

function ConnectionsList({ scope, rows, chatgptAvailable }: { scope: Scope; rows: C.AiConnectionView[]; chatgptAvailable: boolean }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const qc = useQueryClient();
  const api = API[scope];
  const [editing, setEditing] = useState<C.AiConnectionView | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const n = (x: number) => fmtNumber(locale, x);
  const test = async (c: C.AiConnectionView, model: string) => {
    setTesting(`${c.id}/${model}`);
    setResult(null);
    try {
      const r = await call(api.test, { connectionId: c.id, model });
      setResult({ text: testResultText(t, model, r), ok: r.ok });
      void qc.invalidateQueries({ queryKey: api.key });
    } catch (err) {
      setResult({ text: errorText(t, err), ok: false });
    } finally {
      setTesting(null);
    }
  };
  const signIn = (c: C.AiConnectionView) =>
    run(async () => {
      const r = await call(api.oauth, { connectionId: c.id });
      window.location.assign(r.authorizeUrl);
    });
  return (
    <>
      <DataTable
        stack
        caption={scope === 'school' ? t('aiConn.caption') : t('aiConn.ownCaption')}
        rows={rows}
        rowKey={(r) => r.id}
        emptyText={t('aiConn.noneYet')}
        columns={[
          { key: 'name', header: t('aiConn.col.name'), stackRole: 'title', render: (r) => r.name },
          { key: 'type', header: t('aiConn.col.type'), render: (r) => (r.baseUrl ? `${t(`aiConn.type.${r.type}` as const)} (${r.baseUrl})` : t(`aiConn.type.${r.type}` as const)) },
          {
            key: 'models',
            header: t('aiConn.col.models'),
            render: (r) => (
              <ul className="cc-ai-models">
                {r.models.map((m) => (
                  <li key={m.name}>
                    <code>{m.name}</code> <span className="cc-muted">({modelMark(t, m)})</span>{' '}
                    <Button size="small" isDisabled={testing !== null} onPress={() => void test(r, m.name)}>
                      {testing === `${r.id}/${m.name}` ? t('aiConn.testing') : t('aiConn.test', { model: m.name })}
                    </Button>
                  </li>
                ))}
              </ul>
            ),
          },
          { key: 'key', header: t('aiConn.col.key'), render: (r) => keyText(t, r) },
          {
            key: 'limits',
            header: t('aiConn.col.limits'),
            render: (r) =>
              r.monthlyTokenBudget === null && r.dailyMessageLimit === null
                ? t('aiConn.limits.none')
                : [r.monthlyTokenBudget !== null ? t('aiConn.limits.budget', { tokens: n(r.monthlyTokenBudget) }) : null, r.dailyMessageLimit !== null ? t('aiConn.limits.daily', { count: r.dailyMessageLimit }) : null].filter(Boolean).join('; '),
          },
          { key: 'usage', header: t('aiConn.col.usage'), render: (r) => t('aiConn.usage', { messages: n(r.usage.monthMessages), tokens: n(r.usage.monthInputTokens + r.usage.monthOutputTokens) }) },
          { key: 'status', header: t('aiConn.col.status'), render: (r) => t(`aiConn.status.${r.status}` as const) },
          {
            key: 'actions',
            header: t('common.actions'),
            render: (r) => (
              <div className="cc-ai-actions">
                {OAUTH_TYPES.includes(r.type) && (r.type !== 'chatgpt' || chatgptAvailable) ? (
                  <Button size="small" variant={r.hasSecret ? 'secondary' : 'primary'} onPress={() => void signIn(r)}>
                    {r.type === 'chatgpt' ? t('aiConn.connectChatgpt') : t('aiConn.connectOpenRouter')}
                  </Button>
                ) : null}
                <Button size="small" onPress={() => setEditing(r)}>
                  {t('aiConn.edit')}
                </Button>
                <InlineConfirmButton
                  size="small"
                  variant="danger-outline"
                  message={t('aiConn.deleteConfirm', { name: r.name })}
                  confirmLabel={t('aiConn.delete')}
                  cancelLabel={t('common.cancel')}
                  onConfirm={() => void run(() => call(api.del, { connectionId: r.id }), { success: t('aiConn.deleted'), invalidate: [api.key] })}
                >
                  {t('aiConn.delete')}
                </InlineConfirmButton>
              </div>
            ),
          },
        ]}
      />
      <p role="status" className="cc-ai-test" data-testid="ai-conn-test-result">
        {result?.text ?? ''}
      </p>
      {editing ? <ConnectionForm key={editing.id} scope={scope} editing={editing} isOpen onClose={() => setEditing(null)} chatgptAvailable={chatgptAvailable} /> : null}
    </>
  );
}

function AddButton({ scope, chatgptAvailable }: { scope: Scope; chatgptAvailable: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  return (
    <>
      <div>
        <Button variant="primary" onPress={() => setOpen(true)} data-testid="ai-conn-add">
          <IconPlus />
          {t('aiConn.add')}
        </Button>
      </div>
      {open ? (
        <ConnectionForm
          key={round}
          scope={scope}
          editing={null}
          isOpen
          onClose={() => {
            setOpen(false);
            setRound((r) => r + 1);
          }}
          chatgptAvailable={chatgptAvailable}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- Admin → AI tools
function DefaultSettings({ data }: { data: C.AiConnectionsAdmin }) {
  const { t } = useI18n();
  const run = useRun();
  const options = data.connections.flatMap((c) => c.models.map((m) => ({ id: JSON.stringify([c.id, m.name]), label: t('aiConn.settings.option', { name: c.name, model: m.name }) })));
  const current = data.settings.defaultConnectionId && data.settings.defaultModel ? JSON.stringify([data.settings.defaultConnectionId, data.settings.defaultModel]) : '';
  const save = (patch: z.input<typeof C.setAiConnectionSettings.input>) =>
    run(() => call(C.setAiConnectionSettings, patch), { success: t('aiConn.settings.saved'), invalidate: [AI_CONN_ADMIN_KEY] });
  return (
    <div className="cc-stack">
      <h3 className="cc-h3" style={{ margin: 0 }}>
        {t('aiConn.settings.title')}
      </h3>
      <Select
        label={t('aiConn.settings.default')}
        description={t('aiConn.settings.defaultHint')}
        value={current}
        onChange={(v) => {
          if (!v) return void save({ defaultConnectionId: null });
          const [connectionId, model] = JSON.parse(v) as [string, string];
          void save({ defaultConnectionId: connectionId, defaultModel: model });
        }}
        items={[{ id: '', label: t('aiConn.settings.noDefault') }, ...options]}
      />
      <Toggle
        label={t('aiConn.settings.teachersOwn')}
        description={t('aiConn.settings.teachersOwnHint')}
        isSelected={data.settings.teacherConnectionsAllowed}
        onChange={(v) => void save({ teacherConnectionsAllowed: v })}
      />
      {data.personalConnections > 0 ? (
        <p className="cc-muted" style={{ margin: 0 }}>
          {t('aiConn.settings.personalCount', { count: data.personalConnections })}
        </p>
      ) : null}
    </div>
  );
}

/** Admin → AI tools → Assistant connections (S19a, D-179). */
export function AiConnectionsAdminSection() {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: AI_CONN_ADMIN_KEY, queryFn: () => call(C.aiConnectionsAdmin, {}) });
  const data = q.data;
  return (
    <section className="cc-card cc-stack" aria-labelledby="ai-conn-title" data-testid="ai-connections">
      <h2 id="ai-conn-title" className="cc-h2">
        {t('aiConn.title')}
      </h2>
      <p className="cc-muted" style={{ margin: 0 }}>
        {t('aiConn.intro')}
      </p>
      <p style={{ margin: 0 }} data-testid="ai-conn-not-yet">
        {t('aiConn.notYet')}
      </p>
      {q.error ? <Alert>{errorText(t, q.error)}</Alert> : null}
      {data ? (
        <>
          <AddButton scope="school" chatgptAvailable={data.chatgptAvailable} />
          <ConnectionsList scope="school" rows={data.connections} chatgptAvailable={data.chatgptAvailable} />
          <DefaultSettings data={data} />
          <div className="cc-stack">
            <h3 className="cc-h3" style={{ margin: 0 }}>
              {t('aiConn.chatgpt.title')}
            </h3>
            <p style={{ margin: 0 }}>{data.chatgptAvailable ? t('aiConn.chatgpt.on') : t('aiConn.chatgpt.off')}</p>
            {data.chatgptAvailable ? null : (
              <div>
                <Link to="/help" search={{ guide: 'admin', lang: locale }}>
                  {t('aiConn.chatgpt.howToApply')}
                </Link>
              </div>
            )}
          </div>
          <div>
            <Link to="/help" search={{ guide: 'admin', lang: locale }}>
              {t('aiConn.guideLink')}
            </Link>
          </div>
        </>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- Profile (teachers)
/** Profile → My assistant connections (teachers; S19a, D-179). */
export function OwnAiConnectionsSection() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: AI_CONN_OWN_KEY, queryFn: () => call(C.ownAiConnections, {}) });
  const data = q.data;
  return (
    <section className="cc-card cc-stack" aria-labelledby="ai-own-title" data-testid="ai-own-connections">
      <h2 id="ai-own-title" className="cc-h2">
        {t('aiConn.own.title')}
      </h2>
      <p style={{ margin: 0 }} data-testid="ai-conn-not-yet">
        {t('aiConn.notYet')}
      </p>
      {q.error ? <Alert>{errorText(t, q.error)}</Alert> : null}
      {data ? (
        <>
          <p className="cc-muted" style={{ margin: 0 }}>
            {data.schoolDefault ? t('aiConn.own.schoolDefault', { name: data.schoolDefault.name, model: data.schoolDefault.model }) : t('aiConn.own.noSchoolDefault')}
          </p>
          {data.allowed ? (
            <>
              <p className="cc-muted" style={{ margin: 0 }}>
                {t('aiConn.own.intro')}
              </p>
              <AddButton scope="personal" chatgptAvailable={data.chatgptAvailable} />
            </>
          ) : (
            <p style={{ margin: 0 }}>{t('aiConn.own.off')}</p>
          )}
          {data.allowed || data.connections.length ? <ConnectionsList scope="personal" rows={data.connections} chatgptAvailable={data.chatgptAvailable} /> : null}
        </>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- the provider's return
/**
 * `/ai-connections/return?state=…&code=…`: the address bar is cleared at once and the code is used
 * only by a POST after the button press (a GET never consumes it). Behind the PIN lock in classroom
 * mode (`ConsentGate`).
 */
export function AiConnectionReturnPage({ state, code }: { state?: string | undefined; code?: string | undefined }) {
  const { t } = useI18n();
  const [params] = useState(() => {
    if (typeof window !== 'undefined' && window.location.search) window.history.replaceState(null, '', window.location.pathname);
    return state && code ? { state, code } : null;
  });
  const [done, setDone] = useState<{ name: string; scope: 'school' | 'personal' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back =
    done?.scope === 'personal' ? (
      <Link to="/teacher/$page" params={{ page: 'profile' }}>
        {t('aiConn.return.back')}
      </Link>
    ) : (
      <Link to="/admin/ai-tools">{t('aiConn.return.back')}</Link>
    );
  return (
    <ConsentGate>
      <main className="cc-page cc-stack cc-ai-return" data-testid="ai-conn-return">
        <h1 className="cc-h1">{t('aiConn.return.title')}</h1>
        {!params ? (
          <Alert kind="warning">{t('aiConn.return.missing')}</Alert>
        ) : done ? (
          <>
            <Alert kind="success">{t('aiConn.return.done', { name: done.name })}</Alert>
            <div>{back}</div>
          </>
        ) : (
          <>
            <p>{t('aiConn.return.intro')}</p>
            {error ? <Alert>{error}</Alert> : null}
            <div>
              <Button
                variant="primary"
                isDisabled={busy}
                onPress={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const r = await call(C.finishAiConnectionOAuth, params);
                    setDone({ name: r.name, scope: r.scope });
                  } catch (err) {
                    setError(errorText(t, err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('aiConn.return.finish')}
              </Button>
            </div>
          </>
        )}
      </main>
    </ConsentGate>
  );
}
