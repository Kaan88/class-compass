/**
 * The OAuth consent page (S14h2, D-160): `/oauth/consent?request=<id>`. An AI app (claude.ai, Claude
 * Desktop, Claude Code) sent the browser here through `/oauth/authorize`; the signed-in teacher or
 * administrator sees who is asking (the app's own name, as untrusted text) and, prominently, where the
 * browser will be sent; narrows the permissions; chooses the privacy mode (only when the school allows
 * student data) and how long it lasts (within the school's cap); and allows with the password again,
 * or denies. Behind the PIN lock in classroom mode (ConsentGate). `?error=<code>` shows why the
 * authorize step could not even return to the app (never redirected, no open redirect).
 */
import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import * as O from '../../shared/contracts/oauth.ts';
import { OAUTH_PAGE_ERRORS, type OAuthPageError } from '../../shared/contracts/oauth.ts';
import type { AiPrivacyMode, McpScope } from '../../shared/mcp.ts';
import { call } from '../lib/api.ts';
import { errorText } from '../lib/errors.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useMe } from '../lib/session.ts';
import { Button } from '../ui/Button.tsx';
import { Alert } from '../ui/Feedback.tsx';
import { Select, TextField } from '../ui/Fields.tsx';
import { DAY_CHOICES } from './AiTools.tsx';
import { ConsentGate } from './Lock.tsx';
import { homeFor } from './guards.ts';

export interface ConsentSearch {
  request?: string | undefined;
  error?: string | undefined;
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <main className="cc-page cc-oauth" data-testid="oauth-consent">
      <div className="cc-card cc-stack">
        <p className="cc-muted" style={{ margin: 0, fontWeight: 700 }}>
          {t('app.name')}
        </p>
        <h1 className="cc-h1">{title}</h1>
        {children}
      </div>
    </main>
  );
}

/** Why the authorize step stopped on our page. */
function ErrorPage({ code }: { code: string }) {
  const { t } = useI18n();
  const me = useMe();
  const known: OAuthPageError = (OAUTH_PAGE_ERRORS as readonly string[]).includes(code) ? (code as OAuthPageError) : 'INVALID_REQUEST';
  return (
    <Frame title={t('oauth.errorTitle')}>
      <Alert>{t(`oauth.pageError.${known}` as const)}</Alert>
      <p className="cc-muted" style={{ margin: 0 }}>
        {t('oauth.errorHint')}
      </p>
      {me ? (
        <div>
          <Link to={homeFor(me)}>{t('oauth.backToApp')}</Link>
        </div>
      ) : null}
    </Frame>
  );
}

