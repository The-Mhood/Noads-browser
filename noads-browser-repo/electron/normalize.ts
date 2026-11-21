/**
 * Address-bar input resolution. Pure logic — no Electron imports.
 *
 * The typed string is UNTRUSTED INPUT. This function decides what it means
 * (a URL, a search, home, or an error) and normalizes it. It never throws:
 * bad input yields { kind: 'error' } which the UI shows inline.
 *
 * Search terms are routed through the configured provider
 * (shared/searchProviders.ts); unknown provider ids fall back to DuckDuckGo
 * HTML — resolution itself can never fail because of a bad provider id.
 */
import type { NavigationTarget } from '../shared/types';
import { HOME_URL } from '../shared/constants';
import { getProvider } from '../shared/searchProviders';

// A real explicit URL has "scheme://". A bare "word:" is NOT treated as a
// URL here — "localhost:3000" must not be misread as the scheme "localhost".
const EXPLICIT_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const BARE_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$/;
const LOCALHOST_RE = /^localhost(:\d{1,5})?$/i;

/** Common host completions used by the address-bar prediction UI. */
const COMMON_DOMAIN_COMPLETIONS = [
  'google.com',
  'youtube.com',
  'spotify.com',
  'wikipedia.org',
  'github.com',
  'reddit.com',
];

/**
 * Return a conservative domain completion for an address-bar prefix.
 * Navigation still goes through resolveNavigation; this helper only supplies
 * an explicit user-visible candidate and never treats arbitrary words as URLs.
 */
export function suggestAddress(raw: string): string | null {
  const input = (raw ?? '').trim().toLowerCase();
  if (
    input.length < 2 ||
    input.includes(' ') ||
    input.includes('/') ||
    input.includes('?') ||
    input.includes('#') ||
    EXPLICIT_URL_RE.test(input) ||
    BARE_SCHEME_RE.test(input)
  ) {
    return null;
  }

  // Also tolerate the shorthand users commonly type while describing a
  // prefix, e.g. "goo..."; it remains an explicit completion, not a search.
  if (/^goo\.{2,}$/i.test(input)) return 'google.com';

  if (input.endsWith('.') && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.$/i.test(input)) {
    return `${input}com`;
  }

  const match = COMMON_DOMAIN_COMPLETIONS.find(
    (domain) => domain.startsWith(input) && domain !== input,
  );
  return match ?? null;
}

export function resolveNavigation(
  raw: string,
  providerId?: string,
): NavigationTarget {
  const input = (raw ?? '').trim();

  if (input === '' || input.toLowerCase() === 'home') {
    return { kind: 'url', url: HOME_URL };
  }

  const toSearch = (q: string): NavigationTarget => ({
    kind: 'url',
    url: getProvider(providerId).buildUrl(q),
    searchQuery: q,
  });

  if (EXPLICIT_URL_RE.test(input)) {
    // User typed an explicit "scheme://" — honor it, then validate below.
    return validateUrl(input, input);
  }

  if (IPV4_RE.test(input) || LOCALHOST_RE.test(input)) {
    // Local machines serve http, not https. (Checked BEFORE the bare-scheme
    // branch, because "localhost:3000" contains a colon.)
    return validateUrl(`http://${input}`, input);
  }

  if (BARE_SCHEME_RE.test(input)) {
    // "scheme:" without "//" (e.g. javascript:alert(1), mailto:x@y.z).
    // Never navigate; report the protocol clearly.
    try {
      const proto = new URL(input).protocol.replace(':', '');
      return {
        kind: 'error',
        message: `The "${proto}" protocol is not supported. This browser only opens http and https pages.`,
      };
    } catch {
      return {
        kind: 'error',
        message: 'That is not a valid address. Try something like example.com or a search phrase.',
      };
    }
  }

  if (input.includes(' ')) {
    // Contains spaces → search query.
    return toSearch(input);
  }

  if (input.includes('.')) {
    return validateUrl(`https://${input}`, input);
  }

  // Single word without a dot or colon → search, not a domain.
  return toSearch(input);
}

/** Parse + validate a candidate URL (untrusted). Never throws. */
function validateUrl(candidate: string, original: string): NavigationTarget {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      kind: 'error',
      message: 'That is not a valid address. Try something like example.com or a search phrase.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      kind: 'error',
      message: `The "${parsed.protocol.replace(':', '')}" protocol is not supported. This browser only opens http and https pages.`,
    };
  }

  const host = parsed.hostname;
  if (
    host === '' ||
    (!host.includes('.') && !IPV4_RE.test(host) && host !== 'localhost')
  ) {
    return {
      kind: 'error',
      message: `Could not find a host in "${original}". Include a domain, e.g. example.com.`,
    };
  }

  return { kind: 'url', url: parsed.toString() };
}

/**
 * Strict URL extraction for bookmarks: bare domains get https, explicit
 * URLs are kept. Search terms are NEVER accepted — a bookmark must point
 * at an actual page. Never throws.
 */
export function bookmarkUrl(raw: string): string | null {
  const input = (raw ?? '').trim();
  if (input === '' || input === HOME_URL) return null;
  const target = resolveNavigation(input);
  if (target.kind !== 'url' || target.searchQuery) return null;
  try {
    const u = new URL(target.url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return target.url;
}

/**
 * What the address bar shows for a settled page URL: home → '', otherwise
 * the URL without its scheme. (Search queries are tracked separately by the
 * main process, so no provider-specific reverse mapping is needed here.)
 */
export function displayFor(url: string): string {
  if (url === HOME_URL) return '';
  if (url.startsWith('https://')) return url.slice('https://'.length);
  if (url.startsWith('http://')) return url.slice('http://'.length);
  return url;
}
