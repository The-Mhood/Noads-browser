import { describe, expect, it } from 'vitest';
import {
  bookmarkUrl,
  displayFor,
  resolveNavigation,
  suggestAddress,
} from '../electron/normalize';
import { HOME_URL } from '../shared/constants';

describe('bookmarkUrl (strict: real pages only, never searches)', () => {
  it('normalizes bare domains to https', () => {
    expect(bookmarkUrl('example.com')).toBe('https://example.com/');
    expect(bookmarkUrl('  Wikipedia.org  ')).toBe('https://wikipedia.org/');
  });

  it('keeps explicit URLs intact', () => {
    expect(bookmarkUrl('https://example.com/a/b?x=1#frag')).toBe(
      'https://example.com/a/b?x=1#frag',
    );
    expect(bookmarkUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x');
  });

  it('rejects search terms (a bookmark must point at a page)', () => {
    expect(bookmarkUrl('cats')).toBeNull();
    expect(bookmarkUrl('electron ipc docs')).toBeNull();
  });

  it('rejects non-web input', () => {
    expect(bookmarkUrl('')).toBeNull();
    expect(bookmarkUrl(HOME_URL)).toBeNull();
    expect(bookmarkUrl('javascript:alert(1)')).toBeNull();
    expect(bookmarkUrl('https://example.com:abc')).toBeNull();
  });
});

describe('resolveNavigation', () => {
  it('empty input and "home" go home', () => {
    expect(resolveNavigation('')).toEqual({ kind: 'url', url: HOME_URL });
    expect(resolveNavigation('  home  ')).toEqual({ kind: 'url', url: HOME_URL });
  });

  it('bare domains get https', () => {
    expect(resolveNavigation('example.com')).toEqual({
      kind: 'url',
      url: 'https://example.com/',
    });
  });

  it('preserves explicit schemes and paths', () => {
    expect(resolveNavigation('http://example.com:8080/x?q=1#frag')).toEqual({
      kind: 'url',
      url: 'http://example.com:8080/x?q=1#frag',
    });
  });

  it('localhost and IPs get http, not https', () => {
    expect(resolveNavigation('localhost:3000')).toEqual({
      kind: 'url',
      url: 'http://localhost:3000/',
    });
    expect(resolveNavigation('192.168.1.5:8080')).toEqual({
      kind: 'url',
      url: 'http://192.168.1.5:8080/',
    });
  });

  it('single words without dots are searches (default provider = DuckDuckGo HTML)', () => {
    expect(resolveNavigation('cats')).toEqual({
      kind: 'url',
      url: 'https://duckduckgo.com/html/?q=cats',
      searchQuery: 'cats',
    });
  });

  it('phrases with spaces are searches, URL-encoded', () => {
    expect(resolveNavigation('electron ipc renderer 中文')).toEqual({
      kind: 'url',
      url: `https://duckduckgo.com/html/?q=${encodeURIComponent('electron ipc renderer 中文')}`,
      searchQuery: 'electron ipc renderer 中文',
    });
  });

  it('honors a configured search provider', () => {
    expect(resolveNavigation('weather', 'google')).toEqual({
      kind: 'url',
      url: 'https://www.google.com/search?q=weather',
      searchQuery: 'weather',
    });
    expect(resolveNavigation('quantum computing', 'wikipedia')).toEqual({
      kind: 'url',
      url: `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent('quantum computing')}`,
      searchQuery: 'quantum computing',
    });
  });

  it('falls back to DuckDuckGo for unknown provider ids', () => {
    const t = resolveNavigation('cats', 'totally-missing-provider');
    expect(t).toEqual({
      kind: 'url',
      url: 'https://duckduckgo.com/html/?q=cats',
      searchQuery: 'cats',
    });
  });

  it('rejects non-http(s) schemes with a clear message', () => {
    const t = resolveNavigation('javascript:alert(1)');
    expect(t.kind).toBe('error');
    if (t.kind === 'error') {
      expect(t.message).toContain('not supported');
    }
    const mailto = resolveNavigation('mailto:x@y.z');
    expect(mailto.kind).toBe('error');
    const ftp = resolveNavigation('ftp://example.com/file');
    expect(ftp.kind).toBe('error');
  });

  it('never confuses host:port with a URL scheme (regression)', () => {
    expect(resolveNavigation('localhost')).toEqual({
      kind: 'url',
      url: 'http://localhost/',
    });
    expect(resolveNavigation('my-local-host')).toEqual({
      kind: 'url',
      url: `https://duckduckgo.com/html/?q=my-local-host`,
      searchQuery: 'my-local-host',
    });
  });

  it('rejects malformed addresses', () => {
    expect(resolveNavigation('https://example.com:abc').kind).toBe('error');
  });

  it('never throws on garbage', () => {
    expect(() => resolveNavigation('\u0000\u0001\u0002')).not.toThrow();
    expect(() => resolveNavigation('a'.repeat(5000))).not.toThrow();
  });
});

describe('suggestAddress', () => {
  it('suggests google.com from a partial prefix', () => {
    expect(suggestAddress('goo')).toBe('google.com');
    expect(suggestAddress('GOO')).toBe('google.com');
  });

  it('completes a hostname ending in a dot with .com', () => {
    expect(suggestAddress('google.')).toBe('google.com');
    expect(suggestAddress('example.')).toBe('example.com');
  });

  it('does not suggest inside a URL, search phrase, or exact domain', () => {
    expect(suggestAddress('https://goo')).toBeNull();
    expect(suggestAddress('goo things')).toBeNull();
    expect(suggestAddress('google.com')).toBeNull();
  });
});

describe('displayFor', () => {
  it('home displays empty', () => {
    expect(displayFor(HOME_URL)).toBe('');
  });

  it('strips the scheme for http(s)', () => {
    expect(displayFor('https://example.com/path')).toBe('example.com/path');
    expect(displayFor('http://localhost:3000/')).toBe('localhost:3000/');
  });

  it('passes unknown schemes through untouched', () => {
    expect(displayFor('data:text/html,hi')).toBe('data:text/html,hi');
  });
});
