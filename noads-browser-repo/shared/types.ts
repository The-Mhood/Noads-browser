/**
 * Shared contract between the Electron main process ("backend") and the
 * React renderer. This file must stay dependency-free — it is imported by
 * both the esbuild-bundled main process and the Vite-bundled renderer.
 */

/** A failed top-frame load, surfaced to the UI. */
export interface BrowserError {
  /** Chromium net error code (-3 = aborted, -105 = DNS failure, etc.) */
  code: number;
  /** Human-readable description shown in the error screen. */
  message: string;
  /** The URL that failed (always http/https, never internal). */
  url: string;
  /** True when the failure is due to the ad blocker. */
  blocked: boolean;
  /** True when the renderer process crashed. */
  crashed: boolean;
}

/** Per-tab snapshot (what the UI needs to render one tab). */
export interface TabState {
  id: string;
  /** Raw current URL (HOME_URL when the tab is at home). */
  url: string;
  /** What the address bar shows for this tab ('' = home, searches show the query). */
  displayUrl: string;
  title: string;
  /** Best-known favicon URL for the current page ('' = none yet). */
  favicon: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Requests blocked on this tab since it was created. */
  blockedCount: number;
  /** Pinned tabs stay leftmost and cannot be closed by "close others". */
  pinned: boolean;
  /** True while the tab is playing audio/video media. */
  audible: boolean;
  /** True when the user muted this tab's audio. */
  muted: boolean;
  error: BrowserError | null;
}

/** One recent blocked request shown by the shield status popover. */
export interface BlockedEntry {
  /** Hostname only; full request URLs are never sent to the renderer. */
  host: string;
  /** Epoch milliseconds, owned by the main process. */
  at: number;
}

/**
 * Where the active network filter engine came from. 'custom-only' means the
 * maintained engine could not be loaded at all and only bundled/custom
 * domain rules are active (degraded mode — always paired with a warning).
 */
export type FilterEngineSource =
  | 'network'
  | 'cache'
  | 'stale-cache'
  | 'bundled'
  | 'custom-only';

/** Live status of the maintained filter engine, for the shield dashboard. */
export interface FilterEngineStatus {
  source: FilterEngineSource;
  /** Epoch ms when the active lists were generated, if known. */
  updatedAt: number | null;
  /** True while a manual/background refresh is in flight. */
  updating: boolean;
}

/** Find-in-page state for the active tab. */
export interface FindState {
  /** True while the find bar is open (drives the UI, owned by renderer). */
  open: boolean;
  /** Last searched text. */
  text: string;
  /** Total matches reported by Chromium for the last search (0 = none yet). */
  matches: number;
  /** 1-based index of the active match (0 = none yet). */
  activeMatch: number;
}

/** A persisted browsing-history entry. */
export interface HistoryEntry {
  url: string;
  title: string;
  /** Epoch ms of the most recent visit. */
  at: number;
}

/** Ephemeral stats owned by the main process; reset on app start. */
export interface BlockState {
  enabled: boolean;
  /** Number of blocked network requests since app start. */
  count: number;
  /** Host of the most recently blocked request, if any. */
  lastBlocked: string | null;
  /** Recent blocked hosts, newest first, bounded by the main process. */
  recentBlocked: BlockedEntry[];
  /** Number of popup/new-window attempts denied since app start. */
  popupsBlocked: number;
  /** URL of the most recently denied popup, if any. */
  lastPopup: string | null;
  /** Non-null when blocking is degraded (e.g. bundled list failed to load). */
  warning: string | null;
}

/** Transient user-facing message (copied link, saved file, auto-search…). */
export interface Notice {
  message: string;
  /** Epoch ms when it was set; the UI auto-hides it after a few seconds. */
  at: number;
}

/**
 * One consolidated snapshot of everything the UI needs, pushed from main on
 * every relevant event. The renderer keeps a copy in its reducer — this is
 * the single action that mutates "what the browser is doing".
 */
export interface BrowserState {
  activeTabId: string;
  tabs: TabState[];
  blocks: BlockState;
  /** Maintained filter-engine provenance for the shield dashboard. */
  engine: FilterEngineStatus;
  /** Find-in-page state for the active tab (owned by main). */
  find: FindState;
  notice: Notice | null;
  /** URLs from the previous session waiting for an explicit restore choice. */
  restoreTabs: string[];
  /** True while the chrome (tabs + toolbar) is auto-hidden. */
  chromeHidden: boolean;
}

/** Which native renderer is currently used for a chrome popover. */
export type PopoverKind = 'settings' | 'blocker' | 'history' | 'find';

/** A saved bookmark (persisted with settings). */
export interface Bookmark {
  id: string;
  title: string;
  /** Always a normalized http(s) URL. */
  url: string;
}

/**
 * Persisted user settings. Treated as untrusted input when read from disk
 * or IPC: always validated before use (see electron/settings.ts).
 */
export interface Settings {
  blockEnabled: boolean;
  /**
   * In-page (cosmetic) filtering: hides rendered ad elements and ad-iframe
   * popups inside pages (e.g. YouTube's in-player ad surface). Only takes
   * effect while blockEnabled is true.
   */
  cosmeticFiltering: boolean;
  /** User-added always-block domains (on top of the bundled list). */
  blockDomains: string[];
  /** User-added allowlist: never blocked even if in the blocklist. */
  allowDomains: string[];
  /** Restored tab URLs: '' = home tab, http(s) URL otherwise (max 16).
   *  Migrated from the legacy single lastUrl field on load. */
  lastTabs: string[];
  /** Saved bookmarks (max 100). */
  bookmarks: Bookmark[];
  /** Search provider id from shared/searchProviders.ts ('duckduckgo' default). */
  searchProvider: string;
  /** Hide the tab strip and toolbar after a period of inactivity on web
   *  pages; any mouse/keyboard activity brings them back. */
  autoHideChrome: boolean;
}

/** What the address bar resolved to after parsing untrusted user input. */
export type NavigationTarget =
  | {
      kind: 'url';
      url: string;
      /** Present when the URL is a search result page; the query to display. */
      searchQuery?: string;
    }
  | { kind: 'error'; message: string };

/** Uniform IPC result: errors are values, never swallowed. */
export type IpcResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; message: string };