function Consent({ requestId }: { requestId: string }) {
  const { t } = useI18n();
  const me = useMe();
  const q = useQuery({ queryKey: ['sensitive', 'oauth-request', requestId], queryFn: () => call(O.getOAuthRequest, { requestId }), retry: false, staleTime: Infinity });
  const view = q.data;
  const [scopes, setScopes] = useState<McpScope[] | null>(null);
  const [days, setDays] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<AiPrivacyMode>('pseudonymous');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<'allow' | 'deny' | null>(null);
  if (q.error) {
    return (
      <Frame title={t('oauth.title')}>
        <Alert>{errorText(t, q.error)}</Alert>
        <p className="cc-muted" style={{ margin: 0 }}>
          {t('oauth.errorHint')}
        </p>
      </Frame>
    );
  }
  if (!view || !me) return null;
  const chosen = scopes ?? view.preselected;
  const dayChoices = [...new Set([...DAY_CHOICES.filter((d) => d <= view.maxDays), view.maxDays])].sort((a, b) => a - b);
  const byEmail = me.signInMethod === 'email_link';
  const toggle = (s: McpScope, on: boolean) => setScopes(on ? [...new Set([...chosen, s])] : chosen.filter((x) => x !== s));
  const send = async (allow: boolean) => {
    setError(null);
    if (allow && !chosen.length) return setError(t('aiTools.scopeRequired'));
    setBusy(true);
    try {
      const r = await call(O.decideOAuthRequest, {
        requestId,
        allow,
        ...(allow ? { scopes: chosen, days: Number(days ?? view.defaultDays), privacy, ...(byEmail ? {} : { currentPassword: password }) } : {}),
      });
      setLeaving(allow ? 'allow' : 'deny');
      window.location.assign(r.redirectTo);
    } catch (err) {
      setError(errorText(t, err));
      setBusy(false);
    }
  };
  if (leaving) {
    return (
      <Frame title={t('oauth.title')}>
        <p role="status" data-testid="oauth-leaving">
          {leaving === 'allow' ? t('oauth.leavingAllow', { host: view.redirectHost }) : t('oauth.leavingDeny', { host: view.redirectHost })}
        </p>
      </Frame>
    );
  }
  return (
    <Frame title={t('oauth.title')}>
      <Alert kind="warning">{t('oauth.notChecked')}</Alert>
      <section className="cc-stack" aria-labelledby="oauth-app">
        <h2 id="oauth-app" className="cc-h3" style={{ margin: 0 }}>
          {t('oauth.whoAsks')}
        </h2>
        <p className="cc-oauth__app" data-testid="oauth-client-name">
          {view.clientName}
        </p>
        <p className="cc-muted" style={{ margin: 0 }}>
          {view.clientIdHost ? t('oauth.nameFromHost', { host: view.clientIdHost }) : t('oauth.nameFromApp')}
        </p>
        <p style={{ margin: 0 }}>{t('oauth.sendTo')}</p>
        <p className="cc-oauth__host" data-testid="oauth-redirect-host">
          {view.redirectHost}
        </p>
        {view.redirectLoopback ? <Alert kind="warning">{t('oauth.loopbackWarning')}</Alert> : null}
      </section>
      <form
        className="cc-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void send(true);
        }}
      >
        <fieldset className="cc-stack cc-fieldset">
          <legend className="cc-field__label">{t('oauth.permissions')}</legend>
          <p className="cc-field__hint" style={{ margin: 0 }}>
            {t('oauth.permissionsHint')}
          </p>
          <div className="cc-ai-scopes">
            {view.offered.map((s) => (
              <label key={s} className="cc-check">
                <input type="checkbox" checked={chosen.includes(s)} onChange={(e) => toggle(s, e.target.checked)} />
                <span>{t(`aiTools.scope.${s}` as const)}</span>
              </label>
            ))}
          </div>
          {view.notAvailable.length ? (
            <p className="cc-muted" style={{ margin: 0 }} data-testid="oauth-not-available">
              {t('oauth.notAvailable', { list: view.notAvailable.map((s) => t(`aiTools.scope.${s}` as const)).join(', ') })}
            </p>
          ) : null}
          {view.unknown.length ? (
            <p className="cc-muted" style={{ margin: 0 }}>
              {t('oauth.unknownScopes', { list: view.unknown.join(', ') })}
            </p>
          ) : null}
        </fieldset>
        {view.studentDataAllowed ? (
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
        ) : (
          <p style={{ margin: 0 }}>{t('oauth.pseudonymsOnly')}</p>
        )}
        <Select label={t('oauth.validFor')} description={t('oauth.validForHint')} value={days ?? String(view.defaultDays)} onChange={setDays} items={dayChoices.map((d) => ({ id: String(d), label: t('aiTools.days', { count: d }) }))} />
        {byEmail ? (
          me.reauthFresh ? null : <Alert kind="warning">{t('error.REAUTH_REQUIRED')}</Alert>
        ) : (
          <TextField label={t('password.current')} description={t('oauth.passwordHint')} type="password" autoComplete="current-password" isRequired value={password} onChange={setPassword} />
        )}
        {error ? <Alert>{error}</Alert> : null}
        <div className="cc-row cc-oauth__actions">
          <Button onPress={() => void send(false)} isDisabled={busy}>
            {t('oauth.deny')}
          </Button>
          <Button type="submit" variant="primary" isDisabled={busy}>
            {t('oauth.allow')}
          </Button>
        </div>
        <p className="cc-muted" style={{ margin: 0 }}>
          {t('oauth.afterwards')}
        </p>
        <div>
          <Link to="/help" search={{ guide: 'ai-tools', lang: me.locale }}>
            {t('aiTools.guideLink')}
          </Link>
        </div>
      </form>
    </Frame>
  );
}

export function OAuthConsentPage({ search }: { search: ConsentSearch }) {
  if (search.error) return <ErrorPage code={search.error} />;
  if (!search.request) return <ErrorPage code="INVALID_REQUEST" />;
  return (
    <ConsentGate>
      <Consent key={search.request} requestId={search.request} />
    </ConsentGate>
  );
}
