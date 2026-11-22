/**
 * Network-level ad/tracker blocking + permission lockdown for the default
 * session. The maintained EasyList/uBlock-compatible ads, tracking, and
 * annoyances engine is the primary filter; the existing domain settings remain
 * a small, explicit policy layer
 * on top of it.
 */
import { session } from 'electron';
import * as fsSync from 'node:fs';
import type { ElectronBlocker } from '@ghostery/adblocker-electron';
import type { BlockedEntry, FilterEngineStatus, Settings } from '../shared/types';
import { makeMatcher, type DomainMatcher } from './blocklist';
import { loadBundledFilterEngine, loadFilterEngine } from './adblockEngine';
import { buildDomainFilterRules } from './adblockRules';
import { isSpotifyPlaybackRequest } from './mediaPolicy';
import { isYouTubeAdRequest, isYouTubePlaybackRequest } from './youtubePolicy';

export interface BlockerStats {
  count: number;
  lastBlocked: string | null;
  recentBlocked: BlockedEntry[];
  popupsBlocked: number;
  lastPopup: string | null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class AdBlocker {
  /** Non-null when maintained filters are unavailable or stale. */
  warning: string | null = null;

  stats: BlockerStats = {
    count: 0,
    lastBlocked: null,
    recentBlocked: [],
    popupsBlocked: 0,
    lastPopup: null,
  };

  private blockMatcher: DomainMatcher = makeMatcher([]);
  private allowMatcher: DomainMatcher = makeMatcher([]);
  private enabledFlag = false;
  private lastBlockedUrl: string | null = null;
  private lastBlockedAt = 0;
  private onChange: (() => void) | null = null;
  private engine: ElectronBlocker | null = null;
  private appliedCustomRules: string[] = [];
  private fallbackInstalled = false;
  private permissionHandlerInstalled = false;
  private userDataPath: string | null = null;
  private engineStatus: FilterEngineStatus = {
    source: 'custom-only',
    updatedAt: null,
    updating: false,
  };
  /** Notified (with the WebContents id) on every blocked request, so the
   *  main process can attribute it to a tab. */
  private onTabBlocked: ((webContentsId: number | undefined) => void) | null = null;

  /** Live provenance of the maintained filter engine. */
  get filterStatus(): FilterEngineStatus {
    return { ...this.engineStatus };
  }

  /** Register the per-tab attribution hook (called very frequently). */
  setOnTabBlocked(cb: ((webContentsId: number | undefined) => void) | null): void {
    this.onTabBlocked = cb;
  }

  private readonly fallbackRequestHandler = (
    details: Electron.OnBeforeRequestListenerDetails,
    callback: (response: Electron.CallbackResponse) => void,
  ): void => {
    try {
      if (!this.enabledFlag) {
        callback({});
        return;
      }
      if (isSpotifyPlaybackRequest(details) || isYouTubePlaybackRequest(details)) {
        callback({});
        return;
      }
      const host = hostOf(details.url);
      if (host === null || this.allowMatcher.test(host)) {
        callback({});
        return;
      }
      // Compatibility mode leaves first-party YouTube interception to the
      // maintained engine alone; some players stall when ad_break is cut.
      if (!this.getSettings().youtubeCompat && isYouTubeAdRequest(details)) {
        this.recordBlocked(details.url, host, details.webContentsId);
        callback({ cancel: true });
        return;
      }
      if (!this.blockMatcher.test(host)) {
        callback({});
        return;
      }
      this.recordBlocked(details.url, host, details.webContentsId);
      callback({ cancel: true });
    } catch (err) {
      // Never take down the request pipeline: log loudly, allow the request.
      console.error('[adblocker] fallback evaluation failed, allowing request:', details.url, err);
      callback({});
    }
  };

  private readonly logPath: string | null;

  constructor(
    private readonly getSettings: () => Settings,
    private readonly bundledDomains: string[],
    logPath: string | null = null,
  ) {
    this.logPath = logPath;
  }

  /** Append one diagnostic line to a userData log file so release builds
   *  (which have no console) can report what the blocker actually did. */
  private logDiag(...values: unknown[]): void {
    const line =
      `[${new Date().toISOString()}] ` +
      values.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ') +
      '\n';
    console.log('[adblocker]', ...values);
    if (this.logPath) {
      try {
        fsSync.appendFileSync(this.logPath, line);
      } catch {
        /* diagnostics must never break startup */
      }
    }
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  /** Called (throttled by the caller) to push fresh stats to the UI. */
  setOnChange(cb: (() => void) | null): void {
    this.onChange = cb;
  }

  /**
   * Install blocking before the asynchronous maintained-list refresh starts.
   * New macOS installations used to have a short (and, when offline, permanent)
   * window where pages loaded with no network filter at all. The bundled engine
   * and the domain fallback now cover that window; a fresh userData engine is
   * activated when the refresh completes.
   */
  async install(userDataPath: string, bundledEnginePath?: string): Promise<void> {
    this.refreshMatchers();
    this.installPermissionHandler();

    // Never leave a new installation unprotected while lists are downloading.
    this.installFallbackListener();
    this.setEnabled(this.getSettings().blockEnabled);
    this.userDataPath = userDataPath;
    this.logDiag(
      `install start; bundledDomains=${this.bundledDomains.length}`,
      bundledEnginePath ? `bundledEngine=${bundledEnginePath}` : 'no bundled engine path',
    );

    if (bundledEnginePath) {
      const bundledEngine = await loadBundledFilterEngine(bundledEnginePath);
      if (bundledEngine) {
        this.engineStatus = { source: 'bundled', updatedAt: null, updating: true };
        this.activateEngine(bundledEngine);
        this.logDiag('bundled engine activated');
      } else {
        this.logDiag('bundled engine FAILED to load (check adblocker.log)');
      }
    }

    try {
      const loaded = await loadFilterEngine(userDataPath);
      this.activateEngine(loaded.engine);
      this.warning = loaded.warning;
      this.engineStatus = {
        source: loaded.source,
        updatedAt: loaded.generatedAt,
        updating: false,
      };
      this.logDiag(`maintained engine active (source=${loaded.source})`);
      if (loaded.source === 'stale-cache' && this.warning === null) {
        this.warning = 'Maintained filters are being served from a stale cache.';
      }
    } catch (err) {
      this.engineStatus = { ...this.engineStatus, updating: false };
      if (this.engine) {
        // A bundled or stale engine is already active, so keep it serving
        // requests instead of dropping all filtering when refresh fails.
        this.warning =
          'Maintained filter lists could not be refreshed; the bundled filter snapshot remains active.';
      } else {
        this.engine = null;
        this.warning =
          'Maintained ad filters could not be loaded; only the bundled and custom domain rules are active.';
        this.engineStatus = { source: 'custom-only', updatedAt: null, updating: false };
        this.installFallbackListener();
        this.setEnabled(this.getSettings().blockEnabled);
      }
      console.error('[adblocker] maintained filter engine failed to load:', err);
      console.error('[adblocker] fallback details:', describeError(err));
      this.logDiag('maintained engine load FAILED:', describeError(err));
    }

    // Verify at startup whether session-level blocking is actually live, and
    // log it. This turns "ads are showing" reports into actionable data.
    try {
      const enabledInSession = this.engine
        ? this.engine.isBlockingEnabled(session.defaultSession)
        : false;
      this.logDiag(
        `startup: engine=${this.engine ? 'yes' : 'no'} blockingInSession=${enabledInSession} enabledFlag=${this.enabledFlag} fallbackInstalled=${this.fallbackInstalled} source=${this.engineStatus.source}`,
      );
    } catch (err) {
      this.logDiag('startup self-check failed:', describeError(err));
    }

    this.onChange?.();
  }

  /**
   * User-requested "update filters now": bypasses the weekly freshness check
   * and downloads the current maintained lists. Never removes protection
   * while updating — the current engine keeps serving until the new one is
   * ready. Resolves to the resulting status; on failure the previous engine
   * stays active and a warning explains what happened.
   */
  async forceUpdate(): Promise<FilterEngineStatus> {
    if (this.engineStatus.updating || !this.userDataPath) return this.filterStatus;
    this.engineStatus = { ...this.engineStatus, updating: true };
    this.onChange?.();
    try {
      const loaded = await loadFilterEngine(this.userDataPath, { force: true });
      this.activateEngine(loaded.engine);
      this.warning = loaded.warning;
      this.engineStatus = {
        source: loaded.source,
        updatedAt: loaded.generatedAt,
        updating: false,
      };
    } catch (err) {
      this.engineStatus = { ...this.engineStatus, updating: false };
      this.warning = `Filter update failed (${describeError(err)}); the previous lists remain active.`;
      console.error('[adblocker] manual filter update failed:', err);
    }
    this.onChange?.();
    return this.filterStatus;
  }

  /** (Re)build custom matchers and apply settings changes immediately. */
  refresh(): void {
    this.refreshMatchers();

    if (this.engine) {
      try {
        this.applyCustomRules();
        this.setEnabled(this.getSettings().blockEnabled);
      } catch (err) {
        this.warning = `Ad-filter settings could not be applied: ${describeError(err)}`;
        console.error('[adblocker] failed to apply settings:', err);
      }
    } else {
      this.setEnabled(this.getSettings().blockEnabled);
    }
  }

  /**
   * Whether `url` was blocked by this filter within the last `windowMs`.
   * Used to label a failed top-frame navigation as "blocked" instead of a
   * generic network error.
   */
  wasRecentlyBlocked(url: string, windowMs = 2000): boolean {
    return this.lastBlockedUrl === url && Date.now() - this.lastBlockedAt < windowMs;
  }

  /** Record a denied window.open / cross-site popup attempt. */
  recordPopup(url: string): void {
    this.stats.popupsBlocked += 1;
    this.stats.lastPopup = url;
    this.onChange?.();
  }

  /** Effective custom block domains for the supplemental popup filter. */
  blockHosts(): string[] {
    return this.blockMatcher.list();
  }

  /** Custom allowlist domains for the supplemental popup filter. */
  allowHosts(): string[] {
    return this.allowMatcher.list();
  }

  /**
   * Swap an engine into the live session without losing custom rules. Each
   * serialized engine starts with an empty custom-rule diff, so the rules must
   * be applied again after every cache/bundled/network replacement.
   */
  private activateEngine(nextEngine: ElectronBlocker): void {
    const previousEngine = this.engine;
    if (previousEngine && previousEngine !== nextEngine) {
      try {
        if (previousEngine.isBlockingEnabled(session.defaultSession)) {
          previousEngine.disableBlockingInSession(session.defaultSession);
        }
      } catch (err) {
        console.error('[adblocker] previous engine could not be disabled:', err);
      }
    }

    this.removeFallbackListener();
    this.engine = nextEngine;
    this.appliedCustomRules = [];
    this.prepareEngine(nextEngine);
    this.applyCustomRules();
    this.setEnabled(this.getSettings().blockEnabled);
  }

  /** Allow the maintained engine to tell the UI which network requests it stopped. */
  private prepareEngine(engine: ElectronBlocker): void {
    const originalRequestHandler = engine.onBeforeRequest.bind(engine);
    const originalCosmeticHandler = engine.onInjectCosmeticFilters.bind(engine);
    const originalMutationHandler = engine.onIsMutationObserverEnabled.bind(engine);

    // ElectronBlocker intentionally allows main-frame requests. Preserve the
    // browser's existing explicit domain-block behavior for those URLs while
    // delegating all other requests to the maintained engine.
    engine.onBeforeRequest = (details, callback) => {
      if (!this.enabledFlag) {
        callback({});
        return;
      }
      if (isSpotifyPlaybackRequest(details) || isYouTubePlaybackRequest(details)) {
        callback({});
        return;
      }
      const host = hostOf(details.url);
      if (host !== null && this.allowMatcher.test(host)) {
        callback({});
        return;
      }
      if (host !== null && !this.getSettings().youtubeCompat && isYouTubeAdRequest(details)) {
        this.recordBlocked(details.url, host, details.webContentsId);
        callback({ cancel: true });
        return;
      }
      if (host !== null && details.resourceType === 'mainFrame' && this.blockMatcher.test(host)) {
        this.recordBlocked(details.url, host, details.webContentsId);
        callback({ cancel: true });
        return;
      }
      originalRequestHandler(details, callback);
    };

    // The package's preload script handles comprehensive cosmetic filters. The
    // wrapper keeps the app toggle and allowlist authoritative for every frame.
    engine.onInjectCosmeticFilters = async (event, url, message) => {
      if (!this.shouldInjectCosmetics(url)) return;
      await originalCosmeticHandler(event, url, message);
    };
    engine.onIsMutationObserverEnabled = async (event) => {
      if (!this.getSettings().blockEnabled || !this.getSettings().cosmeticFiltering) {
        return false;
      }
      return originalMutationHandler(event);
    };

    engine.on('request-blocked', (request) => {
      if (this.enabledFlag) this.recordBlocked(request.url, request.hostname, request.tabId);
    });
  }

  private shouldInjectCosmetics(url: string): boolean {
    if (!this.enabledFlag || !this.getSettings().cosmeticFiltering) return false;
    if (!/^https?:/i.test(url)) return false;
    const host = hostOf(url);
    return host !== null && !this.allowMatcher.test(host);
  }

  private refreshMatchers(): void {
    const settings = this.getSettings();
    this.blockMatcher = makeMatcher([...this.bundledDomains, ...settings.blockDomains]);
    this.allowMatcher = makeMatcher(settings.allowDomains);
  }

  private applyCustomRules(): void {
    if (!this.engine) return;
    const nextRules = buildDomainFilterRules(
      this.blockMatcher.list(),
      this.allowMatcher.list(),
    );
    const nextSet = new Set(nextRules);
    const previousSet = new Set(this.appliedCustomRules);
    const added = nextRules.filter((rule) => !previousSet.has(rule));
    const removed = this.appliedCustomRules.filter((rule) => !nextSet.has(rule));

    if (added.length > 0 || removed.length > 0) {
      this.engine.updateFromDiff({ added, removed });
    }
    this.appliedCustomRules = nextRules;
  }

  private setEnabled(enabled: boolean): void {
    this.enabledFlag = enabled;

    if (this.engine) {
      const active = this.engine.isBlockingEnabled(session.defaultSession);
      if (enabled && !active) {
        this.engine.enableBlockingInSession(session.defaultSession);
      } else if (!enabled && active) {
        this.engine.disableBlockingInSession(session.defaultSession);
      }
      return;
    }

    if (enabled) this.installFallbackListener();
    else this.removeFallbackListener();
  }

  private installFallbackListener(): void {
    if (this.fallbackInstalled) return;
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      this.fallbackRequestHandler,
    );
    this.fallbackInstalled = true;
  }

  private removeFallbackListener(): void {
    if (!this.fallbackInstalled) return;
    session.defaultSession.webRequest.onBeforeRequest(null);
    this.fallbackInstalled = false;
  }

  private installPermissionHandler(): void {
    if (this.permissionHandlerInstalled) return;
    // Deny every permission request (notifications, camera, geolocation, …)
    // so permission prompts cannot appear over a page.
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    this.permissionHandlerInstalled = true;
  }

  private recordBlocked(url: string, host: string, webContentsId?: number): void {
    const at = Date.now();
    const normalizedHost = host.trim().toLowerCase() || hostOf(url) || 'unknown host';
    this.stats.count += 1;
    this.stats.lastBlocked = normalizedHost;
    this.stats.recentBlocked = [
      { host: normalizedHost, at },
      ...this.stats.recentBlocked,
    ].slice(0, 50);
    this.lastBlockedUrl = url;
    this.lastBlockedAt = at;
    this.onTabBlocked?.(webContentsId);
    this.onChange?.();
  }
}
