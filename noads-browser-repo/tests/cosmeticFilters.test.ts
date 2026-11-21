import { describe, expect, it } from 'vitest';
import {
  GENERIC_AD_SELECTORS,
  SITE_RULES,
  buildCosmeticCSS,
  buildPopupFilterJS,
} from '../electron/cosmeticFilters';

describe('buildCosmeticCSS', () => {
  it('applies generic selectors to a plain site', () => {
    const css = buildCosmeticCSS('example.com');
    expect(css).toContain('.adsbygoogle { display: none !important; }');
    expect(css).toContain('[id^="ad-"] { display: none !important; }');
    expect(css).toContain('[id^="div-gpt-ad"] { display: none !important; }');
    // site-specific rules must NOT leak to other hosts
    expect(css).not.toContain('ytd-ad-slot-renderer');
  });

  it('adds YouTube rules for youtube.com and subdomains only', () => {
    for (const host of ['youtube.com', 'www.youtube.com', 'm.youtube.com']) {
      const css = buildCosmeticCSS(host);
      expect(css).toContain('ytd-ad-slot-renderer { display: none !important; }');
      // The player ad wrapper remains mounted so its native Skip/Close
      // controls stay actionable; the runtime controller handles those.
      expect(css).toContain('#player-ads { display: none !important; }');
      expect(css).not.toContain('.html5-video-ads { display: none !important; }');
      expect(css).not.toContain('.ytp-ad-module { display: none !important; }');
      expect(css).toContain('ytd-in-feed-ad-layout-renderer { display: none !important; }');
    }
    for (const host of ['notyoutube.com', 'myyoutube.com', 'youtube.com.evil.net']) {
      expect(buildCosmeticCSS(host)).not.toContain('ytd-ad-slot-renderer');
    }
  });

  it('handles empty/non-host input without throwing', () => {
    expect(buildCosmeticCSS('')).toContain('.adsbygoogle');
    expect(() => buildCosmeticCSS(undefined as unknown as string)).not.toThrow();
  });

  it('keeps the CSS balanced and injection-safe', () => {
    const css = buildCosmeticCSS('www.youtube.com');
    const open = (css.match(/{/g) ?? []).length;
    const close = (css.match(/}/g) ?? []).length;
    expect(open).toBe(close);
    expect(open).toBeGreaterThan(10);
    // every curated selector is well-formed (no braces inside rule data)
    for (const sel of GENERIC_AD_SELECTORS) {
      expect(sel).not.toContain('{');
      expect(sel).not.toContain('}');
    }
    for (const rule of SITE_RULES) {
      for (const sel of rule.selectors) {
        expect(sel.trim().length).toBeGreaterThan(0);
        expect(sel).not.toContain('{');
        expect(sel).not.toContain('}');
      }
    }
  });
});

describe('buildPopupFilterJS', () => {
  it('is valid, self-contained JavaScript', () => {
    const js = buildPopupFilterJS(['doubleclick.net', 'googlesyndication.com']);
    expect(() => new Function(js)).not.toThrow();
    expect(js).toContain('"doubleclick.net"');
    expect(js).toContain('"googlesyndication.com"');
  });

  it('is idempotent and uses the guard flag', () => {
    const js = buildPopupFilterJS([]);
    expect(js).toContain('window.__adfPopupFilter');
    expect(js).not.toContain('${'); // no template interpolation leaks
  });

  it('drops invalid host entries from the embedded list', () => {
    const js = buildPopupFilterJS([
      'good.example.com',
      'bad host.com',
      '',
      42 as unknown as string,
      'x'.repeat(300),
    ]);
    const match = js.match(/var AD_HOSTS = (\[[^\]]*\])/);
    const hosts = JSON.parse(match?.[1] ?? '[]') as string[];
    expect(hosts).toEqual(['good.example.com']);
  });

  it('handles ad iframes, suspicious dialogs, and YouTube player ads', () => {
    const js = buildPopupFilterJS(['ads.example.com']);
    expect(js).toContain('embedsAdIframe');
    expect(js).toContain('isOverlay');
    expect(js).toContain('SUSPICIOUS_TEXT');
    expect(js).toContain('youtubeAdStep');
    expect(js).toContain('ytp-ad-skip-button');
    expect(js).toContain('Skip Ads');
    expect(js).toContain('reportYoutubeControl');
    expect(js).toContain('seeking the page-owned video');
    expect(js).toContain('rather than seeking');
    expect(js).not.toContain('video.currentTime = video.duration');
  });
});
