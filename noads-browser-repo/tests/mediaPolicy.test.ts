import { describe, expect, it } from 'vitest';
import { isSpotifyPlaybackRequest } from '../electron/mediaPolicy';

describe('Spotify playback compatibility policy', () => {
  it('allows known Spotify audio delivery from a Spotify page', () => {
    expect(
      isSpotifyPlaybackRequest({
        resourceType: 'media',
        initiator: 'https://open.spotify.com/',
        url: 'https://audio4-ak-spotify-com.akamaized.net/track/segment',
      }),
    ).toBe(true);
    expect(
      isSpotifyPlaybackRequest({
        resourceType: 'fetch',
        initiator: 'https://open.spotify.com/',
        url: 'https://p.scdn.co/mp3-preview/track',
      }),
    ).toBe(true);
  });

  it('does not create a blanket media or cross-site exception', () => {
    expect(
      isSpotifyPlaybackRequest({
        resourceType: 'media',
        initiator: 'https://open.spotify.com/',
        url: 'https://ads.example.test/pre-roll.mp4',
      }),
    ).toBe(false);
    expect(
      isSpotifyPlaybackRequest({
        resourceType: 'media',
        initiator: 'https://example.com/',
        url: 'https://p.scdn.co/mp3-preview/track',
      }),
    ).toBe(false);
    expect(
      isSpotifyPlaybackRequest({
        resourceType: 'script',
        initiator: 'https://open.spotify.com/',
        url: 'https://p.scdn.co/player.js',
      }),
    ).toBe(false);
  });
});
