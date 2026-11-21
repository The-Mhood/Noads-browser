/**
 * Browsing-history store. Pure logic — no Electron imports — so it is
 * unit-tested in Node; main.ts owns persistence (history.json, atomic
 * writes) using these functions.
 *
 * Design rules:
 *  - bounded (MAX_HISTORY_ENTRIES): oldest entries drop off the end;
 *  - re-visiting a URL refreshes its timestamp and moves it to the front
 *    instead of duplicating it;
 *  - only http(s) URLs are recorded; internal screens never appear.
 */
import type { HistoryEntry } from '../shared/types';

export const MAX_HISTORY_ENTRIES = 500;
export const MAX_HISTORY_URL_LENGTH = 2048;
export const MAX_HISTORY_TITLE_LENGTH = 300;

export function isRecordableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && url.length <= MAX_HISTORY_URL_LENGTH;
}

function normalizeTitle(title: unknown, url: string): string {
  if (typeof title === 'string') {
    const t = title.trim().slice(0, MAX_HISTORY_TITLE_LENGTH);
    if (t !== '') return t;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Record a visit. Returns a NEW array (immutable update) with the entry at
 * the front. Consecutive duplicates collapse into one refreshed entry.
 */
export function recordVisit(
  entries: HistoryEntry[],
  url: string,
  title: unknown,
  at: number,
): HistoryEntry[] {
  if (!isRecordableUrl(url) || !Number.isFinite(at)) return entries;
  const rest = entries.filter((e) => e.url !== url);
  return [
    { url, title: normalizeTitle(title, url), at },
    ...rest,
  ].slice(0, MAX_HISTORY_ENTRIES);
}

/** Lenient sanitize for data read from disk. Never throws. */
export function sanitizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.url !== 'string' || !isRecordableUrl(o.url)) continue;
    if (typeof o.at !== 'number' || !Number.isFinite(o.at) || o.at <= 0) continue;
    if (seen.has(o.url)) continue;
    seen.add(o.url);
    out.push({ url: o.url, title: normalizeTitle(o.title, o.url), at: o.at });
    if (out.length >= MAX_HISTORY_ENTRIES) break;
  }
  // Newest first, regardless of how the file was written.
  out.sort((a, b) => b.at - a.at);
  return out;
}
