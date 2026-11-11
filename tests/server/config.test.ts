/**
 * Configuration safety (OPS-5, SX): the e2e sign-in rate-limit override can never weaken production.
 */
import { describe, expect, it } from 'vitest';
import { LOGIN_RATE_LIMIT_MAX, PIN_UNLOCK_RATE_LIMIT_MAX, loadConfig, testClockFile, testIdSeed } from '../../src/server/config.ts';
import { newId, useSeededIds } from '../../src/server/lib/crypto.ts';

const base = { SECRET_PEPPER: 'config-test-pepper-0123456789', DATA_DIR: './data-config-test' };

describe('login rate limit override (test only)', () => {
  it('defaults to the production limit', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'test' }).loginRateLimit).toBe(LOGIN_RATE_LIMIT_MAX);
  });

  it('is honoured under NODE_ENV=test', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'test', CC_TEST_LOGIN_RATE_LIMIT: '1000' }).loginRateLimit).toBe(1000);
  });

  it('is ignored in production and development', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production', SECRET_PEPPER: 'a-real-looking-production-pepper', CC_TEST_LOGIN_RATE_LIMIT: '1000' }).loginRateLimit).toBe(LOGIN_RATE_LIMIT_MAX);
    expect(loadConfig({ ...base, NODE_ENV: 'development', CC_TEST_LOGIN_RATE_LIMIT: '1000' }).loginRateLimit).toBe(LOGIN_RATE_LIMIT_MAX);
  });

  it('rejects nonsense values', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'test', CC_TEST_LOGIN_RATE_LIMIT: '0' })).toThrow(/CC_TEST_LOGIN_RATE_LIMIT/);
  });
});

// S26a, D-189 (ENG-3): the visual baseline's fixed demo ids and its clock exist only under NODE_ENV=test.
describe('fixed demo ids and the test clock (test only)', () => {
  it('are honoured under NODE_ENV=test', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'test', CC_TEST_ID_SEED: '2026', CC_TEST_CLOCK_FILE: 'clock.txt' });
    expect(testIdSeed(c)).toBe(2026);
    expect(testClockFile(c)).toBe('clock.txt');
  });

  it('are ignored in production and development', () => {
    for (const NODE_ENV of ['production', 'development']) {
      const c = loadConfig({ ...base, NODE_ENV, SECRET_PEPPER: 'a-real-looking-production-pepper', CC_TEST_ID_SEED: '2026', CC_TEST_CLOCK_FILE: 'clock.txt' });
      expect(testIdSeed(c)).toBeNull();
      expect(testClockFile(c)).toBeNull();
    }
  });

  it('rejects nonsense values', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'test', CC_TEST_ID_SEED: '0' })).toThrow(/CC_TEST_ID_SEED/);
  });

  it('seeded ids are the same every run, sort in the order they were made, and random ids come back', () => {
    const make = () => {
      const restore = useSeededIds(2026, Date.UTC(2026, 0, 1));
      try {
        return Array.from({ length: 50 }, () => newId());
      } finally {
        restore();
      }
    };
    const a = make();
    expect(make()).toEqual(a);
    expect([...a].sort()).toEqual(a);
    expect(new Set(a).size).toBe(50);
    for (const id of a) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(newId()).not.toBe(newId());
    expect(a).not.toContain(newId());
  });
});

describe('PIN unlock rate limit override (test only)', () => {
  it('defaults to the production limit', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'test' }).pinUnlockRateLimit).toBe(PIN_UNLOCK_RATE_LIMIT_MAX);
  });

  it('is honoured under NODE_ENV=test', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'test', CC_TEST_PIN_RATE_LIMIT: '1000' }).pinUnlockRateLimit).toBe(1000);
  });

  it('is ignored in production and development', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production', SECRET_PEPPER: 'a-real-looking-production-pepper', CC_TEST_PIN_RATE_LIMIT: '1000' }).pinUnlockRateLimit).toBe(PIN_UNLOCK_RATE_LIMIT_MAX);
    expect(loadConfig({ ...base, NODE_ENV: 'development', CC_TEST_PIN_RATE_LIMIT: '1000' }).pinUnlockRateLimit).toBe(PIN_UNLOCK_RATE_LIMIT_MAX);
  });

  it('rejects nonsense values', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'test', CC_TEST_PIN_RATE_LIMIT: '0' })).toThrow(/CC_TEST_PIN_RATE_LIMIT/);
  });
});
