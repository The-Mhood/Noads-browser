/** Dependency-free hostname grouping for ordinary same-site navigation. */
const MULTI_LABEL_SUFFIXES = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);

export function siteKey(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^\.+|\.+$/g, '');
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2 || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return host;
  const secondLevel = labels[labels.length - 2];
  const take = MULTI_LABEL_SUFFIXES.has(secondLevel) ? 3 : 2;
  return labels.slice(-take).join('.');
}

export function isSameSite(a: string, b: string): boolean {
  return siteKey(a) === siteKey(b);
}
