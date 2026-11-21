import { describe, expect, it } from 'vitest';
import {
  isYouTubeAdRequest,
  isYouTubePlaybackRequest,
} from '../electron/youtubePolicy';

describe('YouTube ad request policy', () => {
  it('blocks known ad-serving endpoints', () => {
    expect(
      isYouTubeAdRequest({ url: 'https://googleads.g.doubleclick.net/pagead/ads?client=youtube' }),
    ).toBe(true);
    expect(
      isYouTubeAdRequest({ url: 'https://www.youtube.com/pagead/interaction/?id=1' }),
    ).toBe(true);
    expect(
      isYouTubeAdRequest({ url: 'https://imasdk.googleapis.com/js/sdkloader/ima3.js' }),
    ).toBe(true);
    expect(
      isYouTubeAdRequest({
        url: 'https://youtubei.googleapis.com/youtubei/v1/player/ad_break?key=test',
      }),
    ).toBe(true);
  });

  it('never blocks shared YouTube googlevideo media', () => {
    const content =
      'https://r1---sn.example.googlevideo.com/videoplayback?id=content&mime=video%2Fmp4';
    const adShaped =
      'https://r1---sn.example.googlevideo.com/videoplayback?id=ad&adformat=12&oad=1&mime=video%2Fmp4';
    expect(isYouTubeAdRequest({ url: content })).toBe(false);
    expect(isYouTubeAdRequest({ url: adShaped })).toBe(false);
    expect(isYouTubePlaybackRequest({ url: content, resourceType: 'media' })).toBe(true);
    expect(isYouTubePlaybackRequest({ url: adShaped, resourceType: 'media' })).toBe(true);
    expect(isYouTubePlaybackRequest({ url: content, resourceType: 'xhr' })).toBe(false);
    expect(isYouTubePlaybackRequest({ url: 'https://evil.example/videoplayback', resourceType: 'media' })).toBe(false);
  });

  it('does not block ordinary YouTube navigation or player API requests', () => {
    expect(isYouTubeAdRequest({ url: 'https://www.youtube.com/watch?v=abc123' })).toBe(false);
    expect(isYouTubeAdRequest({ url: 'https://www.youtube.com/youtubei/v1/player' })).toBe(false);
    expect(isYouTubeAdRequest({ url: 'https://notyoutube.com/pagead/ads' })).toBe(false);
  });
});
