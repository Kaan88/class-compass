/**
 * Configuration safety (OPS-5, SX): the e2e sign-in rate-limit override can never weaken production.
 */
import { describe, expect, it } from 'vitest';
import { LOGIN_RATE_LIMIT_MAX, loadConfig } from '../../src/server/config.ts';

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
