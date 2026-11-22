/**
 * Tab engine: each Tab owns a WebContentsView. Only the active tab's view is
 * attached to the window (via the host); inactive tabs stay alive with their
 * history intact. Home and error are per-tab "modes" — home never touches
 * the webContents (so Back works from home), and the error screen is
 * rendered by the React layer while the view is detached.
 *
 * Product behaviors wired in here:
 *  - popup policy: same-site new-window navigates in-tab, else denied+counted
 *  - unreachable URLs (DNS/connection failures) auto-redirect to a Google
 *    search of the failed address — armed at most once per attempt and
 *    never on search-result URLs, so it cannot loop
 *  - long-press injection for copy/download (electron/longpress.ts)
 */
import { WebContentsView, webFrameMain } from 'electron';
import type {
  BrowserError,
  NavigationTarget,
  Settings,
  TabState,
} from '../shared/types';
import { HOME_URL } from '../shared/constants';
import { displayFor, resolveNavigation } from './normalize';
import { getProvider } from '../shared/searchProviders';
import type { AdBlocker } from './session';
import { buildCosmeticCSS, buildPopupFilterJS } from './cosmeticFilters';
import { FULLSCREEN_BRIDGE_INJECT } from './fullscreenBridge';
import { LONGPRESS_INJECT } from './longpress';

/** Shortcuts intercepted at the page level (before the page sees them). */
export type BrowserShortcut =
  | 'find'
  | 'reload'
  | 'newTab'
  | 'closeTab'
  | 'focusAddress'
  | 'bookmark'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'escape';

export interface TabDeps {
  preloadPath: string;
  blocker: AdBlocker;
  getSettings: () => Settings;
  /** Push the consolidated state to the UI. */
  onBroadcast: () => void;
  /** Persist the current tab URL list (manager-managed). */
  onPersistTabs: () => void;
  /** Surface a transient message in the UI. */
  onNotice: (message: string) => void;
  /** Open a user-requested target=_blank/window-open URL as a browser tab. */
  onNewTab: (url: string) => void;
  /** Show the native context menu for a click inside this tab. */
  onContextMenu: (tab: Tab, params: Electron.ContextMenuParams) => void;
  /** A page element entered/left HTML5 fullscreen (e.g. a movie player). */
  onHtmlFullscreen: (tab: Tab, entered: boolean) => void;
  /** Record a settled page visit into browsing history. */
  onHistory: (url: string, title: string) => void;
  /** Chromium found-in-page result for the find bar. */
  onFoundInPage: (tab: Tab, result: Electron.FoundInPageResult) => void;
  /** Browser-level shortcut pressed while the page has focus. */
  onShortcut: (tab: Tab, name: BrowserShortcut) => void;
  /** Current cosmetic-filtering policy + effective block host list. */
  getCosmeticFilter: (hostname: string) => { enabled: boolean; hosts: string[] };
  /** User activity inside this tab's page (drives chrome auto-hide). */
  onActivity: (tab: Tab) => void;
}

export interface ViewHost {
  attach(view: WebContentsView): void;
  detach(view: WebContentsView): void;
}

/** Chromium codes meaning "the address cannot be reached right now".
 *  (Not blocked-by-client, not aborted, not crashed.) */
const UNREACHABLE_CODES = new Set([
  -104, // ERR_CONNECTION_RESET
  -105, // ERR_NAME_NOT_RESOLVED
  -110, // ERR_ADDRESS_UNREACHABLE
  -111, // ERR_CONNECTION_REFUSED
  -112, // ERR_CONNECTION_TIMED_OUT
]);

/** Product decision: the auto-search for unreachable addresses uses Google. */
const AUTO_SEARCH_PROVIDER = 'google';

function isSearchResultsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'www.google.com' && u.pathname === '/search';
  } catch {
    return false;
  }
}

function webUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function sameSiteHost(left: string, right: string): boolean {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

export class Tab {
  readonly id: string;
  readonly view: WebContentsView;
  mode: 'home' | 'web' | 'error' = 'home';
  /** Pinned tabs stay leftmost and survive "close others". */
  pinned = false;
  /** True while this tab is playing media (reported by Chromium). */
  audible = false;
  /** True when the user muted this tab. */
  muted = false;
  /** Requests the blocker stopped on this tab (attributed by webContents id). */
  blockedCount = 0;

  private error: BrowserError | null = null;
  /** Best-known favicon URL for the current page. */
  private favicon = '';
  /** Display text for the in-flight navigation (settles on did-navigate). */
  private pendingDisplay: string | null = null;
  /** Set for search navigations; kept until the next non-search navigation. */
  private searchQuery: string | null = null;
  /** True while the auto-search redirect is in flight (loop guard). */
  private autoSearchArmed = false;
  /** Set while this tab has an HTML5 fullscreen element (movie, map…). */
  private htmlFullscreen = false;
  /** Trusted page gestures used to distinguish target=_blank links from ad popups. */
  private lastUserGestureAt = 0;
  private recentUserLinks: Array<{ url: string; at: number }> = [];

  constructor(index: number, private readonly deps: TabDeps) {
    this.id = `t${index}`;
    this.view = new WebContentsView({
      webPreferences: {
        preload: deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.wireEvents();
  }

  get wc(): Electron.WebContents {
    return this.view.webContents;
  }

  /** Reconcile fullscreen reports from Chromium events and page preload. */
  setHtmlFullscreen(entered: boolean): void {
    if (this.htmlFullscreen === entered) return;
    this.htmlFullscreen = entered;
    this.deps.onHtmlFullscreen(this, entered);
  }

  /** Record a trusted page gesture without trusting any page-supplied URL. */
  noteUserGesture(): void {
    this.lastUserGestureAt = Date.now();
  }

  /** Record a validated anchor destination seen during a trusted gesture. */
  noteUserLink(url: string): void {
    const parsed = webUrl(url);
    if (!parsed) return;
    const at = Date.now();
    this.lastUserGestureAt = at;
    this.recentUserLinks = [
      ...this.recentUserLinks.filter((entry) => at - entry.at < 2500),
      { url: parsed.toString(), at },
    ].slice(-8);
  }

  /**
   * Only allow a child tab when it matches a real link the user just pressed,
   * or is a same-site destination opened by a recent trusted gesture. Ad
   * scripts commonly call window.open during that same click with a different
   * cross-site URL; those requests are denied and counted instead.
   */
  allowUserOpenedWindow(url: string): boolean {
    const parsed = webUrl(url);
    if (!parsed) return false;
    const now = Date.now();
    this.recentUserLinks = this.recentUserLinks.filter((entry) => now - entry.at < 2500);
    const exactIndex = this.recentUserLinks.findIndex((entry) => entry.url === parsed.toString());
    if (exactIndex !== -1) {
      this.recentUserLinks.splice(exactIndex, 1);
      return true;
    }

    if (now - this.lastUserGestureAt > 900) return false;
    const current = webUrl(this.wc.getURL());
    return current !== null && sameSiteHost(current.hostname, parsed.hostname);
  }

  private wireEvents(): void {
    const wc = this.wc;

    wc.on('did-start-loading', () => {
      this.error = null;
      if (this.mode !== 'web') this.mode = 'web';
      this.deps.onBroadcast();
    });

    wc.on('did-stop-loading', () => {
      const url = wc.getURL();
      if (/^https?:/i.test(url)) this.deps.onHistory(url, wc.getTitle());
      this.deps.onBroadcast();
    });

    wc.on('found-in-page', (_e, result) => {
      this.deps.onFoundInPage(this, result);
    });

    // Any mouse/keyboard/touch input in the page counts as user activity
    // for the chrome auto-hide timer.
    wc.on('input-event', () => {
      this.deps.onActivity(this);
    });

    // Browser shortcuts while the PAGE has focus. The chrome renderer only
    // sees keydown when the chrome itself is focused, so navigation-level
    // shortcuts must be intercepted here, before the page consumes them.
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const mod = process.platform === 'darwin' ? input.meta : input.control;
      const key = (input.key ?? '').toLowerCase();
      let shortcut: BrowserShortcut | null = null;
      if (mod && !input.shift && !input.alt) {
        if (key === 'f') shortcut = 'find';
        else if (key === 'r') shortcut = 'reload';
        else if (key === 't') shortcut = 'newTab';
        else if (key === 'w') shortcut = 'closeTab';
        else if (key === 'l') shortcut = 'focusAddress';
        else if (key === 'd') shortcut = 'bookmark';
        else if (key === '=' || key === '+') shortcut = 'zoomIn';
        else if (key === '-') shortcut = 'zoomOut';
        else if (key === '0') shortcut = 'zoomReset';
      } else if (key === 'escape' && !mod) {
        shortcut = 'escape';
      }
      if (shortcut === null) return;
      if (shortcut === 'escape') {
        // Never consume Esc: pages and players rely on it (modals, PiP,
        // fullscreen). We only mirror it so an open find bar closes too.
        this.deps.onShortcut(this, 'escape');
        return;
      }
      event.preventDefault();
      this.deps.onShortcut(this, shortcut);
    });

    wc.on('did-navigate', (_e, url) => {
      if (/^https?:/i.test(url)) {
        this.pendingDisplay = null;
        this.autoSearchArmed = false;
        this.deps.onPersistTabs();
      }
      this.deps.onBroadcast();
    });

    wc.on('did-navigate-in-page', (_e, url) => {
      if (/^https?:/i.test(url)) this.deps.onPersistTabs();
      this.deps.onBroadcast();
    });

    wc.on('page-title-updated', () => this.deps.onBroadcast());

    // Favicons: keep the freshest icon Chromium reports for the page.
    wc.on('page-favicon-updated', (_e, favicons) => {
      const next = favicons.find((f) => typeof f === 'string' && f.startsWith('http')) ?? '';
      if (next && next !== this.favicon) {
        this.favicon = next;
        this.deps.onBroadcast();
      }
    });

    // Media activity drives the tab-strip audio indicator.
    wc.on('media-started-playing', () => {
      if (!this.audible) {
        this.audible = true;
        this.deps.onBroadcast();
      }
    });
    wc.on('media-paused', () => {
      if (this.audible) {
        this.audible = false;
        this.deps.onBroadcast();
      }
    });

    // Long-press copy/download: inject once per fresh main-frame document
    // (Electron ≥32 emits dom-ready for the main frame only; the snippet is
    // idempotent, so a double-fire is harmless).
    wc.on('dom-ready', () => {
      wc.executeJavaScript(LONGPRESS_INJECT).catch(() => {
        /* frame navigated away mid-injection; next dom-ready retries */
      });
      wc.executeJavaScript(FULLSCREEN_BRIDGE_INJECT).catch((err: unknown) => {
        if (process.env.NOADS_FULLSCREEN_DEBUG === '1') {
          console.error('[fullscreen] bridge injection failed:', err);
        }
        /* frame navigated away mid-injection; next dom-ready retries */
      });

      // Cosmetic (in-page) ad filtering: the maintained engine injects its
      // comprehensive rules through its own preload; this app adds a small
      // supplemental popup scan for Electron-specific behavior.
      let host = '';
      try {
        host = new URL(wc.getURL()).hostname;
      } catch {
        /* non-http(s) URL: generic selectors only */
      }
      const cosmetic = this.deps.getCosmeticFilter(host);
      if (cosmetic.enabled) {
        const css = buildCosmeticCSS(host);
        if (css) {
          wc.insertCSS(css, { cssOrigin: 'user' }).catch((err: unknown) =>
            console.error('[cosmetic] supplemental CSS injection failed:', err),
          );
        }
        wc.executeJavaScript(
          buildPopupFilterJS(cosmetic.hosts, this.deps.getSettings().youtubeCompat),
        ).catch((err: unknown) =>
          console.error('[cosmetic] supplemental popup filter injection failed:', err),
        );
      }
    });

    // Player controls are often rendered inside a cross-origin iframe. The
    // normal dom-ready hook targets the top document, so also install the
    // same guarded bridge in every finished frame. An iframe without the
    // page preload relays its signal to the top frame via postMessage.
    wc.on('did-frame-finish-load', (_event, _isMainFrame, frameProcessId, frameRoutingId) => {
      let frame: Electron.WebFrameMain | undefined;
      try {
        frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
      } catch {
        frame = undefined;
      }
      if (!frame) return;
      void frame.executeJavaScript(FULLSCREEN_BRIDGE_INJECT).catch((err: unknown) => {
        if (process.env.NOADS_FULLSCREEN_DEBUG === '1') {
          console.error('[fullscreen] frame bridge injection failed:', err);
        }
      });
    });

    wc.on(
      'did-fail-load',
      (_e, code, description, validatedUrl, isMainFrame) => {
        if (!isMainFrame) return; // subresource failures are counted, not surfaced
        const blocked = this.deps.blocker.wasRecentlyBlocked(validatedUrl);

        if (code === -3 && !blocked) {
          // ERR_ABORTED: user pressed Stop, or a newer navigation superseded
          // this one. Not an error — do not surface it.
          this.deps.onBroadcast();
          return;
        }

        // Product feature: unreachable address → automatic Google search of
        // it. Guards: never for blocked pages, never while a previous
        // auto-search is in flight, never for search-result pages.
        if (
          !blocked &&
          UNREACHABLE_CODES.has(code) &&
          !this.autoSearchArmed &&
          !isSearchResultsUrl(validatedUrl)
        ) {
          this.autoSearchArmed = true;
          const query = displayFor(validatedUrl);
          this.deps.onNotice(
            `“${query}” wasn’t reachable — showing Google search results instead.`,
          );
          this.error = null;
          this.mode = 'web';
          this.searchQuery = query;
          this.pendingDisplay = query;
          // did-fail-load drives the visible error/search behavior. Consume
          // the loadURL promise as well so a superseded navigation cannot
          // surface as an unhandled Node rejection.
          void wc.loadURL(getProvider(AUTO_SEARCH_PROVIDER).buildUrl(query)).catch(() => {});
          return;
        }

        this.error = {
          code,
          message: blocked
            ? 'This address is blocked by your ad-blocker settings.'
            : description || `The page failed to load (Chromium error ${code}).`,
          url: validatedUrl,
          blocked,
          crashed: false,
        };
        this.mode = 'error';
        this.deps.onBroadcast();
      },
    );

    wc.on('render-process-gone', (_e, details) => {
      this.error = {
        code: -999,
        message:
          details.reason === 'crashed'
            ? 'The page crashed and was shut down by the browser.'
            : `The page's renderer process exited (${details.reason}).`,
        url: wc.getURL(),
        blocked: false,
        crashed: true,
      };
      this.mode = 'error';
      this.deps.onBroadcast();
    });

    // Two-finger click / right-click: native context menu built in main.
    // Only the attached (active) view can receive input, so `tab` is always
    // the tab the user clicked.
    wc.on('context-menu', (_e, params) => {
      this.deps.onContextMenu(this, params);
    });

    // HTML5 fullscreen (movie players, maps…). A WebContentsView cannot make
    // the OS window fullscreen by itself — main listens to these and drives
    // the window + view layout (see electron/main.ts syncFullscreen).
    wc.on('enter-html-full-screen', () => this.setHtmlFullscreen(true));
    wc.on('leave-html-full-screen', () => this.setHtmlFullscreen(false));
    // If the tab is destroyed while still in HTML5 fullscreen, report the
    // exit so the window is not left stuck fullscreen.
    wc.on('destroyed', () => {
      if (this.htmlFullscreen) this.setHtmlFullscreen(false);
    });

    // A genuine user link is opened as a browser tab rather than replacing
    // the current page. The requested URL must match the trusted link seen by
    // the page preload, or be same-site during the same gesture. This prevents
    // an ad script from opening a second cross-site tab alongside the intended
    // navigation.
    wc.setWindowOpenHandler(({ url, disposition }) => {
      const next = webUrl(url);
      const isTabGesture = disposition === 'foreground-tab'
        || disposition === 'background-tab'
        || disposition === 'new-window';
      if (next && isTabGesture && this.allowUserOpenedWindow(next.toString())) {
        this.deps.onNewTab(next.toString());
      } else {
        this.deps.blocker.recordPopup(url);
      }
      return { action: 'deny' as const };
    });
  }

  /** Increment this tab's blocked-request counter (called by main). The
   *  blocker's throttled change callback pushes the update to the UI. */
  noteBlocked(): void {
    this.blockedCount += 1;
  }

  /** Toggle tab audio mute; returns the new muted state. */
  toggleMute(): boolean {
    this.muted = !this.muted;
    this.wc.setAudioMuted(this.muted);
    this.deps.onBroadcast();
    return this.muted;
  }

  /** Navigate this tab. HOME_URL = internal home (never hits the network). */
  navigate(url: string, searchQuery: string | null): void {
    if (url === HOME_URL) {
      this.mode = 'home';
      this.error = null;
      this.pendingDisplay = '';
      this.deps.onBroadcast();
      return;
    }
    this.mode = 'web';
    this.error = null;
    this.searchQuery = searchQuery;
    this.pendingDisplay = searchQuery ?? displayFor(url);
    void this.wc.loadURL(url).catch(() => {
      /* did-fail-load reports the navigation result to the UI */
    });
  }

  get currentUrl(): string {
    const u = this.wc.getURL();
    return u === '' ? HOME_URL : u;
  }

  /** What this tab contributes to the persisted session ('' = home). */
  get persistedUrl(): string {
    return this.mode === 'web' && /^https?:/i.test(this.currentUrl)
      ? this.currentUrl
      : '';
  }

  toState(): TabState {
    const wc = this.wc;
    const url = this.currentUrl;
    return {
      id: this.id,
      url,
      displayUrl: this.error
        ? displayFor(this.error.url)
        : this.pendingDisplay ?? this.searchQuery ?? displayFor(url),
      title: this.error
        ? 'Page not available'
        : wc.getTitle() || (this.mode === 'home' ? 'New Tab' : 'Loading…'),
      isLoading: wc.isLoading() && !this.error,
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
      favicon: this.favicon,
      blockedCount: this.blockedCount,
      pinned: this.pinned,
      audible: this.audible,
      muted: this.muted,
      error: this.error,
    };
  }

  destroy(): void {
    // Electron ≥36: WebContents.destroy() was renamed close().
    this.wc.close();
  }
}

export class TabManager {
  private tabs: Tab[] = [];
  private activeId: string | null = null;
  private attached: WebContentsView | null = null;
  private nextIndex = 1;

  constructor(
    private readonly deps: TabDeps,
    private readonly host: ViewHost,
  ) {}

  get active(): Tab {
    return this.tabs.find((t) => t.id === this.activeId) ?? this.tabs[0];
  }

  get attachedView(): WebContentsView | null {
    return this.attached;
  }

  get all(): readonly Tab[] {
    return this.tabs;
  }

  /**
   * Attach/detach bookkeeping. The WINDOW-owning side (main.ts) calls these
   * from its sync loop, so attachment always matches the active tab's mode —
   * including mode changes on the already-active tab (home→web, error→retry).
   */
  attach(view: WebContentsView): void {
    if (this.attached === view) return;
    if (this.attached) this.host.detach(this.attached);
    this.attached = view;
    this.host.attach(view);
  }

  detach(view?: WebContentsView): void {
    if (view !== undefined && this.attached !== view) return;
    if (this.attached) this.host.detach(this.attached);
    this.attached = null;
  }

  createTab(url: string = HOME_URL): Tab {
    const tab = new Tab(this.nextIndex++, this.deps);
    this.tabs.push(tab);
    if (url !== HOME_URL) tab.navigate(url, null);
    this.activate(tab.id);
    this.persist();
    return tab;
  }

  /** Open a copy of a tab next to the original. */
  duplicateTab(id: string): Tab | null {
    const src = this.tabs.find((t) => t.id === id);
    if (!src) return null;
    const copy = this.createTab(src.currentUrl === HOME_URL ? HOME_URL : src.currentUrl);
    // Move the duplicate next to its source instead of leaving it last.
    const from = this.tabs.indexOf(copy);
    const to = this.tabs.indexOf(src) + 1;
    this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, copy);
    this.deps.onBroadcast();
    return copy;
  }

  togglePin(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    tab.pinned = !tab.pinned;
    // Keep pinned tabs grouped at the front, preserving relative order.
    const pinned = this.tabs.filter((t) => t.pinned);
    const rest = this.tabs.filter((t) => !t.pinned);
    this.tabs = [...pinned, ...rest];
    this.deps.onBroadcast();
  }

  toggleMute(id: string): void {
    this.tabs.find((t) => t.id === id)?.toggleMute();
  }

  /** Close every tab except `id`; pinned tabs are kept (browser convention). */
  closeOthers(id: string): void {
    const closing = this.tabs.filter((t) => t.id !== id && !t.pinned);
    for (const tab of closing) {
      this.tabs.splice(this.tabs.indexOf(tab), 1);
      this.detach(tab.view);
      tab.destroy();
    }
    if (!this.tabs.some((t) => t.id === this.activeId)) {
      this.activeId = null;
      this.activate(id);
    }
    this.persist();
    this.deps.onBroadcast();
  }

  /** Drag-reorder: move tab `id` to `index` (clamped). */
  moveTab(id: string, index: number): void {
    const from = this.tabs.findIndex((t) => t.id === id);
    if (from === -1) return;
    const to = Math.max(0, Math.min(index, this.tabs.length - 1));
    if (to === from) return;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, tab);
    this.deps.onBroadcast();
  }

  /** Attribute a blocked request (by WebContents id) to its tab. */
  noteBlockedForWebContents(webContentsId: number | undefined): void {
    if (webContentsId === undefined) return;
    const tab = this.tabs.find((t) => t.wc.id === webContentsId);
    tab?.noteBlocked();
  }

  /** Find-in-page on the active tab. */
  findInActive(text: string, forward: boolean, findNext: boolean): void {
    const wc = this.active.wc;
    if (text === '') {
      wc.stopFindInPage('clearSelection');
      return;
    }
    wc.findInPage(text, { forward, findNext });
  }

  stopFindInActive(): void {
    this.active.wc.stopFindInPage('clearSelection');
  }

  /** Zoom the active tab by one step; returns the new factor (1 = 100%). */
  zoomActive(direction: 'in' | 'out' | 'reset'): number {
    const wc = this.active.wc;
    const next =
      direction === 'reset' ? 1 : wc.getZoomFactor() * (direction === 'in' ? 1.2 : 1 / 1.2);
    const clamped = Math.min(5, Math.max(0.25, next));
    wc.setZoomFactor(clamped);
    return clamped;
  }

  activate(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || id === this.activeId) return;
    this.activeId = id;
    this.deps.onBroadcast(); // main's sync loop swaps the attached view
  }

  /**
   * Close a tab. Closing the last tab spawns a fresh home tab — the app
   * never terminates by tab-closing (documented product behavior).
   */
  close(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const [tab] = this.tabs.splice(idx, 1);
    this.detach(tab.view); // remove from the window before destroying
    tab.destroy();

    if (this.tabs.length === 0) {
      const fresh = new Tab(this.nextIndex++, this.deps);
      this.tabs.push(fresh);
      this.activeId = null;
      this.activate(fresh.id);
    } else if (id === this.activeId) {
      this.activate(this.tabs[Math.min(idx, this.tabs.length - 1)].id);
    }
    this.persist();
  }

  navigateActive(raw: string): NavigationTarget {
    const target = resolveNavigation(raw, this.deps.getSettings().searchProvider);
    if (target.kind === 'url') {
      this.active.navigate(target.url, target.searchQuery ?? null);
    }
    return target;
  }

  back(): void {
    this.active.wc.goBack();
  }

  forward(): void {
    this.active.wc.goForward();
  }

  reload(): void {
    this.active.wc.reload();
  }

  stop(): void {
    this.active.wc.stop();
  }

  collect(): TabState[] {
    return this.tabs.map((t) => t.toState());
  }

  getActiveId(): string {
    return this.active.id;
  }

  private persist(): void {
    this.deps.onPersistTabs();
  }
}
