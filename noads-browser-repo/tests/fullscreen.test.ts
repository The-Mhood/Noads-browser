import { describe, expect, it } from 'vitest';
import { createFullscreenTracker } from '../electron/fullscreen';
import type { Tab } from '../electron/tabs';

describe('fullscreen tracker', () => {
  it('does not immediately undo ordinary OS fullscreen', () => {
    let full = true;
    const win = {
      isDestroyed: () => false,
      isFullScreen: () => full,
      setFullScreen: (value: boolean) => {
        full = value;
      },
    };
    let relayouts = 0;
    const tracker = createFullscreenTracker({
      window: () => win as never,
      relayout: () => {
        relayouts += 1;
      },
    });

    tracker.sync();

    expect(full).toBe(true);
    expect(relayouts).toBe(1);
  });

  it('enters and exits OS fullscreen for an HTML5 fullscreen tab', () => {
    let full = false;
    const win = {
      isDestroyed: () => false,
      isFullScreen: () => full,
      setFullScreen: (value: boolean) => {
        full = value;
      },
    };
    const tracker = createFullscreenTracker({
      window: () => win as never,
      relayout: () => undefined,
    });
    const tab = {
      id: 't1',
      wc: { executeJavaScript: () => Promise.resolve() },
    } as unknown as Tab;

    tracker.track(tab, true);
    tracker.sync();
    expect(full).toBe(true);
    expect(tracker.isAny()).toBe(true);

    tracker.track(tab, false);
    tracker.sync();
    expect(full).toBe(false);
    expect(tracker.isAny()).toBe(false);
  });

  it('uses the supplied presentation callback instead of toggling the browser window', () => {
    let full = false;
    let entered: Tab | null = null;
    let exits = 0;
    const win = {
      isDestroyed: () => false,
      isFullScreen: () => full,
      setFullScreen: (value: boolean) => {
        full = value;
      },
    };
    const tracker = createFullscreenTracker({
      window: () => win as never,
      relayout: () => undefined,
      enter: (tab) => {
        entered = tab;
      },
      exit: () => {
        exits += 1;
      },
    });
    const tab = {
      id: 't-dedicated',
      wc: { executeJavaScript: () => Promise.resolve() },
    } as unknown as Tab;

    tracker.track(tab, true);
    tracker.sync();
    expect(entered).toBe(tab);
    expect(full).toBe(false);

    // Reconciliation is idempotent while the page remains fullscreen.
    tracker.sync();
    expect(entered).toBe(tab);

    tracker.track(tab, false);
    tracker.sync();
    expect(exits).toBe(1);
    expect(tracker.isAny()).toBe(false);
  });
});
