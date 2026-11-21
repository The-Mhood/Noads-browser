import { describe, expect, it } from 'vitest';
import { FULLSCREEN_BRIDGE_INJECT } from '../electron/fullscreenBridge';

describe('main-world fullscreen bridge', () => {
  it('is valid and idempotent', () => {
    expect(() => new Function(FULLSCREEN_BRIDGE_INJECT)).not.toThrow();
    expect(FULLSCREEN_BRIDGE_INJECT).toContain('window.__noadsFullscreenBridge');
    expect(FULLSCREEN_BRIDGE_INJECT).toContain('reportFullscreenState');
  });

  it('recognizes high-confidence fullscreen and custom player-maximize controls', () => {
    expect(FULLSCREEN_BRIDGE_INJECT).toContain('fullscreenControl');
    expect(FULLSCREEN_BRIDGE_INJECT).toContain('maxi');
    expect(FULLSCREEN_BRIDGE_INJECT).toContain('requestFullscreen');
    expect(FULLSCREEN_BRIDGE_INJECT).toContain('video.requestFullscreen');
    expect(FULLSCREEN_BRIDGE_INJECT).toContain('report(false)');
    expect(FULLSCREEN_BRIDGE_INJECT).toContain('postMessage');
    expect(FULLSCREEN_BRIDGE_INJECT).toContain('dblclick');
    expect(FULLSCREEN_BRIDGE_INJECT).not.toContain('currentTime');
  });
});
