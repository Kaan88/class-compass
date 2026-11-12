/**
 * Leftover points from the review of the 2026-11-12 audit fixes: a discarded assistant run ends the
 * streams that follow it (D-180), and a ChatGPT token refreshed while its connection was deleted is
 * never written back or used (D-179).
 */
import http from 'node:http';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiConnections } from '../../src/server/db/schema.ts';
import { openConnectionSecret, sealChatgptTokens, targetOf, type ConnectionRow } from '../../src/server/modules/aiConnections/provider.ts';
import { RunRegistry } from '../../src/server/modules/assistantChat/runs.ts';
import { makeEnv, seedUser, type TestEnv } from '../helpers.ts';

describe('a discarded run ends like a stopped one (review of the audit fixes, point 1)', () => {
  it('listeners hear an end event and the run is done, so an open stream closes', async () => {
    const registry = new RunRegistry();
    const run = registry.start('chat-1', 'user-1', 1000);
    let heard = 0;
    run.listeners.add(() => {
      heard += 1;
    });
    registry.discard(run);
    expect(heard).toBeGreaterThan(0);
    expect(run.done).toBe(true);
    expect(run.events).toEqual([{ type: 'end', end: 'cancelled', reason: null, seq: 1 }]);
    await run.finished;
    // The slot is free again and the run is forgotten.
    expect(registry.activeFor('chat-1')).toBeNull();
    expect(() => registry.get(run.id, 'user-1')).toThrow();
  });

  it('a run that already wrote something is not discarded', () => {
    const registry = new RunRegistry();
    const run = registry.start('chat-2', 'user-1', 1000);
    registry.emit(run, { type: 'text', messageId: 'm1', text: 'Hi' });
    registry.discard(run);
    expect(run.done).toBe(false);
    expect(registry.activeFor('chat-2')).toBe(run);
  });
});

describe('a ChatGPT token refreshed while the connection is deleted (review of the audit fixes, point 5)', () => {
  let env: TestEnv;
  let server: http.Server;
  let onToken: () => void = () => {};
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        onToken();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'fresh-access-token', refresh_token: 'fresh-refresh-token', expires_in: 3600 }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    env = await makeEnv(
      { AI_CHATGPT_SIGNIN: true, AI_CHATGPT_CLIENT_ID: 'test-client', AI_CHATGPT_AUTHORIZE_URL: 'https://auth.example.org/authorize', AI_CHATGPT_TOKEN_URL: 'https://auth.example.org/token', AI_CHATGPT_API_BASE: 'https://api.example.org' },
      { aiProviderUrls: { chatgpt: `${base}/api`, chatgptToken: `${base}/token` } },
    );
  });
  afterAll(async () => {
    await env.app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const insertConnection = async (id: string): Promise<ConnectionRow> => {
    const admin = await seedUser(env, 'admin', `admin-${id}`);
    const now = env.clock.now();
    env.db
      .insert(aiConnections)
      .values({ id, ownerUserId: null, type: 'chatgpt', name: 'ChatGPT', modelsJson: [{ name: 'gpt-x', testedAt: null, text: null, tools: null }], kvkkConfirmedAt: now, kvkkConfirmedBy: admin.id, createdBy: admin.id, createdAt: now, updatedAt: now })
      .run();
    // An access token about to expire, with a refresh token.
    const sealed = sealChatgptTokens(env.deps, id, { accessToken: 'old-access-token', refreshToken: 'old-refresh-token', expiresAt: now + 1000 });
    env.db.update(aiConnections).set({ secretCipher: sealed, secretSource: 'oauth' }).where(eq(aiConnections.id, id)).run();
    return env.db.select().from(aiConnections).where(eq(aiConnections.id, id)).get()!;
  };

  it('a live connection gets the refreshed token, stored again', async () => {
    const row = await insertConnection('conn-live');
    onToken = () => {};
    const target = await targetOf(env.deps, row);
    expect(target.secret).toBe('fresh-access-token');
    const stored = env.db.select().from(aiConnections).where(eq(aiConnections.id, row.id)).get()!;
    expect(openConnectionSecret(env.deps, stored)).toContain('fresh-access-token');
  });

  it('deleted while the refresh was answered: the token is neither written to the row nor used', async () => {
    const row = await insertConnection('conn-deleted');
    const before = row.secretCipher;
    onToken = () => {
      env.db.update(aiConnections).set({ deletedAt: env.clock.now(), secretCipher: null }).where(eq(aiConnections.id, row.id)).run();
    };
    await expect(targetOf(env.deps, row)).rejects.toMatchObject({ failure: 'NEEDS_KEY' });
    const stored = env.db.select().from(aiConnections).where(eq(aiConnections.id, row.id)).get()!;
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.secretCipher).toBeNull();
    expect(before).not.toBeNull();
  });
});
