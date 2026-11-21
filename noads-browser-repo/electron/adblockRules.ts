import { normalizeDomain } from '../electron/blocklist';

/** Refresh maintained filter lists at most once per week. */
export const FILTER_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Build EasyList-style rules for the app's existing custom domain settings.
 * The maintained engine handles the large public lists; these rules preserve
 * the browser's user-facing Always block / Never block controls.
 */
export function buildDomainFilterRules(
  blockedDomains: string[],
  allowedDomains: string[],
): string[] {
  const rules: string[] = [];
  const seen = new Set<string>();

  for (const raw of blockedDomains) {
    const domain = normalizeDomain(raw);
    if (domain === null) continue;
    const rule = `||${domain}^`;
    if (!seen.has(rule)) {
      seen.add(rule);
      rules.push(rule);
    }
  }

  for (const raw of allowedDomains) {
    const domain = normalizeDomain(raw);
    if (domain === null) continue;
    const rule = `@@||${domain}^`;
    if (!seen.has(rule)) {
      seen.add(rule);
      rules.push(rule);
    }
  }

  return rules;
}

export function isFilterCacheFresh(
  generatedAt: number,
  now = Date.now(),
  maxAgeMs = FILTER_CACHE_MAX_AGE_MS,
): boolean {
  return (
    Number.isFinite(generatedAt) &&
    generatedAt > 0 &&
    generatedAt <= now &&
    now - generatedAt <= maxAgeMs
  );
}
