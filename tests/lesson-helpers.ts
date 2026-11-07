/** Command helpers for lesson-scoped tests (S5+). Fictional data only. */
import { expect } from 'vitest';
import { v7 } from 'uuid';
import type { Client } from './helpers.ts';
import { ok } from './school-fixture.ts';

export type CmdResult = { opId: string; ok: boolean; replayed: boolean; result?: any; error?: { code: string; reason?: string } };

export async function cmd(c: Client, type: string, payload: Record<string, unknown>, meta: { opId?: string } = {}): Promise<CmdResult> {
  const opId = meta.opId ?? v7();
  const r = await ok(c.post('/api/commands', { commands: [{ opId, type, payload, contextId: payload.contextId, ...(payload.lessonId ? { lessonId: payload.lessonId } : {}) }] }));
  return r.results[0] as CmdResult;
}

export async function startLesson(c: Client, contextId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await cmd(c, 'lesson.start', { contextId, ...extra });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.result.lessonId as string;
}

export async function endLesson(c: Client, contextId: string, lessonId: string, steps: Record<string, unknown> = {}) {
  const r = await cmd(c, 'lesson.end', { contextId, lessonId, steps });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.result;
}

export const lessonState = (c: Client, contextId: string) => ok(c.get(`/api/classroom/contexts/${contextId}/lesson`));
