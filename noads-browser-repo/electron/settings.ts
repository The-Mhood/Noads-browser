/**
 * Settings validation. Pure logic — no Electron imports.
 *
 * Settings come from two untrusted sources:
 *  - disk (userData/settings.json) → `sanitizeSettings`: lenient, never
 *    throws, coerces what it can and drops the rest, falls back to defaults.
 *    Also migrates the legacy single-lastUrl schema to lastTabs.
 *  - IPC from the renderer → `applySettingsUpdate`: strict, throws with a
 *    clear message; the error is returned to the UI, never swallowed.
 */
import type { Bookmark, Settings } from '../shared/types';
import {
  HOME_URL,
  MAX_BOOKMARKS,
  MAX_RESTORED_TABS,
} from '../shared/constants';
import {
  DEFAULT_SEARCH_PROVIDER,
  isKnownProviderId,
} from '../shared/searchProviders';
import { normalizeDomain } from './blocklist';

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  blockEnabled: true,
  cosmeticFiltering: true,
  blockDomains: [] as string[],
  allowDomains: [] as string[],
  lastTabs: [] as string[],
  bookmarks: [] as Bookmark[],
  searchProvider: DEFAULT_SEARCH_PROVIDER,
  autoHideChrome: true,
  youtubeCompat: false,
});

export const MAX_USER_DOMAINS = 500;
export const MAX_LAST_URL_LENGTH = 2048;
export { MAX_RESTORED_TABS, MAX_BOOKMARKS };

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isValidTabEntry(e: string): boolean {
  return e === '' || (/^https?:\/\//i.test(e) && e.length <= MAX_LAST_URL_LENGTH);
}

function isHttpUrl(u: unknown): u is string {
  return typeof u === 'string' && /^https?:\/\//i.test(u) && u.length <= MAX_LAST_URL_LENGTH;
}

/** Lenient: used when reading settings.json from disk. Never throws. */
export function sanitizeSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS };
  const r = raw as Record<string, unknown>;

  const tabs = isStringArray(r.lastTabs)
    ? r.lastTabs.filter(isValidTabEntry).slice(0, MAX_RESTORED_TABS)
    : null;

  // Migration: legacy settings had a single lastUrl.
  const legacy =
    typeof r.lastUrl === 'string' &&
    /^https?:\/\/.+/i.test(r.lastUrl) &&
    r.lastUrl.length <= MAX_LAST_URL_LENGTH
      ? [r.lastUrl]
      : [];

  return {
    blockEnabled:
      typeof r.blockEnabled === 'boolean' ? r.blockEnabled : DEFAULT_SETTINGS.blockEnabled,
    cosmeticFiltering:
      typeof r.cosmeticFiltering === 'boolean'
        ? r.cosmeticFiltering
        : DEFAULT_SETTINGS.cosmeticFiltering,
    blockDomains: isStringArray(r.blockDomains)
      ? uniqueDomains(r.blockDomains).slice(0, MAX_USER_DOMAINS)
      : [],
    allowDomains: isStringArray(r.allowDomains)
      ? uniqueDomains(r.allowDomains).slice(0, MAX_USER_DOMAINS)
      : [],
    lastTabs: tabs ?? legacy,
    bookmarks: sanitizeBookmarks(r.bookmarks),
    searchProvider: isKnownProviderId(r.searchProvider)
      ? r.searchProvider
      : DEFAULT_SEARCH_PROVIDER,
    autoHideChrome:
      typeof r.autoHideChrome === 'boolean'
        ? r.autoHideChrome
        : DEFAULT_SETTINGS.autoHideChrome,
    youtubeCompat:
      typeof r.youtubeCompat === 'boolean'
        ? r.youtubeCompat
        : DEFAULT_SETTINGS.youtubeCompat,
  };
}

/** Lenient bookmark sanitization: drops invalid entries, dedupes by URL. */
function sanitizeBookmarks(v: unknown): Bookmark[] {
  if (!Array.isArray(v)) return [];
  const out: Bookmark[] = [];
  const seen = new Set<string>();
  for (const e of v) {
    if (typeof e !== 'object' || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== 'string' || o.id.length === 0 || o.id.length > 64) continue;
    if (typeof o.title !== 'string' || o.title.length > 200) continue;
    if (!isHttpUrl(o.url)) continue;
    if (seen.has(o.url)) continue;
    seen.add(o.url);
    out.push({ id: o.id, title: o.title, url: o.url });
    if (out.length >= MAX_BOOKMARKS) break;
  }
  return out;
}

