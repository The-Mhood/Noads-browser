import { describe, expect, it } from 'vitest';
import { makeMatcher, normalizeDomain } from '../electron/blocklist';

describe('normalizeDomain', () => {
  it('lowercases and trims', () => {
    expect(normalizeDomain('  Ads.Example.COM ')).toBe('ads.example.com');
  });

  it('extracts the host from pasted URLs', () => {
    expect(normalizeDomain('https://ads.example.com/banner.js')).toBe('ads.example.com');
    expect(normalizeDomain('ads.example.com/')).toBe('ads.example.com');
  });

  it('strips one leading www', () => {
    expect(normalizeDomain('www.doubleclick.net')).toBe('doubleclick.net');
  });

  it('rejects invalid input', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('   ')).toBeNull();
    expect(normalizeDomain('not a domain')).toBeNull();
    expect(normalizeDomain('example..com')).toBeNull();
    expect(normalizeDomain('.example.com')).toBeNull();
    expect(normalizeDomain('example.')).toBeNull();
    expect(normalizeDomain('com')).toBeNull(); // bare TLD would be catastrophic
    expect(normalizeDomain('bad_host.com')).toBeNull();
    expect(normalizeDomain(42 as unknown as string)).toBeNull();
  });
});

describe('makeMatcher', () => {
  const m = makeMatcher(['doubleclick.net', 'ads.example.com', 'not a domain']);

  it('matches exact hosts', () => {
    expect(m.test('doubleclick.net')).toBe(true);
    expect(m.test('ads.example.com')).toBe(true);
  });

  it('matches subdomains of an entry', () => {
    expect(m.test('px.doubleclick.net')).toBe(true);
    expect(m.test('a.b.ads.example.com')).toBe(true);
  });

  it('does NOT match parent or sibling domains (dot boundary)', () => {
    expect(m.test('example.com')).toBe(false);
    expect(m.test('badads.example.com')).toBe(false);
    expect(m.test('ads.example.com.evil.net')).toBe(false);
    expect(m.test('netdoubleclick.net')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(m.test('ADS.Example.COM')).toBe(true);
  });

  it('drops invalid entries and reports the real size', () => {
    expect(m.size).toBe(2);
  });

  it('handles an empty list', () => {
    expect(makeMatcher([]).test('anything.com')).toBe(false);
  });
});
