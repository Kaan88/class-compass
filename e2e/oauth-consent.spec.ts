/**
 * OAuth consent for AI apps (S14h2, D-160): an app registers (DCR) with a loopback address like Claude
 * Code, the teacher's browser opens the authorize address on a classroom device (locked: the PIN lock
 * screen comes first and the same page follows), sees the "not checked by your school" banner and
 * the return host, narrows a permission, gives the password again and allows; the browser is sent
 * to the loopback address with the code and the state, and the code works once at the token
 * endpoint. Deny sends access_denied. Profile → AI tools lists the connected app and Disconnect ends
 * it. The consent page fits 375 px at 200 % text and passes axe. AI tools are switched off again in
 * `finally` (which also ends every connection).
 */
import crypto from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, ensurePin, login, PASSWORD, PIN } from './helpers.ts';

const CALLBACK = 'http://127.0.0.1:47123/callback';

async function seriousViolations(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};

const authorizePath = (origin: string, clientId: string, challenge: string, state: string) =>
  `/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state, resource: `${origin}/mcp`, scope: 'classes:read reports:read' }).toString()}`;

test('OAuth consent: PIN lock, password again, narrowed scope, allow to a loopback address; deny; disconnect', async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(admin, 'admin');
  try {
    expect((await api(admin, 'PUT', '/api/admin/ai-tools', { mcpEnabled: true })).status).toBe(200);
    const origin = new URL(admin.url()).origin;
    // The app registers itself like Claude Code does (a loopback address).
    const reg = await page.request.post('/oauth/register', { headers: { 'content-type': 'application/json' }, data: JSON.stringify({ client_name: 'Claude Code (OAuth E2E)', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' }) });
    expect(reg.status()).toBe(201);
    const clientId = ((await reg.json()) as { client_id: string }).client_id;
    // The loopback "app" that receives the browser.
    const arrived: URL[] = [];
    await page.route('http://127.0.0.1:47123/**', async (route) => {
      arrived.push(new URL(route.request().url()));
      await route.fulfill({ status: 200, contentType: 'text/plain', body: 'Back in the app.' });
    });

    await login(page, 'english');
    await ensurePin(page);
    await page.goto('/classroom'); // a classroom device: the teacher area is locked
    await expect(page.getByTestId('classroom-shell')).toBeVisible();

    const { verifier, challenge } = pkce();
    await page.goto(authorizePath(origin, clientId, challenge, 'e2e-state-1'));
    await expect(page).toHaveURL(/\/oauth\/consent\?request=/u);
    await expect(page.getByTestId('lock-screen')).toBeVisible();
    await page.getByLabel('Enter your PIN').fill(PIN);
    await page.getByRole('button', { name: 'Unlock' }).click();
    // The same consent page follows (not the teacher menu): it holds no student data.
    const consent = page.getByTestId('oauth-consent');
    await expect(consent.getByRole('heading', { name: 'Connect an AI app', level: 1 })).toBeVisible();
    await expect(consent).toContainText('This app is not checked by your school');
    await expect(consent.getByTestId('oauth-client-name')).toHaveText('Claude Code (OAuth E2E)');
    await expect(consent.getByTestId('oauth-redirect-host')).toHaveText('127.0.0.1:47123');
    await expect(consent).toContainText('This address is on this computer');
    await expect(consent.getByText(/Students are shown as pseudonyms/u)).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    // Narrow: only the classes, not the reports.
    await expect(consent.getByLabel('See my classes, students and homework')).toBeChecked();
    await consent.getByLabel('Read reports and student timelines').uncheck();
    // The password is asked again.
    await consent.getByLabel('Current password').fill('not-the-password');
    await consent.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(consent.getByRole('alert')).toContainText('The current password is not correct.');
    await consent.getByLabel('Current password').fill(PASSWORD);
    await consent.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect.poll(() => arrived.length).toBe(1);
    const back = arrived[0]!;
    expect(back.searchParams.get('state')).toBe('e2e-state-1');
    expect(back.searchParams.get('iss')).toBe(origin);
    const code = back.searchParams.get('code')!;
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    // The app exchanges the code once (form body, public client, PKCE).
    const form = { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: CALLBACK, resource: `${origin}/mcp` };
    const tok = await page.request.post('/oauth/token', { form });
    expect(tok.status()).toBe(200);
    const tokens = (await tok.json()) as { access_token: string; refresh_token: string; scope: string };
    expect(tokens.scope).toBe('classes:read');
    expect((await page.request.post('/oauth/token', { form })).status()).toBe(400); // single use
    // The replay ended the connection; connect once more for the Profile part below.
    const init = (token: string) =>
      page.request.post('/mcp', {
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        data: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } }),
      });
    expect((await init(tokens.access_token)).status()).toBe(401);

    // Deny: back to the app with access_denied and the state, no code.
    await page.goto(authorizePath(origin, clientId, pkce().challenge, 'e2e-state-2'));
    await expect(consent.getByRole('heading', { name: 'Connect an AI app', level: 1 })).toBeVisible();
    await consent.getByRole('button', { name: 'Do not allow' }).click();
    await expect.poll(() => arrived.length).toBe(2);
    expect(arrived[1]!.searchParams.get('error')).toBe('access_denied');
    expect(arrived[1]!.searchParams.get('state')).toBe('e2e-state-2');
    expect(arrived[1]!.searchParams.get('code')).toBeNull();

    // Allow again; at 375 px with 200 % text the page does not scroll sideways.
    const second = pkce();
    await page.goto(authorizePath(origin, clientId, second.challenge, 'e2e-state-3'));
    await expect(consent.getByRole('heading', { name: 'Connect an AI app', level: 1 })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate(() => document.documentElement.style.setProperty('--cc-text-scale', '2'));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
    expect(await seriousViolations(page)).toEqual([]);
    await page.evaluate(() => document.documentElement.style.setProperty('--cc-text-scale', '1'));
    await page.setViewportSize({ width: 1920, height: 1080 });
    await consent.getByLabel('Current password').fill(PASSWORD);
    await consent.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect.poll(() => arrived.length).toBe(3);
    const tok2 = await page.request.post('/oauth/token', { form: { ...form, code: arrived[2]!.searchParams.get('code')!, code_verifier: second.verifier } });
    const access = ((await tok2.json()) as { access_token: string }).access_token;
    expect((await init(access)).status()).toBe(200);

    // Profile → AI tools: the connected app, then Disconnect.
    await page.goto('/teacher/profile');
    const section = page.getByTestId('ai-tools');
    const row = section.getByRole('row', { name: /Claude Code \(OAuth E2E\)/u }).filter({ hasText: 'Active' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('127.0.0.1:47123');
    expect(await seriousViolations(page)).toEqual([]);
    await row.getByRole('button', { name: 'Disconnect' }).click();
    await page.getByTestId('inline-confirm').getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByText('App disconnected')).toBeVisible();
    expect((await init(access)).status()).toBe(401);
  } finally {
    expect((await api(admin, 'PUT', '/api/admin/ai-tools', { mcpEnabled: false })).status).toBe(200);
    await ctx.close();
    await adminCtx.close();
  }
});

test('Admin → AI tools: registered apps, connections and the allowed hosts (audited)', async ({ page }) => {
  await login(page, 'admin');
  try {
    expect((await api(page, 'PUT', '/api/admin/ai-tools', { mcpEnabled: true })).status).toBe(200);
    const reg = await page.request.post('/oauth/register', { headers: { 'content-type': 'application/json' }, data: JSON.stringify({ client_name: 'Admin list app (E2E)', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }) });
    expect(reg.status()).toBe(201);
    await page.goto('/admin/ai-tools');
    await expect(page.getByRole('heading', { name: 'Allowed hosts for AI apps' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Hosts' })).toHaveValue('claude.ai');
    const app = page.getByRole('row', { name: /Admin list app \(E2E\)/u });
    await expect(app).toContainText('Registered itself');
    expect(await seriousViolations(page)).toEqual([]);
    await app.getByRole('button', { name: 'Revoke' }).click();
    await page.getByTestId('inline-confirm').getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByRole('row', { name: /Admin list app \(E2E\)/u })).toContainText('Revoked');
    await page.getByRole('textbox', { name: 'Hosts' }).fill('claude.ai connectors.example.org');
    await page.getByRole('button', { name: 'Save hosts' }).click();
    await expect.poll(async () => (await api(page, 'GET', '/api/admin/ai-tools')).body.redirectHosts).toEqual(['claude.ai', 'connectors.example.org']);
  } finally {
    expect((await api(page, 'PUT', '/api/admin/ai-tools/redirect-hosts', { hosts: ['claude.ai'] })).status).toBe(200);
    expect((await api(page, 'PUT', '/api/admin/ai-tools', { mcpEnabled: false })).status).toBe(200);
  }
});
