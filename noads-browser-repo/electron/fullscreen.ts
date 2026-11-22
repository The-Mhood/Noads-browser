/**
 * Fullscreen tracking for page-owned HTML5 fullscreen elements.
 *
 * The main process supplies `enter`/`exit` callbacks for the product's desired
 * player presentation. The current product callback keeps the page in the
 * existing browser window so the Noads heading, tabs, and navigation remain
 * available. The fallback path retains the old OS-window behavior for
 * deterministic unit tests and platforms without a custom presentation.
 */
import type { BrowserWindow } from 'electron';
import type { Tab } from './tabs';

export interface FullscreenTracker {
  /** A tab entered/left HTML5 fullscreen. */
  track(tab: Tab, entered: boolean): void;
  /** Reconcile the fullscreen presentation with tracked page state. */
  sync(): void;
  /** Force every tracked page out of HTML5 fullscreen. */
  forceExit(): void;
  /** True when any tracked tab is in HTML5 fullscreen. */
  isAny(): boolean;
}

export interface FullscreenDeps {
  /** The normal browser window; used by the fallback presentation. */
  window: () => BrowserWindow | null;
  /** Relayout the page/chrome after a state change. */
  relayout: () => void;
  /** Optional product-specific presentation hooks. */
  enter?: (tab: Tab) => void;
  exit?: () => void;
}

/** Statement form: never returns the (possibly pending) exit promise. */
const EXIT_JS =
  'if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); }';

export function createFullscreenTracker(deps: FullscreenDeps): FullscreenTracker {
  const tabs = new Map<string, Tab>();
  /** True only when the page fullscreen presentation was entered by this tracker. */
  let presentationActive = false;
  /** True only after an HTML5 fullscreen element has left. */
  let htmlExitRequested = false;

  function forcePagesOut(): void {
    for (const tab of tabs.values()) {
      // A tab in this map may have just been destroyed (closing a fullscreen
      // tab); its WebContents is gone, so guard before touching it.
      try {
        const wc = tab.wc as Electron.WebContents | undefined;
        if (wc && !wc.isDestroyed()) {
          wc.executeJavaScript(EXIT_JS).catch(() => {
            /* tab going away; its destroyed handler reconciles */
          });
        }
      } catch {
        /* destroyed view */
      }
    }
    tabs.clear();
    htmlExitRequested = false;
  }

  function enterPresentation(tab: Tab, win: BrowserWindow): void {
    if (deps.enter) {
      deps.enter(tab);
      return;
    }
    if (!win.isFullScreen()) {
      // Fallback for platforms/tests without a product-specific presenter.
      win.setFullScreen(true);
    }
  }

  function exitPresentation(win: BrowserWindow): void {
    if (deps.exit) {
      deps.exit();
      return;
    }
    if (win.isFullScreen()) win.setFullScreen(false);
  }

  return {
    track(tab, entered) {
      if (entered) {
        tabs.set(tab.id, tab);
        htmlExitRequested = false;
      } else if (tabs.delete(tab.id) && tabs.size === 0) {
        // Ordinary macOS green-button fullscreen never enters this branch:
        // only a page fullscreen report can set htmlExitRequested.
        htmlExitRequested = true;
      }
    },

    isAny() {
      return tabs.size > 0;
    },

    sync() {
      const win = deps.window();
      if (!win || win.isDestroyed()) return;
      console.log(`[fullscreen] sync tabs=${tabs.size} presentationActive=${presentationActive} winFullscreen=${win.isFullScreen()}`);

      if (tabs.size > 0) {
        htmlExitRequested = false;
        if (!presentationActive) {
          const tab = tabs.values().next().value as Tab | undefined;
          if (tab) {
            presentationActive = true;
            enterPresentation(tab, win);
          }
        }
      } else if (htmlExitRequested) {
        htmlExitRequested = false;
        if (presentationActive) {
          presentationActive = false;
          exitPresentation(win);
        }
      }
      deps.relayout();
    },

    forceExit() {
      forcePagesOut();
      const win = deps.window();
      if (!win || win.isDestroyed()) return;

      if (presentationActive) {
        presentationActive = false;
        exitPresentation(win);
      } else if (win.isFullScreen()) {
        // Esc from the browser UI still exits ordinary OS fullscreen.
        win.setFullScreen(false);
      }
      deps.relayout();
    },
  };
}
