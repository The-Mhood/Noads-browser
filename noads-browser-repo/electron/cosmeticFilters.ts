/**
 * Supplemental cosmetic filtering. The maintained EasyList/uBlock-compatible
 * engine is the primary in-page filter; these app-specific rules cover a few
 * Electron/browser surfaces that are useful to keep explicit — such as
 * YouTube's known ad containers and in-page popup dialog boxes.
 * Two layers are applied per document:
 *
 *  1. Static CSS (buildCosmeticCSS): hides elements matching curated
 *     selectors. Injected with cssOrigin 'user', so page styles cannot win.
 *  2. Runtime popup/ad-dialog filter (buildPopupFilterJS): hides fixed,
 *     absolute, or sticky overlays when they contain a blocked ad iframe or
 *     suspicious ad/notification/age-gate language. YouTube gets a small
 *     player monitor that clicks an available skip control without touching
 *     the page-owned content video.
 *
 * Extending: add a site's selectors to SITE_RULES (one entry per host
 * pattern) — nothing else changes. Same one-line extension pattern as the
 * search provider registry.
 */

export interface SiteRule {
  /** Tested against the lowercased page hostname. */
  host: RegExp;
  selectors: string[];
}

/**
 * Applied on every http(s) page. Every pattern names something that is an
 * ad by definition (ids/classes "ad-…", GPT ad containers, literal
 * "Advertisement" labels) — deliberately conservative to avoid hiding real
 * content.
 */
export const GENERIC_AD_SELECTORS: string[] = [
  '[id^="ad-"]',
  '[class^="ad-"]',
  '[id*="adsbygoogle"]',
  '.adsbygoogle',
  '[data-ad-unit]',
  '[data-adbridge]',
  '[id^="div-gpt-ad"]',
  '[id^="google_ads_"]',
  '[id*="gpt_ad"]',
  '[aria-label^="Advertisement"]',
  '[class*="google-auto-placed"]',
];

/**
 * Site-specific rules. YouTube's custom elements are stable enough to
 * curate; other platforms (hashed class names) are left to future phases —
 * add an entry here per site.
 */
export const SITE_RULES: SiteRule[] = [
  {
    host: /(^|\.)youtube\.com$/,
    selectors: [
      'ytd-ad-slot-renderer', // ad cards between videos / watch page
      'ytd-in-feed-ad-layout-renderer', // sponsored cards in feeds
      'ytd-promoted-sparkles-web-renderer', // promoted search/home cards
      'ytd-display-ad-renderer', // companion/display ad cards
      'ytd-companion-slot-renderer', // right-rail companion ads
      'ytd-action-companion-ad-renderer', // player companion ads
      'ytd-player-legacy-desktop-watch-ads-renderer', // legacy watch-page ads
      // Keep the player ad wrapper mounted: it contains YouTube's own
      // Skip/Close controls, which the runtime controller clicks safely.
      // Hiding the wrapper here makes those controls non-visible and prevents
      // the player from advancing on some YouTube revisions.
      '#player-ads', // player ad slot outside the video element
      '.ytp-ad-overlay-container', // image/text overlays over the player
      '.ytp-ad-overlay-slot', // current image/text ad slot
      '.ytp-ad-message-container', // sponsored/ad message over the player
      '.ytp-ad-text', // sponsored/ad text inside the player
      '.ytp-ad-text-overlay', // text overlay ads
      '.ytp-ad-image-overlay', // image overlay ads
      '.ytd-ad-overlay-view', // overlay ads on the player
      'ytd-compact-video-renderer[target-id^="ad-"]', // sponsored in related list
      'ytd-grid-video-renderer[target-id^="ad-"]', // sponsored in home grid
      'ytd-video-renderer[target-id^="ad-"]', // sponsored in search results
      'ytd-ad-action-composer', // "Sponsored" composer rows
    ],
  },
];

/**
 * Compose the per-page cosmetic CSS. Pure + deterministic (unit-tested).
 * Rule data can never inject CSS: selectors containing braces are dropped.
 */
