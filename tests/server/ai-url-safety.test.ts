/**
 * Address rules for OpenAI-compatible connections (S19a, D-179): cloud metadata, link-local and other
 * reserved addresses are always refused; loopback and private addresses only when the administrator
 * ticked "on this server or school network"; names are resolved at connect time (DNS rebinding).
 */
import { describe, expect, it } from 'vitest';
import { addressAllowed, checkBaseUrl, classifyAddress, policyLookup } from '../../src/server/modules/aiConnections/urlSafety.ts';

describe('classifyAddress', () => {
  it.each([
    ['8.8.8.8', 'public'],
    ['2606:4700::1111', 'public'],
    ['127.0.0.1', 'loopback'],
    ['127.8.9.10', 'loopback'],
    ['::1', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.20.0.5', 'private'],
    ['192.168.1.20', 'private'],
    ['100.64.3.4', 'private'],
    ['fd12:3456::1', 'private'],
    ['169.254.169.254', 'metadata'],
    ['169.254.170.2', 'metadata'],
    ['100.100.100.200', 'metadata'],
    ['fd00:ec2::254', 'metadata'],
    ['169.254.1.1', 'linkLocal'],
    ['fe80::1', 'linkLocal'],
    ['0.0.0.0', 'blocked'],
    ['::', 'blocked'],
    ['224.0.0.1', 'blocked'],
    ['255.255.255.255', 'blocked'],
    ['192.0.2.10', 'blocked'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:169.254.169.254', 'metadata'],
    ['[::1]', 'loopback'],
    ['not-an-ip', 'blocked'],
  ])('%s is %s', (ip, cls) => expect(classifyAddress(ip)).toBe(cls));

  it('the local policy adds loopback and private addresses, never metadata or link-local', () => {
    expect(addressAllowed('10.0.0.5', 'public')).toBe(false);
    expect(addressAllowed('10.0.0.5', 'local')).toBe(true);
    expect(addressAllowed('127.0.0.1', 'local')).toBe(true);
    expect(addressAllowed('169.254.169.254', 'local')).toBe(false);
    expect(addressAllowed('fe80::1', 'local')).toBe(false);
    expect(addressAllowed('0.0.0.0', 'local')).toBe(false);
  });
});

describe('checkBaseUrl', () => {
  const refused = (url: string, local: boolean) => {
    const r = checkBaseUrl(url, local);
    return r.ok ? null : r.reason;
  };
  it('accepts public https addresses and normalises the trailing slash', () => {
    expect(checkBaseUrl('https://api.mistral.example/v1/', false)).toEqual({ ok: true, url: 'https://api.mistral.example/v1' });
    expect(checkBaseUrl('https://8.8.8.8/v1', false)).toEqual({ ok: true, url: 'https://8.8.8.8/v1' });
  });
  it('refuses metadata and link-local addresses even when ticked', () => {
    for (const local of [false, true]) {
      expect(refused('http://169.254.169.254/latest/meta-data', local)).toBe('METADATA');
      expect(refused('http://[fd00:ec2::254]/', local)).toBe('METADATA');
      expect(refused('http://metadata.google.internal/computeMetadata/v1', local)).toBe('METADATA');
      expect(refused('http://169.254.10.10/', local)).toBe('LINK_LOCAL');
      expect(refused('http://[fe80::1]/', local)).toBe('LINK_LOCAL');
      expect(refused('http://0.0.0.0:11434/', local)).toBe('BLOCKED');
    }
  });
  it('allows loopback, private and plain http only when ticked', () => {
    expect(refused('http://127.0.0.1:11434/v1', false)).toBe('LOCAL_NOT_TICKED');
    expect(refused('http://localhost:11434/v1', false)).toBe('LOCAL_NOT_TICKED');
    expect(refused('https://ollama.school.lan/v1', false)).toBe('LOCAL_NOT_TICKED');
    expect(refused('https://192.168.1.50/v1', false)).toBe('LOCAL_NOT_TICKED');
    expect(refused('http://models.example.org/v1', false)).toBe('HTTP_NOT_LOCAL');
    expect(checkBaseUrl('http://127.0.0.1:11434/v1', true)).toEqual({ ok: true, url: 'http://127.0.0.1:11434/v1' });
    expect(checkBaseUrl('http://[::1]:8000/v1', true)).toEqual({ ok: true, url: 'http://[::1]:8000/v1' });
    expect(checkBaseUrl('http://10.0.0.7/v1', true).ok).toBe(true);
  });
  it('refuses other schemes, credentials, queries and non-URLs', () => {
    expect(refused('ftp://example.org/', true)).toBe('SCHEME');
    expect(refused('file:///etc/passwd', true)).toBe('SCHEME');
    expect(refused('https://user:pw@example.org/v1', false)).toBe('CREDENTIALS');
    expect(refused('https://example.org/v1?x=1', false)).toBe('QUERY');
    expect(refused('https://example.org/v1#a', false)).toBe('QUERY');
    expect(refused('not a url', false)).toBe('NOT_A_URL');
  });
});

describe('policyLookup (resolved at connect time)', () => {
  const lookup = (policy: 'public' | 'local', host: string) =>
    new Promise<string>((resolve, reject) => policyLookup(policy)(host, { all: true }, (err, addresses) => (err ? reject(err) : resolve(JSON.stringify(addresses)))));
  it('refuses a name that resolves to loopback under the public policy and allows it under local', async () => {
    await expect(lookup('public', 'localhost')).rejects.toThrow('not allowed');
    await expect(lookup('local', 'localhost')).resolves.toMatch(/127\.0\.0\.1|::1/u);
  });
  it('refuses metadata names without resolving them', async () => {
    await expect(lookup('local', 'metadata.google.internal')).rejects.toThrow('not allowed');
  });
});
