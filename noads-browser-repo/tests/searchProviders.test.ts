import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_PROVIDER,
  FALLBACK_SEARCH_PROVIDER,
  SEARCH_PROVIDERS,
  getProvider,
  isKnownProviderId,
} from '../shared/searchProviders';

describe('search provider registry', () => {
  it('has unique, non-empty ids and names', () => {
    const ids = SEARCH_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of SEARCH_PROVIDERS) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it('default and fallback are registered providers', () => {
    expect(isKnownProviderId(DEFAULT_SEARCH_PROVIDER)).toBe(true);
    expect(isKnownProviderId(FALLBACK_SEARCH_PROVIDER)).toBe(true);
  });

  it('getProvider resolves known ids', () => {
    expect(getProvider('google').id).toBe('google');
    expect(getProvider('bing').id).toBe('bing');
  });

  it('getProvider falls back for unknown/null/undefined ids (never null)', () => {
    expect(getProvider('does-not-exist').id).toBe(FALLBACK_SEARCH_PROVIDER);
    expect(getProvider(null).id).toBe(FALLBACK_SEARCH_PROVIDER);
    expect(getProvider(undefined).id).toBe(FALLBACK_SEARCH_PROVIDER);
    expect(getProvider(42 as unknown as string).id).toBe(FALLBACK_SEARCH_PROVIDER);
  });

  it('buildUrl encodes queries safely', () => {
    const url = SEARCH_PROVIDERS[0].buildUrl('a b & c=1 "quoted"');
    expect(url).not.toContain(' ');
    expect(url).not.toContain('"');
    expect(url).toContain(encodeURIComponent('a b & c=1 "quoted"'));
  });

  it('buildUrl survives hostile input without throwing', () => {
    for (const q of ['', ' ', 'http://x.com', '<script>', "'; DROP TABLE x;--", 'ñ']) {
      expect(() => SEARCH_PROVIDERS[0].buildUrl(q)).not.toThrow();
    }
  });

  it('isKnownProviderId is a type guard', () => {
    expect(isKnownProviderId('duckduckgo')).toBe(true);
    expect(isKnownProviderId('')).toBe(false);
    expect(isKnownProviderId(7)).toBe(false);
  });
});