export function buildCosmeticCSS(hostname: string): string {
  const host = (hostname ?? '').toLowerCase();
  const selectors = new Set<string>(GENERIC_AD_SELECTORS);
  for (const rule of SITE_RULES) {
    if (rule.host.test(host)) {
      for (const s of rule.selectors) selectors.add(s);
    }
  }
  const parts: string[] = [];
  for (const sel of selectors) {
    if (typeof sel !== 'string' || sel.trim() === '') continue;
    if (sel.includes('{') || sel.includes('}')) continue; // refuse rule injection
    parts.push(`${sel.trim()} { display: none !important; }`);
  }
  return parts.join('\n');
}

const SAFE_HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

/**
 * Build the runtime popup-filter script for a page. `blockedHosts` is the
 * effective block domain list (bundled + user, minus allowlist) — the
 * script uses it to recognize ad iframes inside popups. Pure string
 * building; the script is idempotent and ES5-safe for any page.
 */
export function buildPopupFilterJS(blockedHosts: string[]): string {
  const hosts = blockedHosts.filter(
    (h): h is string => typeof h === 'string' && h.length > 0 && h.length <= 253 && SAFE_HOST_RE.test(h),
  );
  return `(function () {
  if (window.__adfPopupFilter) return;
  window.__adfPopupFilter = true;
  var AD_HOSTS = ${JSON.stringify(hosts)};
  var IS_YT = /(^|\\.)youtube\\.com$/i.test(location.hostname);
  var lastScanAt = 0;
  var lastYtStepAt = 0;

  function isAdHost(u) {
    var h;
    try { h = new URL(u).hostname.toLowerCase(); } catch (e) { return false; }
    for (var i = 0; i < AD_HOSTS.length; i++) {
      var s = AD_HOSTS[i];
      if (h === s || h.slice(-(s.length + 1)) === '.' + s) return true;
    }
    return false;
  }

  function embedsAdIframe(el) {
    var ifr = el.querySelectorAll('iframe, frame');
    for (var i = 0; i < ifr.length; i++) {
      var src = ifr[i].getAttribute('src') || '';
      if (src && isAdHost(src)) return true;
    }
    return false;
  }

  var SUSPICIOUS_TEXT = /(over\\s*18|adult\\s*only|click\\s+(the\\s+)?["']?(allow|enable|continue|verify)|allow\\s+(notifications|to\\s+continue|this\\s+site)|enable\\s+(notifications|browser)|turn\\s+off\\s+ads|ads?\\s+settings|backup\\s+domains?|disable\\s+(your\\s+)?ad[ -]?blocker|whitelist|verify\\s+(you'?re|you\\s+are)\\s+(human|not\\s+a\\s+robot)|confirm\\s+you'?re\\s+(over|18))/i;

  function hasSuspiciousText(el) {
    var text = (el.textContent || '').replace(/\\s+/g, ' ').slice(0, 1600);
    return text.length > 0 && SUSPICIOUS_TEXT.test(text);
  }

  function hasOverlayHint(el) {
    var name = ((el.id || '') + ' ' + (el.className || '') + ' ' +
      (el.getAttribute('role') || '')).toLowerCase();
    return /(popup|modal|overlay|interstitial|dialog|age[-_]?gate|adblock|notice|consent)/.test(name);
  }

  function isOverlay(el) {
    var st = window.getComputedStyle(el);
    if (!st) return false;
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    if (st.position !== 'fixed' && st.position !== 'absolute' && st.position !== 'sticky') return false;
    var r = el.getBoundingClientRect();
    var vw = document.documentElement.clientWidth || window.innerWidth || 0;
    var vh = document.documentElement.clientHeight || window.innerHeight || 0;
    if (!vw || !vh) return false;
    return r.width >= 160 && r.height >= 80 &&
      r.width * r.height >= vw * vh * 0.015;
  }

  function hideElement(el) {
    if (el.getAttribute('data-adf-cosmetic') === '1') return;
    el.setAttribute('data-adf-cosmetic', '1');
    el.style.setProperty('display', 'none', 'important');
  }

  function shouldHideOverlay(el) {
    if (!isOverlay(el)) return false;
    if (embedsAdIframe(el)) return true;
    return hasSuspiciousText(el) && (hasOverlayHint(el) ||
      /turn\\s+off\\s+ads|ads?\\s+settings|backup\\s+domains?|over\\s*18|click\\s+.*(allow|enable)/i.test(el.textContent || ''));
  }

  // Cheap, selector-targeted overlay pass — safe to run on every site.
  function scanOverlays() {
    if (!document.body) return;
    var els = document.body.querySelectorAll(
      '[id*="popup"],[class*="popup"],' +
        '[id*="modal"],[class*="modal"],' +
        '[id*="overlay"],[class*="overlay"],' +
        '[id*="interstitial"],[class*="interstitial"],' +
        '[id*="dialog"],[class*="dialog"],' +
        '[id*="age"],[class*="age"],[role="dialog"],[aria-modal="true"],' +
        '[style*="position"]'
    );
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (shouldHideOverlay(el)) hideElement(el);
    }
  }

  // Expensive full-DOM sweep for generated class names. Never run on
  // YouTube: its DOM mutates constantly and this pass alone was making pages
  // crawl. Other sites get it at most once every 1.5 s.
  function scanGenerated() {
    if (IS_YT || !document.body) return;
    var now = Date.now();
    if (now - lastScanAt < 1500) return;
    lastScanAt = now;
    var all = document.body.querySelectorAll('*');
    var limit = Math.min(all.length, 5000);
    for (var j = 0; j < limit; j++) {
      var candidate = all[j];
      if (candidate.getAttribute('data-adf-cosmetic') === '1') continue;
      if (!hasSuspiciousText(candidate)) continue;
      var candidateText = candidate.textContent || '';
      if (isOverlay(candidate) && (hasOverlayHint(candidate) ||
          /turn\\s+off\\s+ads|ads?\\s+settings|backup\\s+domains?|over\\s*18|adult\\s+only|click\\s+.*(allow|enable)|disable\\s+(your\\s+)?ad[ -]?blocker/i.test(candidateText))) {
        hideElement(candidate);
      }
    }
  }

  function scan() {
    scanOverlays();
    scanGenerated();
  }

  var youtubeSavedMuted = null;
  var youtubeSavedVolume = null;
  var youtubeMutedByAdf = false;
  var youtubeStuckSince = 0;

  function youtubeVisible(el) {
    if (!el) return false;
    var st = window.getComputedStyle(el);
    var r = el.getBoundingClientRect();
    return st.display !== 'none' && st.visibility !== 'hidden' &&
      r.width > 0 && r.height > 0;
  }

  function youtubeClick(el, trustedControl) {
    if (!el || typeof el.click !== 'function') return false;
    if (trustedControl && window.__adf &&
        typeof window.__adf.reportYoutubeControl === 'function') {
      try {
        var r = el.getBoundingClientRect();
        window.__adf.reportYoutubeControl(JSON.stringify({
          kind: 'skip', x: r.left + r.width / 2, y: r.top + r.height / 2
        }));
        return true;
      } catch (e) {
        /* fall through to a page-local click if the bridge is unavailable */
      }
    }
    // Dispatch the same basic pointer sequence used by the player controls,
    // then call click as a fallback for controls that listen to click only.
    try {
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    } catch (e) {
      /* a page can replace the element between the lookup and dispatch */
    }
    el.click();
    return true;
  }

  function youtubeRestoreAudio(video) {
    if (!youtubeMutedByAdf || !video) return;
    if (youtubeSavedMuted !== null) video.muted = youtubeSavedMuted;
    if (youtubeSavedVolume !== null) video.volume = youtubeSavedVolume;
    video.removeAttribute('data-adf-muted-ad');
    youtubeSavedMuted = null;
    youtubeSavedVolume = null;
    youtubeMutedByAdf = false;
  }

  function youtubeAdStep() {
    if (!IS_YT) return;
    var now = Date.now();
    if (now - lastYtStepAt < 400) return; // bound CPU on a mutating page
    lastYtStepAt = now;
    var player = document.querySelector('#movie_player');
    if (!player) return;
    var showing = player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting') ||
      !!document.querySelector('.ad-showing,.ad-interrupting');
    var video = player.querySelector('video');

    if (!showing) {
      youtubeRestoreAudio(video);
      return;
    }

    // Click only YouTube's own high-confidence ad controls. This avoids
    // seeking the page-owned video, which can end a real video or produce a
    // black player when YouTube reuses the same video element for ads.
    var close = player.querySelector(
      '.ytp-ad-overlay-close-button,.ytp-ad-overlay-close-container,' +
        'button[aria-label*="Close ad"],button[aria-label*="Close Ad"]'
    );
    if (youtubeVisible(close)) youtubeClick(close, false);

    var skip = player.querySelector(
      'button.ytp-ad-skip-button-modern,button.ytp-ad-skip-button,' +
        '.ytp-ad-skip-button-modern,.ytp-skip-ad-button,' +
        '.ytp-ad-skip-button-slot button,.ytp-ad-skip-ad-slot button,' +
        '[aria-label^="Skip ad"],[aria-label^="Skip Ad"],' +
        '[aria-label^="Skip ads"],[aria-label^="Skip Ads"]'
    );
    if (youtubeVisible(skip)) {
      youtubeClick(skip, true);
      return;
    }

    // Some YouTube revisions render the button with a generated class but
    // retain its accessible label/text. Click only that control.
    var buttons = player.querySelectorAll('button,[role="button"]');
    for (var i = 0; i < buttons.length; i++) {
      var label = ((buttons[i].getAttribute('aria-label') || '') + ' ' +
        (buttons[i].textContent || '')).replace(/\\s+/g, ' ').trim();
      if (youtubeVisible(buttons[i]) &&
          (/^skip\\s+ad(s)?$/i.test(label) || /^skip\\s+ads?\\b/i.test(label))) {
        youtubeClick(buttons[i], true);
        return;
      }
    }

    // There may be no skip control during a non-skippable pre-roll. Mute that
    // interval rather than seeking or replacing the user's content video;
    // audio is restored as soon as YouTube removes its ad state.
    if (video && !youtubeMutedByAdf) {
      youtubeSavedMuted = video.muted;
      youtubeSavedVolume = video.volume;
      video.muted = true;
      video.volume = 0;
      video.setAttribute('data-adf-muted-ad', '1');
      youtubeMutedByAdf = true;
    }

    // Playback recovery: when an ad request was blocked at the network level,
    // some player revisions sit in the ad state with a stalled video (paused
    // or no data) and never advance to the content. After 7 s of a stalled
    // ad-state player, nudge playback once — never seek, never reload.
    if (video && (video.paused || video.readyState < 2)) {
      if (!youtubeStuckSince) youtubeStuckSince = Date.now();
      if (Date.now() - youtubeStuckSince > 7000) {
        youtubeStuckSince = 0;
        try {
          var playResult = video.play();
          if (playResult && typeof playResult.catch === 'function') {
            playResult.catch(function () {});
          }
        } catch (e) { /* autoplay policy may refuse; the next interval retries */ }
      }
    } else {
      youtubeStuckSince = 0;
    }
  }

  var timer = 0;
  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(function () { scan(); }, ms);
  }
  schedule(500);
  setTimeout(function () { scan(); }, 2500);
  document.addEventListener('click', function () {
    schedule(400);
    youtubeAdStep();
  }, { passive: true });
  if (IS_YT) {
    setInterval(youtubeAdStep, 500);
  }
  try {
    var mo = new MutationObserver(function () {
      schedule(800);
      youtubeAdStep();
    });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
  } catch (e) {
    setInterval(function () { scan(); youtubeAdStep(); }, 3000);
  }
})();`;
}
