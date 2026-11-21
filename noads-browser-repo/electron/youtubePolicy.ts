/**
 * Narrow YouTube video-ad request policy.
 *
 * General filter lists handle most third-party advertising. YouTube also uses
 * first-party ad endpoints, so a small URL-only policy covers known ad
 * decision/telemetry surfaces without touching googlevideo media. Blocking a
 * shared media endpoint can leave the content player black, because YouTube
 * may reuse the same media pipeline for ads and the requested video.
 */

const YOUTUBE_AD_HOSTS = new Set([
  'ad.doubleclick.net',
  'googleads.g.doubleclick.net',
  'pubads.g.doubleclick.net',
  'securepubads.g.doubleclick.net',
  'pagead2.googlesyndication.com',
  'googleads4.g.doubleclick.net',
  'www.googleadservices.com',
  // NOTE: imasdk.googleapis.com is deliberately NOT hard-blocked. Some
  // players (especially embeds) wait for the IMA SDK's load event; cancelling
  // the script can stall the content video forever. Its ad *requests* are
  // still blocked via the DoubleClick/AdSense hosts above and the maintained
  // filter engine.
]);

const YOUTUBE_HOST_RE = /(^|\.)youtube(?:-nocookie)?\.com$/i;
const YOUTUBE_API_HOST_RE = /^youtubei\.googleapis\.com$/i;
const YOUTUBE_MEDIA_HOST_RE = /(^|\.)googlevideo\.com$/i;
const YOUTUBE_MEDIA_TYPES = new Set(['media', 'object']);
const YOUTUBE_AD_PATH_RE =
  /\/(?:pagead|ptracking|adservice|ad_status|ad_break|get_midroll_info)(?:\/|$)/i;

/**
 * YouTube content and ad media share googlevideo.com. Let Chromium's media
 * pipeline through so the requested video cannot be blanked by a broad filter;
 * ad decision endpoints and in-player controls remain handled separately.
 */
export function isYouTubePlaybackRequest(details: {
  url: string;
  resourceType?: string;
}): boolean {
  if (details.resourceType && !YOUTUBE_MEDIA_TYPES.has(details.resourceType)) return false;
  let url: URL;
  try {
    url = new URL(details.url);
  } catch {
    return false;
  }
  return (
    YOUTUBE_MEDIA_HOST_RE.test(url.hostname) &&
    (/^\/videoplayback(?:\/|$)/i.test(url.pathname) ||
      /^\/api\/manifest\//i.test(url.pathname))
  );
}

/**
 * Return true only for a known ad endpoint. Deliberately do not block
 * googlevideo.com/videoplayback, even when its query contains ad-looking
 * fields: content and ad media can share that pipeline.
 */
export function isYouTubeAdRequest(details: { url: string }): boolean {
  let url: URL;
  try {
    url = new URL(details.url);
  } catch {
    return false;
  }

  const host = url.hostname.toLowerCase();
  if (YOUTUBE_AD_HOSTS.has(host)) return true;
  if (
    YOUTUBE_API_HOST_RE.test(host) &&
    /\/youtubei\/v1\/player\/ad_break(?:\/|$)/i.test(url.pathname)
  ) {
    return true;
  }

  if (YOUTUBE_HOST_RE.test(host)) {
    if (YOUTUBE_AD_PATH_RE.test(url.pathname)) return true;
    // These are first-party ad decision/telemetry paths, not video pages.
    if (url.pathname === '/api/stats/ads' || url.pathname === '/get_midroll_info') {
      return true;
    }
  }
  return false;
}
