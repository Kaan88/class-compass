/**
 * "Connect an AI app" (S19c, D-181): the first thing a teacher sees under Profile → AI tools. The teacher
 * picks ChatGPT, Claude (claude.ai and Claude Desktop), Claude Code or another MCP client and follows
 * numbered steps with this school's exact MCP address (from the server's configuration), copy buttons,
 * the method the app uses (OAuth sign-in or a personal token), a small diagram without screenshots or
 * real accounts, and "Check connection", which shows the last successful tool call from that app (from
 * the existing call log; nothing new is tracked). When AI tools are off, or the app's return host is
 * not allowed, the page says what the administrator must do (teachers: "ask your administrator").
 */
import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import * as M from '../../shared/contracts/mcp.ts';
import { AI_APPS, MCP_PATH, MCP_SERVER_NAME, type AiApp } from '../../shared/mcp.ts';
// This page's strings (area dictionary, D-179/D-181); Admin → AI tools gets them through this file too.
import '../../shared/i18n/areas/aiConnect.ts';
import { call } from '../lib/api.ts';
import { copyText, showManualCopy } from '../lib/clipboard.ts';
import { errorText } from '../lib/errors.ts';
import { useI18n } from '../lib/i18n.tsx';
import type { Me } from '../lib/session.ts';
import { Button } from '../ui/Button.tsx';
import { Alert } from '../ui/Feedback.tsx';
import { IconCheck, IconCopy, IconKey, IconSync } from '../ui/icons.tsx';

export const AI_SETUP_KEY = ['sensitive', 'ai-tools', 'setup'] as const;

type T = ReturnType<typeof useI18n>['t'];

