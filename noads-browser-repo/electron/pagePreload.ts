/**
 * Preload for web PAGE webContents (untrusted content). Deliberately tiny:
 * one exposed function, string-in / string-out, no Node, no ipcRenderer
 * access. The injected long-press script (electron/longpress.ts) uses it to
 * report completed long-presses to the main process, which re-validates
 * every payload.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('__adf', {
  report: (payload: string): void => {
    ipcRenderer.send('page:longpress', payload);
  },
  /** Ask main to synthesize a validated click on a visible YouTube control. */
  reportYoutubeControl: (payload: string): void => {
    ipcRenderer.send('page:youtube-control', payload);
  },
  /** Tell main which real page link the user is pressing. */
  reportUserLink: (url: string): void => {
    if (typeof url === 'string') ipcRenderer.send('page:user-link', url);
  },
  /** Tell main that a trusted user gesture just occurred. */
  reportUserGesture: (): void => {
    ipcRenderer.send('page:user-gesture');
  },
  reportFullscreenState: (entered: boolean): void => {
    if (typeof entered === 'boolean') ipcRenderer.send('page:fullscreen', entered);
  },
});

// Some players use the Fullscreen API without consistently emitting
// Electron's enter-html-full-screen WebContents event. Mirror both standard
// and WebKit fullscreen changes to main as a fallback. A short poll is also
// intentional: macOS video fullscreen (`webkitEnterFullscreen`) can update
// the media element's state without dispatching a document-level event.
// This file is typechecked in the Node config, so keep the tiny DOM shape
// local instead of importing DOM typings.
type PageVideoLike = {
  webkitDisplayingFullscreen?: boolean;
};
type PageElementLike = {
  tagName?: string;
  parentElement?: PageElementLike | null;
  getAttribute(name: string): string | null;
};
type PageEventLike = {
  isTrusted?: boolean;
  target?: PageElementLike | null;
};
type PageDocumentLike = {
  fullscreenElement?: unknown;
  webkitFullscreenElement?: unknown;
  querySelector(selector: string): PageVideoLike | null;
  addEventListener(type: string, listener: (event?: unknown) => void, capture?: boolean): void;
};
const pageDocument = (globalThis as unknown as { document: PageDocumentLike }).document;
let lastFullscreenState = false;
const readFullscreenState = (): boolean =>
  Boolean(
    pageDocument.fullscreenElement ??
      pageDocument.webkitFullscreenElement ??
      pageDocument.querySelector('video')?.webkitDisplayingFullscreen,
  );
const reportFullscreen = (): void => {
  const entered = readFullscreenState();
  if (entered === lastFullscreenState) return;
  lastFullscreenState = entered;
  ipcRenderer.send('page:fullscreen', entered);
};
pageDocument.addEventListener('fullscreenchange', reportFullscreen, true);
pageDocument.addEventListener('webkitfullscreenchange', reportFullscreen, true);

// Window-open handlers do not expose whether the request came from a real
// link click or from an ad script. Record trusted pointer/click gestures and
// the link under the pointer so main can allow the intended destination while
// denying unrelated ad popups opened by the same page.
const pageLocation = (globalThis as unknown as { location?: { href?: string } }).location;
const reportPageInteraction = (rawEvent?: unknown): void => {
  const event = rawEvent as PageEventLike | undefined;
  if (event?.isTrusted === false) return;
  ipcRenderer.send('page:user-gesture');

  let node = event?.target ?? null;
  for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement ?? null) {
    if ((node.tagName ?? '').toLowerCase() !== 'a') continue;
    const rawHref = node.getAttribute('href');
    if (!rawHref || !pageLocation?.href) return;
    try {
      const target = new URL(rawHref, pageLocation.href);
      if (target.protocol === 'http:' || target.protocol === 'https:') {
        ipcRenderer.send('page:user-link', target.toString());
      }
    } catch {
      // Invalid or non-web anchors are not window-open candidates.
    }
    return;
  }
};
pageDocument.addEventListener('pointerdown', reportPageInteraction, true);
pageDocument.addEventListener('mousedown', reportPageInteraction, true);
pageDocument.addEventListener('click', reportPageInteraction, true);
pageDocument.addEventListener('auxclick', reportPageInteraction, true);
setInterval(reportFullscreen, 250);
