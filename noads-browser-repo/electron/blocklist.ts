/**
 * Blocklist domain matching. Pure logic — no Electron imports — so it can be
 * unit-tested in Node.
 *
 * Matching rule: a blocklist entry "ads.example.com" matches the host
 * "ads.example.com" and any subdomain ("x.ads.example.com"), but NOT
 * "badads.example.com". This is suffix matching with a dot boundary.
 *
 * Perf note: O(domains) per request. Fine for the ~200-entry bundled list.
 * If we later load EasyList (50k+ rules), replace this with a trie /
 * longest-suffix-walk before shipping that phase.
 */

export interface DomainMatcher {
  /** Returns true if `host` is blocked by this matcher. */
  test(host: string): boolean;
  readonly size: number;
  /** The canonical domain entries (sorted). Used to build per-page filters. */
  list(): string[];
}

const DOMAIN_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/**
 * Normalize a user-supplied domain entry. Accepts "Ads.Example.com/",
 * "https://ads.example.com/path" and lowercases/strips www. Returns null when
 * the input is not a valid domain — callers decide how to surface that.
 */
export function normalizeDomain(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  let d = raw.trim().toLowerCase();
  if (d === '') return null;

  // If a full URL was pasted, extract the host.
  if (d.includes('//') || d.includes('/')) {
    try {
      d = new URL(d.includes('://') ? d : `http://${d}`).hostname;
    } catch {
      return null;
    }
  }

  // Strip one leading "www." — blocking "example.com" should cover
  // "www.example.com" anyway via suffix match, but keep entries canonical.
  if (d.startsWith('www.') && d.length > 4) d = d.slice(4);

  if (d.endsWith('.')) return null;
  if (d.length > 253) return null;
  if (!DOMAIN_RE.test(d)) return null;
  // Require at least one dot: a bare TLD-level entry would block half the internet.
  if (!d.includes('.')) return null;
  return d;
}

/** Build a matcher from raw domain entries. Invalid entries are dropped. */
export function makeMatcher(entries: string[]): DomainMatcher {
  const set = new Set<string>();
  for (const e of entries) {
    const n = normalizeDomain(e);
    if (n !== null) set.add(n);
  }
  return {
    test(host: string): boolean {
      const h = host.toLowerCase();
      for (const d of set) {
        if (h === d || h.endsWith(`.${d}`)) return true;
      }
      return false;
    },
    get size(): number {
      return set.size;
    },
    list(): string[] {
      return Array.from(set).sort();
    },
  };
}
