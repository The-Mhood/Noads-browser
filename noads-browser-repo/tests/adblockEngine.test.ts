import { describe, expect, it } from 'vitest';
import {
  FILTER_CACHE_MAX_AGE_MS,
  buildDomainFilterRules,
  isFilterCacheFresh,
} from '../electron/adblockRules';

describe('buildDomainFilterRules', () => {
  it('creates normalized block and allow rules without duplicates', () => {
    expect(
      buildDomainFilterRules(
        ['Ads.Example.com/', 'ads.example.com', 'https://track.example.net/path'],
        ['www.Example.org', 'example.org'],
      ),
    ).toEqual([
      '||ads.example.com^',
      '||track.example.net^',
      '@@||example.org^',
    ]);
  });

  it('drops invalid domains', () => {
    expect(buildDomainFilterRules(['not a domain', 'localhost'], ['also invalid'])).toEqual([]);
  });
});

describe('filter cache metadata', () => {
  it('accepts only non-future timestamps within the refresh window', () => {
    const now = FILTER_CACHE_MAX_AGE_MS * 2;
    expect(isFilterCacheFresh(now - FILTER_CACHE_MAX_AGE_MS + 1, now)).toBe(true);
    expect(isFilterCacheFresh(now - FILTER_CACHE_MAX_AGE_MS - 1, now)).toBe(false);
    expect(isFilterCacheFresh(now + 1, now)).toBe(false);
    expect(isFilterCacheFresh(0, now)).toBe(false);
  });
});