/** A copy button that falls back to showing the text for copying by hand (D-140). */
export function CopyButton({ text, label, testId }: { text: string; label: string; testId?: string }) {
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

/** A value to type or paste somewhere else, shown in full with its own copy button. */
function Copyable({ text, label, testId }: { text: string; label: string; testId: string }) {
  return (
    <div className="cc-ai-copyable">
      <code className="cc-ai-url" data-testid={`${testId}-text`}>
        {text}
      </code>
      <div>
        <CopyButton text={text} label={label} testId={testId} />
      </div>
    </div>
  );
}

export const appName = (t: T, app: AiApp) => t(`aiConnect.app.${app}` as const);

/** The Claude Code commands (D-181): sign-in, personal token, and both behind a Cloudflare Access service token. */
export function claudeCodeCommands(url: string) {
  const base = `claude mcp add --transport http ${MCP_SERVER_NAME} ${url}`;
  const bearer = '--header "Authorization: Bearer <your token>"';
  const access = '--header "CF-Access-Client-Id: <id>" --header "CF-Access-Client-Secret: <secret>"';
  return { signIn: base, token: `${base} ${bearer}`, access: `${base} ${bearer} ${access}` };
}

/** A small diagram of the connection: the app, this school's address, and the person who allows it. No screenshots, no accounts. */
function Diagram({ app }: { app: AiApp }) {
  const { t } = useI18n();
  const method = app === 'chatgpt' || app === 'claude' ? 'oauth' : 'either';
  return (
    <ol className="cc-ai-flow" aria-label={t('aiConnect.diagram')} data-testid="ai-flow">
      <li className="cc-ai-flow__node">
        <span className="cc-ai-flow__title">{appName(t, app)}</span>
        <span className="cc-ai-flow__hint">{t('aiConnect.flow.app')}</span>
      </li>
      <li className="cc-ai-flow__node">
        <span className="cc-ai-flow__title">{t('aiConnect.flow.school')}</span>
        <span className="cc-ai-flow__hint">{MCP_PATH}</span>
      </li>
      <li className="cc-ai-flow__node">
        <span className="cc-ai-flow__title">{method === 'oauth' ? t('aiConnect.flow.consent') : t('aiConnect.flow.consentOrToken')}</span>
        <span className="cc-ai-flow__hint">{t('aiConnect.flow.you')}</span>
      </li>
    </ol>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="cc-ai-steps" data-testid="ai-steps">
      {children}
    </ol>
  );
}

/** What the administrator must do before this app can sign in; teachers are asked to pass it on. */
function HostBlocked({ app, host, admin }: { app: AiApp; host: string; admin: boolean }) {
  const { t } = useI18n();
  return (
    <Alert kind="warning">
      <span data-testid="ai-host-blocked">{admin ? t('aiConnect.hostBlockedAdmin', { app: appName(t, app), host }) : t('aiConnect.hostBlockedTeacher', { app: appName(t, app), host })}</span>
      {admin ? (
        <>
          {' '}
          <Link to="/admin/ai-tools">{t('aiConnect.openChecklist')}</Link>
        </>
      ) : null}
    </Alert>
  );
}

/** "Check connection": the last successful tool call from this app, read again on demand. */
function CheckConnection({ app, status, onCheck, checking, checked }: { app: AiApp; status: M.AiAppStatus | undefined; onCheck: () => void; checking: boolean; checked: boolean }) {
  const { t, locale } = useI18n();
  const fmt = new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const last = status?.lastToolCall ?? null;
  const name = appName(t, app);
  let text: string;
  if (last) {
    const via = last.via === 'connection' ? t('aiConnect.viaConnection', { name: last.name }) : t('aiConnect.viaToken', { name: last.name });
    text = t('aiConnect.lastCall', { app: name, tool: last.tool, when: fmt.format(last.at), via });
  } else if (status?.lastSeenAt) text = t('aiConnect.seenNoTool', { app: name, when: fmt.format(status.lastSeenAt) });
  else text = t('aiConnect.noCall', { app: name });
  return (
    <div className="cc-stack cc-ai-check">
      <div>
        <Button onPress={onCheck} isDisabled={checking} data-testid="ai-check">
          <IconSync />
          {t('aiConnect.check')}
        </Button>
      </div>
      <div role="status" aria-live="polite" data-testid="ai-check-result" data-state={last ? (last.live ? 'ok' : 'ended') : 'none'}>
        {checked || last ? (
          <p className="cc-ai-check__result" style={{ margin: 0 }}>
            {last && last.live ? <IconCheck /> : null}
            <span>{text}</span>
          </p>
        ) : null}
        {checked && last && !last.live ? <p style={{ margin: 0 }}>{t('aiConnect.ended')}</p> : null}
      </div>
    </div>
  );
}

function ChatGptSteps({ url }: { url: string }) {
  const { t } = useI18n();
  return (
    <Steps>
      <li>{t('aiConnect.chatgpt.step1')}</li>
      <li className="cc-stack">
        <span>{t('aiConnect.chatgpt.step2')}</span>
        <Copyable text={url} label={t('aiTools.copyAddress')} testId="ai-copy-url" />
      </li>
      <li>{t('aiConnect.chatgpt.step3')}</li>
      <li>{t('aiConnect.chatgpt.step4')}</li>
      <li>{t('aiConnect.chatgpt.step5')}</li>
    </Steps>
  );
}

function ClaudeSteps({ url }: { url: string }) {
  const { t } = useI18n();
  return (
    <Steps>
      <li>{t('aiConnect.claude.step1')}</li>
      <li className="cc-stack">
        <span>{t('aiConnect.claude.step2')}</span>
        <Copyable text={url} label={t('aiTools.copyAddress')} testId="ai-copy-url" />
      </li>
      <li>{t('aiConnect.claude.step3')}</li>
      <li>{t('aiConnect.claude.step4')}</li>
      <li>{t('aiConnect.claude.step5')}</li>
    </Steps>
  );
}

function ClaudeCodeSteps({ url, signInBlocked, onMakeToken }: { url: string; signInBlocked: ReactNode; onMakeToken: () => void }) {
  const { t } = useI18n();
  const cmd = claudeCodeCommands(url);
  return (
    <div className="cc-stack">
      <h5 className="cc-ai-subhead" style={{ margin: 0 }}>
        {t('aiConnect.code.signInTitle')}
      </h5>
      {signInBlocked}
      <Steps>
        <li className="cc-stack">
          <span>{t('aiConnect.code.signIn1')}</span>
          <Copyable text={cmd.signIn} label={t('aiConnect.copySignInCommand')} testId="ai-copy-signin" />
        </li>
        <li>{t('aiConnect.code.signIn2')}</li>
        <li>{t('aiConnect.code.signIn3')}</li>
      </Steps>
      <h5 className="cc-ai-subhead" style={{ margin: 0 }}>
        {t('aiConnect.code.tokenTitle')}
      </h5>
      <Steps>
        <li className="cc-stack">
          <span>{t('aiConnect.code.token1')}</span>
          <div>
            <Button onPress={onMakeToken} data-testid="ai-make-token">
              <IconKey />
              {t('aiConnect.makeToken')}
            </Button>
          </div>
        </li>
        <li className="cc-stack">
          <span>{t('aiConnect.code.token2')}</span>
          <Copyable text={cmd.token} label={t('aiConnect.copyTokenCommand')} testId="ai-copy-token-cmd" />
        </li>
      </Steps>
      <h5 className="cc-ai-subhead" style={{ margin: 0 }}>
        {t('aiConnect.code.accessTitle')}
      </h5>
      <p style={{ margin: 0 }}>{t('aiConnect.code.access')}</p>
      <Copyable text={cmd.access} label={t('aiConnect.copyAccessCommand')} testId="ai-copy-access" />
      <p className="cc-muted" style={{ margin: 0 }}>
        {t('aiConnect.code.placeholders')}
      </p>
    </div>
  );
}

function OtherSteps({ url, onMakeToken }: { url: string; onMakeToken: () => void }) {
  const { t } = useI18n();
  return (
    <Steps>
      <li className="cc-stack">
        <span>{t('aiConnect.other.step1')}</span>
        <Copyable text={url} label={t('aiTools.copyAddress')} testId="ai-copy-url" />
      </li>
      <li>{t('aiConnect.other.step2')}</li>
      <li className="cc-stack">
        <span>{t('aiConnect.other.step3')}</span>
        <div>
          <Button onPress={onMakeToken} data-testid="ai-make-token">
            <IconKey />
            {t('aiConnect.makeToken')}
          </Button>
        </div>
      </li>
      <li>{t('aiConnect.other.step4')}</li>
    </Steps>
  );
}

/** What the administrator must do while AI tools are off (teachers: ask them). */
export function AiToolsOff({ admin }: { admin: boolean }) {
  const { t } = useI18n();
  return (
    <div className="cc-stack" data-testid="ai-off">
      <Alert kind="warning">{admin ? t('aiConnect.offAdmin') : t('aiConnect.offTeacher')}</Alert>
      <p style={{ margin: 0 }}>{t('aiConnect.offWhat')}</p>
      <ol className="cc-ai-steps">
        <li>{t('aiConnect.offStep1')}</li>
        <li>{t('aiConnect.offStep2')}</li>
        <li>{t('aiConnect.offStep3')}</li>
      </ol>
      {admin ? (
        <div>
          <Link to="/admin/ai-tools">{t('aiConnect.openChecklist')}</Link>
        </div>
      ) : null}
    </div>
  );
}

/** Profile → AI tools → "Connect an AI app". `onMakeToken` opens the token dialog (Advanced). */
export function ConnectAiApp({ me, onMakeToken }: { me: Me; onMakeToken: () => void }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: AI_SETUP_KEY, queryFn: () => call(M.aiToolsSetup, {}) });
  const [app, setApp] = useState<AiApp>('chatgpt');
  const [checked, setChecked] = useState<Set<AiApp>>(new Set());
  const admin = me.role === 'admin';
  const data = q.data;
  if (q.error) return <Alert>{errorText(t, q.error)}</Alert>;
  if (!data) return null;
  if (!data.enabled) return <AiToolsOff admin={admin} />;
  const status = data.apps.find((a) => a.app === app);
  const blocked = status && !status.returnHostAllowed && status.returnHost ? <HostBlocked app={app} host={status.returnHost} admin={admin} /> : null;
  const method = app === 'chatgpt' || app === 'claude' ? t('aiConnect.method.oauth') : app === 'claude-code' ? t('aiConnect.method.both') : t('aiConnect.method.either');
  return (
    <div className="cc-stack" data-testid="ai-connect">
      <h3 className="cc-h3" style={{ margin: 0 }}>
        {t('aiConnect.title')}
      </h3>
      <p className="cc-muted" style={{ margin: 0 }}>
        {t('aiConnect.intro')}
      </p>
      <Alert kind="warning">{data.studentDataAllowed ? t('aiTools.schoolAllowsNames') : t('aiTools.schoolPseudonymous')}</Alert>
      <fieldset className="cc-fieldset cc-ai-apps">
        <legend className="cc-field__label">{t('aiConnect.choose')}</legend>
        {AI_APPS.map((a) => (
          <label key={a} className="cc-ai-app" data-testid={`ai-app-${a}`}>
            <input type="radio" name="ai-app" value={a} checked={app === a} onChange={() => setApp(a)} />
            <span className="cc-ai-app__text">
              <span className="cc-ai-app__name">{appName(t, a)}</span>
              <span className="cc-ai-app__hint">{t(`aiConnect.appHint.${a}` as const)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <section className="cc-stack cc-ai-panel" aria-labelledby="ai-panel-title" data-testid="ai-panel" data-app={app}>
        <h4 id="ai-panel-title" className="cc-h3" style={{ margin: 0 }}>
          {t('aiConnect.panelTitle', { app: appName(t, app) })}
        </h4>
        <p style={{ margin: 0 }} data-testid="ai-method">
          <strong>{t('aiConnect.methodLabel')}</strong> {method}
        </p>
        <Diagram app={app} />
        {app !== 'claude-code' ? blocked : null}
        {app === 'chatgpt' ? <ChatGptSteps url={data.url} /> : null}
        {app === 'claude' ? <ClaudeSteps url={data.url} /> : null}
        {app === 'claude-code' ? <ClaudeCodeSteps url={data.url} signInBlocked={blocked} onMakeToken={onMakeToken} /> : null}
        {app === 'other' ? <OtherSteps url={data.url} onMakeToken={onMakeToken} /> : null}
        <p className="cc-muted" style={{ margin: 0 }}>
          {admin ? t('aiConnect.tryAdmin') : t('aiConnect.tryTeacher')}
        </p>
        <CheckConnection
          app={app}
          status={status}
          checking={q.isFetching}
          checked={checked.has(app)}
          onCheck={() => {
            void q.refetch().then(() => setChecked((s) => new Set([...s, app])));
          }}
        />
      </section>
    </div>
  );
}
