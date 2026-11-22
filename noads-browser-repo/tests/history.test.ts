import { describe, expect, it } from 'vitest';
import {
  MAX_HISTORY_ENTRIES,
  isRecordableUrl,
  recordVisit,
  sanitizeHistory,
} from '../electron/history';

describe('history', () => {
  it('records only http(s) URLs', () => {
    expect(isRecordableUrl('https://example.com')).toBe(true);
    expect(isRecordableUrl('http://example.com/x')).toBe(true);
    expect(isRecordableUrl('noads://home')).toBe(false);
    expect(isRecordableUrl('file:///etc/passwd')).toBe(false);
    expect(isRecordableUrl('javascript:alert(1)')).toBe(false);
  });

  it('prepends new visits, newest first', () => {
    let h = recordVisit([], 'https://a.com', 'A', 1000);
    h = recordVisit(h, 'https://b.com', 'B', 2000);
    expect(h.map((e) => e.url)).toEqual(['https://b.com', 'https://a.com']);
    expect(h[1].at).toBe(1000);
  });

  it('re-visiting a URL refreshes it instead of duplicating', () => {
    let h = recordVisit([], 'https://a.com', 'A', 1000);
    h = recordVisit(h, 'https://b.com', 'B', 2000);
    h = recordVisit(h, 'https://a.com', 'A again', 3000);
    expect(h).toHaveLength(2);
    expect(h[0]).toEqual({ url: 'https://a.com', title: 'A again', at: 3000 });
  });

  it('falls back to the hostname when the title is empty', () => {
    const h = recordVisit([], 'https://example.com/path', '', 1000);
    expect(h[0].title).toBe('example.com');
  });

  it('ignores unrecordable URLs and invalid timestamps', () => {
    const h = recordVisit([], 'noads://home', 'Home', 1000);
    expect(h).toHaveLength(0);
    expect(recordVisit([], 'https://a.com', 'A', Number.NaN)).toHaveLength(0);
  });

  it('is bounded by MAX_HISTORY_ENTRIES', () => {
    let h: ReturnType<typeof recordVisit> = [];
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 50; i++) {
      h = recordVisit(h, `https://site-${i}.example.com`, `S${i}`, i + 1);
    }
    expect(h).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(h[0].url).toBe(`https://site-${MAX_HISTORY_ENTRIES + 49}.example.com`);
  });

  it('sanitizeHistory drops junk and never throws', () => {
    expect(sanitizeHistory(null)).toEqual([]);
    expect(sanitizeHistory('nope')).toEqual([]);
    expect(sanitizeHistory([1, {}, { url: 'x' }])).toEqual([]);
    const clean = sanitizeHistory([
      { url: 'https://a.com', title: 'A', at: 100 },
      { url: 'https://a.com', title: 'dup', at: 200 },
      { url: 'ftp://no', title: 'bad', at: 300 },
      { url: 'https://b.com', title: '', at: 50 },
    ]);
    expect(clean).toHaveLength(2);
    expect(clean[0].url).toBe('https://a.com'); // newest first
    expect(clean[1].title).toBe('b.com');
  });
});
