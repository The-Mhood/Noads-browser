import { describe, expect, it } from 'vitest';
import { isSameSite, siteKey } from '../electron/sitePolicy';

describe('site policy', () => {
  it('groups ordinary subdomains under one site', () => {
    expect(isSameSite('open.spotify.com', 'www.spotify.com')).toBe(true);
    expect(siteKey('a.example.co.uk')).toBe('example.co.uk');
  });

  it('keeps unrelated domains and IP addresses separate', () => {
    expect(isSameSite('spotify.com', 'spotify.example.com')).toBe(false);
    expect(isSameSite('192.168.1.5', '192.168.2.5')).toBe(false);
    expect(isSameSite('192.168.1.5', '192.168.1.5')).toBe(true);
  });
});