/** Strict: used for renderer→main updates. Throws on invalid input. */
export function applySettingsUpdate(
  current: Settings,
  update: Partial<Settings>,
): Settings {
  const next: Settings = { ...current };

  if (update.blockEnabled !== undefined) {
    if (typeof update.blockEnabled !== 'boolean') {
      throw new Error('blockEnabled must be a boolean.');
    }
    next.blockEnabled = update.blockEnabled;
  }

  if (update.cosmeticFiltering !== undefined) {
    if (typeof update.cosmeticFiltering !== 'boolean') {
      throw new Error('cosmeticFiltering must be a boolean.');
    }
    next.cosmeticFiltering = update.cosmeticFiltering;
  }

  if (update.blockDomains !== undefined) {
    next.blockDomains = validateDomainList(update.blockDomains, 'blockDomains');
  }
  if (update.allowDomains !== undefined) {
    next.allowDomains = validateDomainList(update.allowDomains, 'allowDomains');
  }

  if (update.lastTabs !== undefined) {
    if (!isStringArray(update.lastTabs) || update.lastTabs.length > MAX_RESTORED_TABS) {
      throw new Error(`lastTabs must be a list of up to ${MAX_RESTORED_TABS} tab URLs.`);
    }
    for (const e of update.lastTabs) {
      if (!isValidTabEntry(e)) {
        throw new Error('lastTabs entries must be empty (home) or an http(s) URL.');
      }
    }
    next.lastTabs = update.lastTabs;
  }

  if (update.bookmarks !== undefined) {
    if (!Array.isArray(update.bookmarks) || update.bookmarks.length > MAX_BOOKMARKS) {
      throw new Error(`Too many bookmarks (max ${MAX_BOOKMARKS}).`);
    }
    const normalized: Bookmark[] = [];
    const seen = new Set<string>();
    for (const b of update.bookmarks) {
      if (typeof b !== 'object' || b === null) {
        throw new Error('Each bookmark must be an object with id, title and url.');
      }
      const o = b as unknown as Record<string, unknown>;
      if (typeof o.id !== 'string' || o.id.length === 0 || o.id.length > 64) {
        throw new Error('Invalid bookmark id.');
      }
      if (typeof o.title !== 'string' || o.title.length > 200) {
        throw new Error('Invalid bookmark title (max 200 characters).');
      }
      if (!isHttpUrl(o.url)) {
        throw new Error(`Bookmark URLs must be http(s) — got "${String(o.url).slice(0, 60)}".`);
      }
      if (seen.has(o.url)) {
        throw new Error(`Duplicate bookmark for ${o.url}.`);
      }
      seen.add(o.url);
      normalized.push({ id: o.id, title: o.title, url: o.url });
    }
    next.bookmarks = normalized;
  }

  if (update.searchProvider !== undefined) {
    if (!isKnownProviderId(update.searchProvider)) {
      throw new Error(`Unknown search provider "${String(update.searchProvider)}".`);
    }
    next.searchProvider = update.searchProvider;
  }

  if (update.autoHideChrome !== undefined) {
    if (typeof update.autoHideChrome !== 'boolean') {
      throw new Error('autoHideChrome must be a boolean.');
    }
    next.autoHideChrome = update.autoHideChrome;
  }

  if (update.youtubeCompat !== undefined) {
    if (typeof update.youtubeCompat !== 'boolean') {
      throw new Error('youtubeCompat must be a boolean.');
    }
    next.youtubeCompat = update.youtubeCompat;
  }

  // Never persist the pseudo-home URL as a real page.
  next.lastTabs = next.lastTabs.map((u) => (u === HOME_URL ? '' : u));
  return next;
}

function validateDomainList(value: unknown, field: string): string[] {
  if (!isStringArray(value)) {
    throw new Error(`${field} must be a list of domain names.`);
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const d = normalizeDomain(entry);
    if (d === null) {
      throw new Error(`"${entry}" is not a valid domain (expected e.g. ads.example.com).`);
    }
    if (!seen.has(d)) {
      seen.add(d);
      normalized.push(d);
    }
  }
  if (normalized.length > MAX_USER_DOMAINS) {
    throw new Error(`Too many domains (max ${MAX_USER_DOMAINS}).`);
  }
  return normalized;
}

/** Lenient dedupe used by sanitizeSettings. */
function uniqueDomains(entries: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const d = normalizeDomain(e);
    if (d !== null && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}
