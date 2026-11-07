import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { v7 } from 'uuid';
import { defineCommand } from '../../src/server/lib/commands.ts';
import { AppError } from '../../src/server/lib/errors.ts';
import { Client, makeEnv, seedUser, type TestEnv } from '../helpers.ts';

let effects = 0;
defineCommand({
  type: 'test.increment',
  payload: z.object({ by: z.number().int() }),
  handle: (_ctx, p) => {
    if (p.by < 0) throw new AppError('VALIDATION', 'negative');
    effects += p.by;
    return { total: effects };
  },
});

let env: TestEnv;
beforeEach(async () => {
  effects = 0;
  env = await makeEnv();
  await seedUser(env, 'teacher', 'ayse.teacher');
});
afterEach(async () => env.app.close());

const send = (c: Client, commands: unknown[]) => c.post('/api/commands', { commands });

describe('idempotent commands (UX-11, CNT-5)', () => {
  it('applies a command once even when retried', async () => {
    const c = new Client(env);
    await c.login('ayse.teacher');
    const cmd = { opId: v7(), type: 'test.increment', payload: { by: 1 } };
    const r1 = await send(c, [cmd]);
    const r2 = await send(c, [cmd]);
    expect(r1.body.results[0]).toMatchObject({ ok: true, replayed: false, result: { total: 1 } });
    expect(r2.body.results[0]).toMatchObject({ ok: true, replayed: true, result: { total: 1 } });
    expect(effects).toBe(1);
  });

  it('treats a reused opId with different content as a conflict', async () => {
    const c = new Client(env);
    await c.login('ayse.teacher');
    const opId = v7();
    await send(c, [{ opId, type: 'test.increment', payload: { by: 1 } }]);
    const r = await send(c, [{ opId, type: 'test.increment', payload: { by: 5 } }]);
    expect(r.body.results[0]).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(effects).toBe(1);
  });

  it('records rejections so replays stay consistent', async () => {
    const c = new Client(env);
    await c.login('ayse.teacher');
    const cmd = { opId: v7(), type: 'test.increment', payload: { by: -1 } };
    expect((await send(c, [cmd])).body.results[0]).toMatchObject({ ok: false, replayed: false });
    expect((await send(c, [cmd])).body.results[0]).toMatchObject({ ok: false, replayed: true });
  });

  it('processes a batch in order', async () => {
    const c = new Client(env);
    await c.login('ayse.teacher');
    const r = await send(c, [1, 2, 3].map((by) => ({ opId: v7(), type: 'test.increment', payload: { by } })));
    expect(r.body.results.map((x: any) => x.result.total)).toEqual([1, 3, 6]);
  });

  it('returns a machine-readable reason with rejections so the client can translate them (UX-3)', async () => {
    const c = new Client(env);
    await c.login('ayse.teacher');
    const opId = v7();
    await send(c, [{ opId, type: 'test.increment', payload: { by: 1 } }]);
    const reused = await send(c, [{ opId, type: 'test.increment', payload: { by: 2 } }]);
    expect(reused.body.results[0]).toMatchObject({ ok: false, replayed: true, error: { code: 'CONFLICT', reason: 'OP_ID_REUSED' } });
    const unknown = await send(c, [{ opId: v7(), type: 'test.nope', payload: {} }]);
    expect(unknown.body.results[0].error).toMatchObject({ code: 'VALIDATION', reason: 'UNKNOWN_COMMAND' });
  });

  it('refuses a batch queued by another account on the same device (ACC-9, UX-11)', async () => {
    const mehmet = await seedUser(env, 'teacher', 'mehmet.teacher');
    const ayse = new Client(env);
    const me = (await ayse.login('ayse.teacher')).body;
    // The device's outbox still holds Mehmet's commands while Ayşe is signed in.
    const r = await ayse.post('/api/commands', { asUser: mehmet.id, commands: [{ opId: v7(), type: 'test.increment', payload: { by: 1 } }] });
    expect(r.status).toBe(409);
    expect(r.body.error.details.reason).toBe('WRONG_ACCOUNT');
    expect(effects).toBe(0);
    // Her own commands go through.
    const own = await ayse.post('/api/commands', { asUser: me.id, commands: [{ opId: v7(), type: 'test.increment', payload: { by: 1 } }] });
    expect(own.body.results[0]).toMatchObject({ ok: true });
    expect(effects).toBe(1);
  });

  it('requires a signed-in teacher', async () => {
    const c = new Client(env);
    expect((await send(c, [{ opId: v7(), type: 'test.increment', payload: { by: 1 } }])).status).toBe(401);
  });
});
