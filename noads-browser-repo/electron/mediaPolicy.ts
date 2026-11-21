/**
 * Narrow playback exceptions for known Spotify audio delivery hosts.
 *
 * This is deliberately not a general "allow media" switch: the maintained
 * engine continues to evaluate all other media and ad requests.
 */
export interface RequestLike {
  url: string;
  resourceType: string;
  initiator?: string;
  referrer?: string;
}

const PLAYBACK_RESOURCE_TYPES = new Set(['media', 'object', 'xhr', 'fetch']);

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isHostOrSubdomain(host: string | null, root: string): boolean {
  return host === root || host?.endsWith(`.${root}`) === true;
}

function isSpotifyPage(host: string | null): boolean {
  return isHostOrSubdomain(host, 'spotify.com');
}

function isSpotifyPlaybackHost(host: string | null): boolean {
  return (
    isHostOrSubdomain(host, 'spotify.com') ||
    isHostOrSubdomain(host, 'scdn.co') ||
    isHostOrSubdomain(host, 'spotifycdn.com') ||
    (host?.endsWith('.akamaized.net') === true &&
      /^audio[^.]*.*spotify/i.test(host))
  );
}

/** True only for a Spotify page requesting a known Spotify audio endpoint. */
export function isSpotifyPlaybackRequest(details: RequestLike): boolean {
  if (!PLAYBACK_RESOURCE_TYPES.has(details.resourceType)) return false;
  const initiatorHost = hostOf(details.initiator) ?? hostOf(details.referrer);
  return isSpotifyPage(initiatorHost) && isSpotifyPlaybackHost(hostOf(details.url));
}
