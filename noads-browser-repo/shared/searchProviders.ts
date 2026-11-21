/**
 * Search provider registry.
 *
 * Pure data + functions — no Electron imports — shared by:
 *  - the main process (electron/normalize.ts) to build search URLs, and
 *  - the renderer (src/components/SettingsPanel.tsx) for the provider picker.
 *
 * ADDING A PROVIDER LATER = append one entry to SEARCH_PROVIDERS. Nothing
 * else changes: resolution and the picker both read from this registry.
 * Providers are synchronous today; if a future provider needs async lookup
 * (e.g. an API key), extend SearchProvider with an optional async variant —
 * the registry shape itself stays.
 */

export interface SearchProvider {
  /** Stable id, persisted in settings. */
  id: string;
  /** Human-readable name for the settings picker. */
  name: string;
  /** Build a search URL for a query. Pure + synchronous. */
  buildUrl: (query: string) => string;
}

export const SEARCH_PROVIDERS: SearchProvider[] = [
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    buildUrl: (q: string) => `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'google',
    name: 'Google',
    buildUrl: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'bing',
    name: 'Bing',
    buildUrl: (q: string) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    buildUrl: (q: string) =>
      `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
  },
];

/** Used when no provider is configured. */
export const DEFAULT_SEARCH_PROVIDER = 'duckduckgo';
/** Used when a configured provider id is unknown. DuckDuckGo HTML (no-JS,
 *  ad-light endpoint) is the designated fallback. */
export const FALLBACK_SEARCH_PROVIDER = 'duckduckgo';

/** Never returns null: unknown/missing ids fall back to DDG HTML. */
export function getProvider(id: string | null | undefined): SearchProvider {
  if (typeof id === 'string') {
    const found = SEARCH_PROVIDERS.find((p) => p.id === id);
    if (found) return found;
  }
  return (
    SEARCH_PROVIDERS.find((p) => p.id === FALLBACK_SEARCH_PROVIDER) ??
    SEARCH_PROVIDERS[0]
  );
}

export function isKnownProviderId(id: unknown): id is string {
  return typeof id === 'string' && SEARCH_PROVIDERS.some((p) => p.id === id);
}
