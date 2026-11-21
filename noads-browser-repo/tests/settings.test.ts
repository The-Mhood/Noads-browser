import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MAX_BOOKMARKS,
  MAX_RESTORED_TABS,
  MAX_USER_DOMAINS,
  applySettingsUpdate,
  sanitizeSettings,
} from '../electron/settings';

describe('sanitizeSettings (disk input — untrusted, never throws)', () => {
  it('returns defaults for non-objects', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('junk')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it('cosmeticFiltering defaults to true when missing (legacy files)', () => {
    expect(sanitizeSettings({}).cosmeticFiltering).toBe(true);
    expect(sanitizeSettings({ cosmeticFiltering: false }).cosmeticFiltering).toBe(false);
    expect(sanitizeSettings({ cosmeticFiltering: 'nope' }).cosmeticFiltering).toBe(true);
  });

  it('coerces a valid file', () => {
    const s = sanitizeSettings({
      blockEnabled: false,
      cosmeticFiltering: false,
      blockDomains: ['Ads.Example.com', 'https://bad.example.org/x'],
      allowDomains: ['example.com'],
      lastTabs: ['', 'https://example.org/page'],
      searchProvider: 'google',
    });
    expect(s.blockEnabled).toBe(false);
    expect(s.cosmeticFiltering).toBe(false);
    expect(s.blockDomains).toEqual(['ads.example.com', 'bad.example.org']);
    expect(s.allowDomains).toEqual(['example.com']);
    expect(s.lastTabs).toEqual(['', 'https://example.org/page']);
    expect(s.searchProvider).toBe('google');
  });

  it('migrates the legacy single lastUrl field to lastTabs', () => {
    const s = sanitizeSettings({ lastUrl: 'https://example.org/old' });
    expect(s.lastTabs).toEqual(['https://example.org/old']);
  });

  it('prefers lastTabs over legacy lastUrl when both exist', () => {
    const s = sanitizeSettings({
      lastTabs: ['https://a.example/'],
      lastUrl: 'https://legacy.example/',
    });
    expect(s.lastTabs).toEqual(['https://a.example/']);
  });

  it('drops invalid domains, unknown provider ids, and bad tab entries', () => {
    const s = sanitizeSettings({
      blockDomains: ['good.example.com', 'bad domain', 'com'],
      searchProvider: 'no-such-provider',
      lastTabs: ['https://ok.example/', 'javascript:evil()', 'too long'.repeat(300)],
    });
    expect(s.blockDomains).toEqual(['good.example.com']);
    expect(s.searchProvider).toBe(DEFAULT_SETTINGS.searchProvider);
    expect(s.lastTabs).toEqual(['https://ok.example/']);
  });

  it('sanitizes bookmarks: keeps valid, drops invalid, dedupes by URL', () => {
    const s = sanitizeSettings({
      bookmarks: [
        { id: 'b1', title: 'Example', url: 'https://example.com/' },
        { id: 'b1', title: 'Duplicate URL', url: 'https://example.com/' },
        { id: 'b2', title: 'Bad', url: 'javascript:alert(1)' },
        { id: 'b3', title: 'No id check' },
        'junk',
        { id: 'b4', title: 'GitHub', url: 'https://github.com' },
      ],
    });
    expect(s.bookmarks).toEqual([
      { id: 'b1', title: 'Example', url: 'https://example.com/' },
      { id: 'b4', title: 'GitHub', url: 'https://github.com' },
    ]);
  });

  it('truncates oversized domain lists and tab lists', () => {
    const many = Array.from({ length: MAX_USER_DOMAINS + 50 }, (_, i) => `d${i}.example.com`);
    expect(sanitizeSettings({ blockDomains: many }).blockDomains.length).toBe(
      MAX_USER_DOMAINS,
    );
    const tabs = Array.from({ length: MAX_RESTORED_TABS + 10 }, (_, i) => `https://t${i}.example/`);
    expect(sanitizeSettings({ lastTabs: tabs }).lastTabs.length).toBe(MAX_RESTORED_TABS);
  });
});

describe('applySettingsUpdate (IPC input — strict, throws with clear messages)', () => {
  const base = () => ({ ...DEFAULT_SETTINGS, lastTabs: [] as string[] });

  it('toggles blocking', () => {
    expect(applySettingsUpdate(base(), { blockEnabled: false }).blockEnabled).toBe(false);
  });

  it('rejects non-boolean blockEnabled', () => {
    expect(() => applySettingsUpdate(base(), { blockEnabled: 'yes' as unknown as boolean })).toThrow(
      /blockEnabled must be a boolean/,
    );
  });

  it('validates cosmeticFiltering', () => {
    expect(applySettingsUpdate(base(), { cosmeticFiltering: false }).cosmeticFiltering).toBe(false);
    expect(applySettingsUpdate(base(), { cosmeticFiltering: true }).cosmeticFiltering).toBe(true);
    expect(() =>
      applySettingsUpdate(base(), { cosmeticFiltering: 'yes' as unknown as boolean }),
    ).toThrow(/cosmeticFiltering must be a boolean/);
  });

  it('normalizes and dedupes added domains', () => {
    const s = applySettingsUpdate(base(), {
      blockDomains: ['ADS.Example.com/', 'ads.example.com', 'other.example.org'],
    });
    expect(s.blockDomains).toEqual(['ads.example.com', 'other.example.org']);
  });

  it('rejects invalid domains with the offending value named', () => {
    expect(() => applySettingsUpdate(base(), { blockDomains: ['nope domain'] })).toThrow(
      /"nope domain" is not a valid domain/,
    );
  });

  it('rejects bare TLDs (would block half the internet)', () => {
    expect(() => applySettingsUpdate(base(), { allowDomains: ['com'] })).toThrow(
      /not a valid domain/,
    );
  });

  it('rejects oversized domain lists', () => {
    const many = Array.from({ length: MAX_USER_DOMAINS + 1 }, (_, i) => `d${i}.example.com`);
    expect(() => applySettingsUpdate(base(), { blockDomains: many })).toThrow(/Too many domains/);
  });

  it('validates lastTabs entries (empty or http(s) only)', () => {
    const s = applySettingsUpdate(base(), { lastTabs: ['', 'https://x.example/'] });
    expect(s.lastTabs).toEqual(['', 'https://x.example/']);
    expect(() => applySettingsUpdate(base(), { lastTabs: ['javascript:evil()'] })).toThrow(
      /lastTabs entries/,
    );
    expect(() =>
      applySettingsUpdate(base(), { lastTabs: 'nope' as unknown as string[] }),
    ).toThrow(/lastTabs must be a list/);
    const tooMany = Array.from({ length: MAX_RESTORED_TABS + 1 }, () => '');
    expect(() => applySettingsUpdate(base(), { lastTabs: tooMany })).toThrow(
      /up to 16 tab URLs/,
    );
  });

  it('validates bookmarks (strict)', () => {
    const ok = [
      { id: 'b1', title: 'Example', url: 'https://example.com/' },
      { id: 'b2', title: 'GitHub', url: 'https://github.com' },
    ];
    expect(applySettingsUpdate(base(), { bookmarks: ok }).bookmarks).toEqual(ok);

    expect(() =>
      applySettingsUpdate(base(), {
        bookmarks: [...ok, { id: 'b3', title: 'Dup', url: 'https://example.com/' }],
      }),
    ).toThrow(/Duplicate bookmark/);
    expect(() =>
      applySettingsUpdate(base(), {
        bookmarks: [{ id: 'b1', title: 'Nope', url: 'javascript:alert(1)' }],
      }),
    ).toThrow(/Bookmark URLs must be http\(s\)/);
    expect(() =>
      applySettingsUpdate(base(), {
        bookmarks: [{ id: 'b1', title: 'No url', url: 42 as unknown as string }],
      }),
    ).toThrow(/Bookmark URLs must be http\(s\)/);
    expect(() =>
      applySettingsUpdate(base(), { bookmarks: 42 as unknown as Parameters<typeof applySettingsUpdate>[1]['bookmarks'] }),
    ).toThrow(/Too many bookmarks/);
    const many = Array.from({ length: MAX_BOOKMARKS + 1 }, (_, i) => ({
      id: `b${i}`,
      title: `t${i}`,
      url: `https://d${i}.example/`,
    }));
    expect(() => applySettingsUpdate(base(), { bookmarks: many })).toThrow(
      /Too many bookmarks/,
    );
  });

  it('validates searchProvider against the registry', () => {
    expect(applySettingsUpdate(base(), { searchProvider: 'bing' }).searchProvider).toBe('bing');
    expect(() => applySettingsUpdate(base(), { searchProvider: 'nope' })).toThrow(
      /Unknown search provider "nope"/,
    );
  });

  it('partial updates keep the other fields', () => {
    const s = applySettingsUpdate(
      { ...base(), allowDomains: ['keep.example.com'], lastTabs: ['https://keep.example/'] },
      { blockEnabled: false },
    );
    expect(s.allowDomains).toEqual(['keep.example.com']);
    expect(s.lastTabs).toEqual(['https://keep.example/']);
    expect(s.searchProvider).toBe(DEFAULT_SETTINGS.searchProvider);
  });
});
