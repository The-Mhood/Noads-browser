/**
 * Main process: owns the Chromium session, all tabs, and all authoritative
 * browser state. The React renderer is just a mirror of it.
 *
 * View model (per tab):
 *  - mode 'web'   → the active tab's WebContentsView is attached, showing the page.
 *  - mode 'home'  → view detached; the React home screen fills the window.
 *  - mode 'error' → view detached; the React error screen is shown.
 * Only ONE view (the active tab's) is ever attached; inactive tabs stay
 * alive with history intact.
 */
import {
  app,
  BrowserWindow,
  WebContentsView,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  session,
} from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { CHROME_HEIGHT, HOME_URL } from '../shared/constants';
import type {
  Bookmark,
  BrowserState,
  FindState,
  HistoryEntry,
  NavigationTarget,
  Notice,
  PopoverKind,
  Settings,
} from '../shared/types';
import { AdBlocker } from './session';
import { makeMatcher } from './blocklist';
import { DEFAULT_SETTINGS, applySettingsUpdate, sanitizeSettings } from './settings';
import { bookmarkUrl, displayFor } from './normalize';
import { recordVisit, sanitizeHistory } from './history';
import { registerIpc } from './ipc';
import { Tab, TabManager, type TabDeps, type ViewHost } from './tabs';
import { createFullscreenTracker, type FullscreenTracker } from './fullscreen';
import { parseLongPressPayload } from './longpress';
import { runSmoke } from './smoke';

let fullscreen: FullscreenTracker | null = null;

function fullscreenDebug(...values: unknown[]): void {
  if (process.env.NOADS_FULLSCREEN_DEBUG === '1') {
    console.log('[fullscreen]', ...values);
  }
}

let mainWindow: BrowserWindow | null = null;
let settings: Settings = { ...DEFAULT_SETTINGS };
let blocker: AdBlocker | null = null;
let manager: TabManager | null = null;
let notice: Notice | null = null;
/** Only the active dropdown is a native view; the page remains full-width/live. */
let popoverView: WebContentsView | null = null;
let popoverKind: PopoverKind | null = null;
/** Previous-session tabs offered from the initial home screen. */
let pendingRestoreTabs: string[] = [];
let preservingStartupTabs = false;

// ---------------------------------------------------------------------------
// Browsing history (userData/history.json, debounced atomic writes)
// ---------------------------------------------------------------------------

let historyEntries: HistoryEntry[] = [];
let historySaveTimer: NodeJS.Timeout | null = null;

function historyPath(): string {
  return path.join(app.getPath('userData'), 'history.json');
}

async function loadHistoryFromDisk(): Promise<HistoryEntry[]> {
  try {
    const raw = await fs.promises.readFile(historyPath(), 'utf8');
    return sanitizeHistory(JSON.parse(raw) as unknown);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[history] history.json unreadable — starting empty:', err);
    }
    return [];
  }
}

function persistHistoryDebounced(): void {
  if (historySaveTimer) return;
  historySaveTimer = setTimeout(() => {
    historySaveTimer = null;
    void (async () => {
      try {
        const tmp = `${historyPath()}.tmp`;
        await fs.promises.writeFile(tmp, JSON.stringify(historyEntries), 'utf8');
        await fs.promises.rename(tmp, historyPath());
      } catch (err) {
        console.error('[history] failed to persist:', err);
      }
    })();
  }, 500);
}

function recordHistory(url: string, title: string): void {
  historyEntries = recordVisit(historyEntries, url, title, Date.now());
  persistHistoryDebounced();
}

/** Find-in-page state for the active tab (owned here, mirrored to the UI). */
let findState: FindState = { open: false, text: '', matches: 0, activeMatch: 0 };
let lastActiveKey = '';

// ---------------------------------------------------------------------------
// Chrome auto-hide: after inactivity on a web page, the tab strip and toolbar
// slide away and the page takes the full window. Any input brings them back.
// ---------------------------------------------------------------------------

const CHROME_AUTOHIDE_MS = 11_000;

let chromeHidden = false;
let chromeHideTimer: NodeJS.Timeout | null = null;
let lastActivityAt = 0;

function layoutWithChromeState(): void {
  layoutPageView();
}

function hideChrome(): void {
  if (chromeHidden) return;
  if (!manager || manager.active.mode !== 'web') return; // keep chrome on home/error
  if (popoverKind !== null) return; // user is interacting with a panel
  if (fullscreen?.isAny() || mainWindow?.isFullScreen()) return; // never chrome over fullscreen video
  chromeHidden = true;
  layoutWithChromeState();
  broadcastState();
}

function noteActivity(): void {
  if (!settings.autoHideChrome) return;
  const now = Date.now();
  // Page mousemove fires constantly; one reset per 250 ms is plenty.
  if (now - lastActivityAt < 250 && chromeHideTimer !== null) return;
  lastActivityAt = now;
  if (chromeHideTimer) clearTimeout(chromeHideTimer);
  chromeHideTimer = setTimeout(hideChrome, CHROME_AUTOHIDE_MS);
  if (chromeHidden) {
    chromeHidden = false;
    layoutWithChromeState();
    broadcastState();
  }
}

/** Re-evaluate auto-hide when the active tab/mode changes (navigation,
 *  tab switch): show the chrome and restart the idle countdown. */
function resetChromeAutoHide(): void {
  if (chromeHideTimer) {
    clearTimeout(chromeHideTimer);
    chromeHideTimer = null;
  }
  lastActivityAt = 0;
  if (chromeHidden) {
    chromeHidden = false;
    layoutWithChromeState();
  }
  if (settings.autoHideChrome && manager?.active.mode === 'web') {
    chromeHideTimer = setTimeout(hideChrome, CHROME_AUTOHIDE_MS);
  }
}

// ---------------------------------------------------------------------------
// Settings persistence (repository seam: swap for a database/API later)
// ---------------------------------------------------------------------------

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function loadSettingsFromDisk(): Promise<Settings> {
  try {
    const raw = await fs.promises.readFile(settingsPath(), 'utf8');
    return sanitizeSettings(JSON.parse(raw) as unknown);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[settings] settings.json unreadable — using defaults:', err);
    }
    return { ...DEFAULT_SETTINGS };
  }
}

let saveTimer: NodeJS.Timeout | null = null;
function persistSettingsDebounced(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistSettingsNow();
  }, 300);
}

async function persistSettingsNow(): Promise<void> {
  try {
    const tmp = `${settingsPath()}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
    await fs.promises.rename(tmp, settingsPath());
  } catch (err) {
    console.error('[settings] failed to persist:', err);
  }
}

function persistCurrentTabs(): void {
  if (!manager) return;
  const tabs = manager.all.map((t) => t.persistedUrl);
  if (JSON.stringify(tabs) === JSON.stringify(settings.lastTabs)) return;
  settings = { ...settings, lastTabs: tabs };
  persistSettingsDebounced();
}

/** Discard the restore offer when the user starts a new session action. */
function dismissRestoreOffer(): void {
  if (!preservingStartupTabs && pendingRestoreTabs.length === 0) return;
  preservingStartupTabs = false;
  pendingRestoreTabs = [];
  persistCurrentTabs();
}

// ---------------------------------------------------------------------------
// State broadcast: one consolidated event → renderer reducer
// ---------------------------------------------------------------------------

let broadcastTimer: NodeJS.Timeout | null = null;

function collectState(): BrowserState {
  const m = manager;
  const b = blocker;
  return {
    activeTabId: m ? m.getActiveId() : '',
    tabs: m ? m.collect() : [],
    blocks: {
      enabled: b?.enabled ?? false,
      count: b?.stats.count ?? 0,
      lastBlocked: b?.stats.lastBlocked ?? null,
      recentBlocked: b?.stats.recentBlocked ?? [],
      popupsBlocked: b?.stats.popupsBlocked ?? 0,
      lastPopup: b?.stats.lastPopup ?? null,
      warning: b?.warning ?? null,
    },
    notice,
    restoreTabs: [...pendingRestoreTabs],
    engine: b?.filterStatus ?? { source: 'custom-only', updatedAt: null, updating: false },
    find: findState,
    chromeHidden,
  };
}

function broadcastState(): void {
  // Tab switches and home↔web mode changes reset the auto-hide countdown —
  // but pure stat updates (blocked counters) must not.
  const activeKey = manager ? `${manager.getActiveId()}:${manager.active.mode}` : '';
  if (activeKey !== lastActiveKey) {
    lastActiveKey = activeKey;
    resetChromeAutoHide();
  }
  syncAttachedView();
  layoutPageView();
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  const state = collectState();
  if (!win.webContents.isDestroyed()) {
    win.webContents.send('browser:state', state);
  }
  const popoverContents = popoverView?.webContents;
  if (popoverContents && !popoverContents.isDestroyed()) {
    popoverContents.send('browser:state', state);
  }
}

/** Throttled variant for high-frequency events (block stats). */
function scheduleBroadcast(): void {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcastState();
  }, 100);
}

function setNotice(message: string): void {
  notice = { message, at: Date.now() };
  broadcastState();
}

// ---------------------------------------------------------------------------
// Window + native view layout
// ---------------------------------------------------------------------------

/**
 * Player fullscreen stays inside the existing browser window. The browser
 * header, tabs, address bar, and native window controls remain available; the
 * page view simply continues to occupy the area below the browser chrome.
 * This is intentionally not BrowserWindow.setFullScreen(), because that would
 * hide the very navigation surface the user needs while watching video.
 */
function enterPlayerFullscreen(tab: Tab): void {
  fullscreenDebug('enter-player-fullscreen', { tabId: tab.id });
  if (!mainWindow || mainWindow.isDestroyed() || tab.wc.isDestroyed()) return;
  if (manager?.active !== tab) manager?.activate(tab.id);
  mainWindow.show();
  mainWindow.focus();
  // Player fullscreen uses the existing browser window. This hides the
  // macOS menu bar without creating a second stagnant window.
  if (!mainWindow.isFullScreen()) mainWindow.setFullScreen(true);
  layoutPageView();
}

function exitPlayerFullscreen(): void {
  fullscreenDebug('exit-player-fullscreen');
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
  }
  layoutPageView();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
}

function layoutPopover(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !popoverView || !popoverKind) return;
  const [windowWidth, windowHeight] = mainWindow.getContentSize();
  const y = CHROME_HEIGHT + 6;
  const availableHeight = Math.max(0, windowHeight - y - 8);
  // The native bounds are intentionally close to the visible panel. A
  // transparent native view cannot pass clicks to a sibling page view, so it
  // must not cover the whole right-hand side of the browser.
  const desiredHeight =
    popoverKind === 'blocker'
      ? 400
      : popoverKind === 'history'
        ? 480
        : popoverKind === 'find'
          ? 56
          : 560;
  const width =
    popoverKind === 'find'
      ? Math.min(420, Math.max(0, windowWidth - 16))
      : Math.min(360, Math.max(0, windowWidth - 16));
  const height = Math.min(availableHeight, desiredHeight);
  popoverView.setBounds({
    x: Math.max(8, windowWidth - width - 8),
    y,
    width,
    height,
  });
  popoverView.setVisible(height > 0);
}

function layoutPageView(): void {
  if (!mainWindow || !manager) return;
  const view = manager.attachedView;
  const [width, height] = mainWindow.getContentSize();
  // In page-owned fullscreen (or OS fullscreen the page entered), the video
  // must fill the ENTIRE window — the browser chrome is hidden by the OS
  // fullscreen transition, so reserving CHROME_HEIGHT would push the video
  // down and letterbox it. Only reserve the strip when the chrome is showing.
  const inFullscreen = mainWindow.isFullScreen() || (fullscreen?.isAny() ?? false);
  const top = inFullscreen || chromeHidden ? 0 : CHROME_HEIGHT;
  if (view) {
    view.setVisible(true);
    view.setBounds({
      x: 0,
      y: top,
      width,
      height: Math.max(0, height - top),
    });
  }
  layoutPopover();
}

/**
 * Keep OS window fullscreen and the page view layout in step with HTML5
 * fullscreen state. Idempotent — safe to call from every relevant event
 * (enter/leave-html-full-screen, enter/leave-full-screen).
 */
function syncFullscreen(): void {
  fullscreen?.sync();
}

function handleHtmlFullscreen(tab: Tab, entered: boolean): void {
  // NOTE: never touch tab.wc here — this fires from the 'destroyed' handler
  // when a fullscreen tab is closed, and the webContents is already gone.
  console.log(`[fullscreen] html event tab=${tab.id} entered=${entered}`);
  fullscreenDebug('html-event', { tabId: tab.id, entered });
  fullscreen?.track(tab, entered);
  syncFullscreen();
}

/** Keep the small native popover above whichever page view is active. */
function raisePopoverView(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !popoverView) return;
  mainWindow.contentView.addChildView(popoverView);
}

function disposePopover(): void {
  const view = popoverView;
  popoverView = null;
  popoverKind = null;
  if (!view) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.contentView.removeChildView(view);
  }
  if (!view.webContents.isDestroyed()) {
    view.webContents.close();
  }
}

function rendererPath(): string {
  return path.join(app.getAppPath(), 'dist', 'index.html');
}

/**
 * A raw `electron .` launch can happen before the Vite renderer has been
 * built. Previously that left only BrowserWindow's background color on screen,
 * which looked like a fullscreen/layout failure. Show a useful diagnostic
 * instead of a silent blank window; `npm start` still performs the normal
 * build before launching.
 */
function rendererFailureHtml(reason: string): string {
  const safe = reason.replace(/[&<>\"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '\"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Noads Browser</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { display: grid; place-items: center; padding: 32px; background: #0b0e13; color: #e8edf4; font: 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { width: min(680px, 100%); padding: 32px; border: 1px solid #2f3b4e; border-radius: 16px; background: #121821; box-shadow: 0 18px 60px #0008; }
  h1 { margin: 0 0 12px; font-size: 22px; }
  p { color: #aeb9c8; line-height: 1.55; }
  code { display: block; margin: 16px 0; padding: 12px 14px; border-radius: 8px; background: #07090d; color: #d6c8ff; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
  small { color: #7f8da1; }
</style></head>
<body><main>
  <h1>Noads Browser UI could not load</h1>
  <p>The Electron shell started, but the compiled React renderer is missing or failed to load.</p>
  <code>npm ci\nnpm start</code>
  <p><small>${safe}</small></p>
</main></body></html>`;
}

function setPopover(kind: PopoverKind | null): void {
  if (kind === popoverKind && popoverView) {
    raisePopoverView();
    layoutPopover();
    return;
  }
  disposePopover();
  if (!kind || !mainWindow || mainWindow.isDestroyed()) return;

  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  view.setBackgroundColor('#00000000');
  popoverView = view;
  popoverKind = kind;
  mainWindow.contentView.addChildView(view);
  layoutPopover();
  void view.webContents
    .loadFile(rendererPath(), { search: `?overlay=${kind}` })
    .then(() => {
      // The find bar must accept typing immediately (Ctrl+F from the page).
      if (kind === 'find' && popoverView === view) view.webContents.focus();
    })
    .catch((err: unknown) => {
      console.error(`[ui] failed to load ${kind} popover:`, err);
      if (popoverView === view) disposePopover();
    });
}

/**
 * Attachment is owned by the window side: on every state broadcast, the
 * attached native view must match the active tab's mode ('web' → attached,
 * 'home'/'error' → detached). This also covers mode changes on the
 * already-active tab (home→web navigation, retry from error).
 */
function syncAttachedView(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !manager) return;
  const active = manager.active;
  if (active.mode === 'web') {
    manager.attach(active.view);
    raisePopoverView();
    active.view.setVisible(true);
  } else {
    manager.detach();
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 680,
    minHeight: 480,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    backgroundColor: '#0b0e13',
    autoHideMenuBar: true,
    title: 'Noads Browser',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('resize', layoutPageView);
  mainWindow.on('maximize', layoutPageView);
  mainWindow.on('unmaximize', layoutPageView);
  // Ordinary green-button fullscreen is independent. If the user presses
  // Escape while a player fullscreen presentation is active, clear the page
  // fullscreen state and restore the same browser window.
  mainWindow.on('enter-full-screen', syncFullscreen);
  mainWindow.on('leave-full-screen', () => {
    if (fullscreen?.isAny()) fullscreen.forceExit();
    else syncFullscreen();
  });
  mainWindow.on('closed', () => {
    disposePopover();
    mainWindow = null;
    manager = null;
  });

  if (process.env.NOADS_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  let rendererFallbackShown = false;
  const showRendererFailure = (reason: string): void => {
    if (rendererFallbackShown || !mainWindow || mainWindow.isDestroyed()) return;
    rendererFallbackShown = true;
    console.error(`[ui] ${reason}`);
    void mainWindow.webContents
      .loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(rendererFailureHtml(reason))}`)
      .catch((err: unknown) => console.error('[ui] failed to show renderer diagnostic:', err));
  };

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, code, description, validatedUrl, isMainFrame) => {
      if (isMainFrame && !validatedUrl.startsWith('data:')) {
        showRendererFailure(`Load error ${code}: ${description} (${validatedUrl})`);
      }
    },
  );
  const uiPath = rendererPath();
  if (!fs.existsSync(uiPath)) {
    showRendererFailure(`${uiPath} not found — run "npm start" or "npm run build" first.`);
    return;
  }
  mainWindow.webContents.once('did-finish-load', () => {
    layoutPageView();
  });
  void mainWindow.webContents.loadFile(uiPath).catch((err: unknown) => {
    showRendererFailure(`failed to load ${uiPath}: ${err instanceof Error ? err.message : String(err)}`);
  });
}

// ---------------------------------------------------------------------------
// Long-press copy / download (reported by the injected page script)
// ---------------------------------------------------------------------------

const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
};

function suggestFileName(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
    return last.replace(/[^\w.\- ()\[\]]+/g, '_').slice(0, 180) || 'download';
  } catch {
    return 'download';
  }
}

async function downloadFile(url: string, kind: 'image' | 'media'): Promise<void> {
  const win = mainWindow;
  if (!win || win.isDestroyed()) throw new Error('no window available');

  const resp = await session.defaultSession.fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`the server responded ${resp.status}`);
  if (!resp.body) throw new Error('the server sent an empty response');

  const contentType = resp.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  const ext = CONTENT_TYPE_EXT[contentType] ?? '';
  const base = suggestFileName(url);
  const needsExt = ext !== '' && !/\.[a-z0-9]{2,5}$/i.test(base);

  const dlg = await dialog.showSaveDialog(win, {
    title: `Save ${kind === 'image' ? 'image' : 'media'}`,
    defaultPath: base + (needsExt ? ext : ''),
  });
  if (dlg.canceled || !dlg.filePath) return; // user cancelled: nothing to report

  const outPath = dlg.filePath + (needsExt ? ext : '');
  await new Promise<void>((resolve, reject) => {
    const ws = fs.createWriteStream(outPath);
    const reader = resp.body!.getReader();
    let total = 0;
    const pump = async (): Promise<void> => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_DOWNLOAD_BYTES) {
            await reader.cancel();
            throw new Error(`file is larger than the ${MAX_DOWNLOAD_BYTES / (1024 ** 3)} GB limit`);
          }
          if (!ws.write(Buffer.from(value))) {
            await new Promise((r) => ws.once('drain', r));
          }
        }
        ws.end();
      } catch (err) {
        ws.destroy();
        try {
          fs.unlinkSync(outPath);
        } catch {
          /* partial file already gone */
        }
        reject(err);
        return;
      }
      ws.once('finish', resolve);
      ws.once('error', reject);
    };
    void pump();
  });
  setNotice(`Saved ${outPath.split(/[\\/]/).pop()}`);
}

// ---------------------------------------------------------------------------
// Bookmarks (stored in the settings repository)
// ---------------------------------------------------------------------------

let bookmarkSeq = 0;

function addBookmarkToSettings(urlRaw: string, titleRaw: string): Settings {
  const url = bookmarkUrl(urlRaw);
  if (!url) {
    throw new Error('Bookmarks must be a website address, e.g. https://example.com.');
  }
  if (settings.bookmarks.some((b) => b.url === url)) {
    throw new Error('That page is already bookmarked.');
  }
  const title =
    typeof titleRaw === 'string' && titleRaw.trim() !== ''
      ? titleRaw.trim().slice(0, 200)
      : displayFor(url);
  const bookmark: Bookmark = {
    id: `b${(bookmarkSeq++).toString(36)}${Date.now().toString(36)}`,
    title,
    url,
  };
  settings = applySettingsUpdate(settings, {
    bookmarks: [...settings.bookmarks, bookmark],
  });
  persistSettingsDebounced();
  return { ...settings };
}

function removeBookmarkFromSettings(id: string): Settings {
  if (!settings.bookmarks.some((b) => b.id === id)) {
    throw new Error('Bookmark not found.');
  }
  settings = applySettingsUpdate(settings, {
    bookmarks: settings.bookmarks.filter((b) => b.id !== id),
  });
  persistSettingsDebounced();
  return { ...settings };
}

function bookmarkCurrentTab(tab: Tab): void {
  const url = tab.wc.getURL();
  if (!/^https?:/i.test(url)) {
    setNotice('Nothing to bookmark on this screen.');
    return;
  }
  try {
    addBookmarkToSettings(url, tab.wc.getTitle());
    setNotice('Bookmarked');
  } catch (err) {
    setNotice(err instanceof Error ? err.message : 'Could not bookmark the page.');
  }
}

// ---------------------------------------------------------------------------
// Context menu (two-finger click / right-click on page content)
// ---------------------------------------------------------------------------

function safeHttpUrl(u: string): string | null {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

async function savePageAs(tab: Tab): Promise<void> {
  const url = tab.wc.getURL();
  const win = mainWindow;
  if (!win || win.isDestroyed()) throw new Error('no window available');

  const resp = await session.defaultSession.fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`the server responded ${resp.status}`);
  const html = await resp.text();

  const title = tab.wc.getTitle().replace(/[^\w\- ()\[\]]+/g, '_').slice(0, 120) || 'page';
  const dlg = await dialog.showSaveDialog(win, {
    title: 'Save page as…',
    defaultPath: path.join(app.getPath('downloads'), `${title}.html`),
    filters: [{ name: 'HTML document', extensions: ['html', 'htm'] }],
  });
  if (dlg.canceled || !dlg.filePath) return; // user cancelled: nothing to report
  await fs.promises.writeFile(dlg.filePath, html, 'utf8');
  setNotice(`Saved page as ${dlg.filePath.split(/[\\/]/).pop()}`);
}

/**
 * Native context menu for page content. params come from Chromium:
 * linkURL = link under the cursor, srcURL/mediaType = media under the
 * cursor, selectionText = selected text. Coordinates are in the page view's
 * space — offset by the chrome height to place the menu in window space.
 */
function pageContextMenu(tab: Tab, p: Electron.ContextMenuParams): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;

  const linkUrl = p.linkURL ? safeHttpUrl(p.linkURL) : null;
  const mediaUrl = p.srcURL ? safeHttpUrl(p.srcURL) : null;
  const items: Electron.MenuItemConstructorOptions[] = [];

  if (linkUrl) {
    items.push({
      label: 'Open link in new tab',
      click: () => manager?.createTab(linkUrl),
    });
    items.push({
      label: 'Copy link address',
      click: () => {
        clipboard.writeText(linkUrl);
        setNotice('Link address copied');
      },
    });
    items.push({
      label: 'Save link as…',
      click: () => {
        void downloadFile(linkUrl, 'media').catch((err: unknown) =>
          setNotice(`Download failed: ${err instanceof Error ? err.message : String(err)}`),
        );
      },
    });
  }

  if (p.mediaType === 'image' && mediaUrl) {
    items.push({
      label: 'Open image in new tab',
      click: () => manager?.createTab(mediaUrl),
    });
    items.push({
      label: 'Copy image address',
      click: () => {
        clipboard.writeText(mediaUrl);
        setNotice('Image address copied');
      },
    });
    items.push({
      label: 'Save image as…',
      click: () => {
        void downloadFile(mediaUrl, 'image').catch((err: unknown) =>
          setNotice(`Download failed: ${err instanceof Error ? err.message : String(err)}`),
        );
      },
    });
  } else if ((p.mediaType === 'video' || p.mediaType === 'audio') && mediaUrl) {
    items.push({
      label: 'Copy media address',
      click: () => {
        clipboard.writeText(mediaUrl);
        setNotice('Media address copied');
      },
    });
    items.push({
      label: 'Save media as…',
      click: () => {
        void downloadFile(mediaUrl, 'media').catch((err: unknown) =>
          setNotice(`Download failed: ${err instanceof Error ? err.message : String(err)}`),
        );
      },
    });
  }

  if (p.selectionText) {
    items.push({
      label: 'Copy',
      click: () => {
        clipboard.writeText(p.selectionText ?? '');
        setNotice('Selection copied');
      },
    });
  }

  items.push({ type: 'separator' });
  items.push({ label: 'Bookmark this page', click: () => bookmarkCurrentTab(tab) });
  items.push({
    label: 'Save page as…',
    click: () => {
      void savePageAs(tab).catch((err: unknown) =>
        setNotice(`Save failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    },
  });
  if (tab.wc.canGoBack()) items.push({ label: 'Back', click: () => manager?.back() });
  if (tab.wc.canGoForward()) items.push({ label: 'Forward', click: () => manager?.forward() });
  items.push({ label: 'Reload', click: () => manager?.reload() });
  items.push({ label: 'Go home', click: () => manager?.navigateActive('home') });

  const menu = Menu.buildFromTemplate(items);
  // The page view sits below the chrome in window coordinates.
  menu.popup({ window: win, x: Math.round(p.x), y: Math.round(p.y + CHROME_HEIGHT) });
}

function handleLongPress(raw: unknown): void {
  const info = parseLongPressPayload(raw);
  if (!info) return; // malformed/spoofed payloads are ignored, never crash
  if (info.kind === 'link') {
    clipboard.writeText(info.url);
    setNotice('Link copied to clipboard');
    return;
  }
  void downloadFile(info.url, info.kind).catch((err: unknown) => {
    setNotice(
      `Download failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}

/**
 * YouTube's synthetic DOM clicks can be ignored by some player revisions.
 * Accept only a visible, in-range skip-control coordinate from the active
 * YouTube tab, then send a real Chromium input sequence to that page view.
 */
function handleYoutubeControl(tab: Tab, raw: unknown): void {
  if (typeof raw !== 'string' || raw.length > 512) return;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as { kind?: unknown; x?: unknown; y?: unknown };
  if (record.kind !== 'skip' || typeof record.x !== 'number' || typeof record.y !== 'number') {
    return;
  }
  if (!Number.isFinite(record.x) || !Number.isFinite(record.y)) return;

  let hostname = '';
  try {
    hostname = new URL(tab.wc.getURL()).hostname;
  } catch {
    return;
  }
  if (!/(^|\\.)youtube\\.com$/i.test(hostname)) return;
  if (manager?.active !== tab || tab.mode !== 'web' || tab.wc.isDestroyed()) return;

  const bounds = tab.view.getBounds();
  const x = Math.round(record.x);
  const y = Math.round(record.y);
  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return;

  try {
    tab.wc.sendInputEvent({ type: 'mouseMove', x, y });
    tab.wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    tab.wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  } catch (err) {
    console.error('[youtube] trusted skip input failed:', err);
  }
}

function restorePreviousTabs(): void {
  if (!manager || pendingRestoreTabs.length === 0) return;
  const urls = [...pendingRestoreTabs];
  const homeId = manager.active.id;
  // Suppress intermediate session writes while the tabs are being rebuilt.
  preservingStartupTabs = true;
  pendingRestoreTabs = [];
  const restored = urls.map((url) => manager!.createTab(url));
  preservingStartupTabs = false;
  manager.close(homeId);
  if (restored.length > 0) manager.activate(restored[0].id);
  // Preserve the requested URLs immediately; individual did-navigate events
  // will replace this with the settled tab URLs as they finish loading.
  settings = { ...settings, lastTabs: urls };
  persistSettingsDebounced();
  broadcastState();
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

function loadBundledBlocklist(): string[] {
  const p = path.join(app.getAppPath(), 'assets', 'blocklist.json');
  const parsed: unknown = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) {
    throw new Error('assets/blocklist.json must be an array of domain strings');
  }
  return parsed;
}

app.whenReady().then(async () => {
  let bundled: string[] = [];
  try {
    bundled = loadBundledBlocklist();
  } catch (err) {
    console.error('[blocklist] bundled list failed to load — continuing with an empty list:', err);
  }

  settings = await loadSettingsFromDisk();
  historyEntries = await loadHistoryFromDisk();

  blocker = new AdBlocker(
    () => settings,
    bundled,
    path.join(app.getPath('userData'), 'adblocker.log'),
  );
  blocker.setOnChange(scheduleBroadcast);
  // Attribute blocked requests to their tab (drives the per-tab badge).
  blocker.setOnTabBlocked((webContentsId) => {
    manager?.noteBlockedForWebContents(webContentsId);
  });
  // Start the maintained filter refresh in parallel with the UI startup. A
  // bundled snapshot and the domain fallback are installed first, so ads are
  // blocked even while the remote lists are still downloading or unavailable.
  const blockerReady = blocker
    .install(
      app.getPath('userData'),
      path.join(app.getAppPath(), 'assets', 'adblock-engine.bin'),
    )
    .then(() => {
      if (bundled.length === 0 && blocker?.warning === null) {
        blocker.warning =
          'The bundled supplemental list could not be loaded — maintained filters are active without it.';
      }
      broadcastState();
    })
    .catch((err: unknown) => {
      console.error('[adblocker] startup install failed:', err);
      broadcastState();
    });

  const host: ViewHost = {
    attach: (view) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.contentView.addChildView(view);
        } catch (err) {
          console.error('[view] attach failed (may already be attached):', err);
        }
      }
    },
    detach: (view) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.contentView.removeChildView(view);
        } catch (err) {
          console.error('[view] detach failed (may already be detached):', err);
        }
      }
    },
  };

  const deps: TabDeps = {
    preloadPath: path.join(__dirname, 'pagePreload.js'),
    blocker,
    getSettings: () => settings,
    onBroadcast: () => broadcastState(),
    onPersistTabs: () => {
      // The initial home tab must not overwrite the previous-session URLs
      // before the user chooses Restore or Not now.
      if (preservingStartupTabs) return;
      persistCurrentTabs();
    },
    onNotice: setNotice,
    onNewTab: (url) => {
      if (!manager) return;
      manager.createTab(url);
    },
    onContextMenu: (tab, params) => pageContextMenu(tab, params),
    onHtmlFullscreen: (tab, entered) => handleHtmlFullscreen(tab, entered),
    onHistory: (url, title) => recordHistory(url, title),
    onActivity: (tab) => {
      if (manager?.active === tab) noteActivity();
    },
    onFoundInPage: (tab, result) => {
      if (manager?.active !== tab) return;
      findState = {
        ...findState,
        matches: result.matches,
        activeMatch: result.activeMatchOrdinal,
      };
      scheduleBroadcast();
    },
    onShortcut: (tab, name) => {
      if (!manager || manager.active !== tab) return;
      switch (name) {
        case 'find':
          if (popoverKind === 'find') {
            findState = { open: false, text: '', matches: 0, activeMatch: 0 };
            manager.stopFindInActive();
            setPopover(null);
          } else {
            setPopover('find');
          }
          break;
        case 'reload':
          manager.reload();
          break;
        case 'newTab':
          dismissRestoreOffer();
          manager.createTab();
          break;
        case 'closeTab':
          dismissRestoreOffer();
          manager.close(tab.id);
          break;
        case 'focusAddress':
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('browser:shortcut', 'focus-address');
          }
          break;
        case 'bookmark':
          bookmarkCurrentTab(tab);
          break;
        case 'zoomIn':
          setNotice(`Zoom ${Math.round(manager.zoomActive('in') * 100)}%`);
          break;
        case 'zoomOut':
          setNotice(`Zoom ${Math.round(manager.zoomActive('out') * 100)}%`);
          break;
        case 'zoomReset':
          manager.zoomActive('reset');
          setNotice('Zoom 100%');
          break;
        case 'escape':
          if (popoverKind === 'find') {
            findState = { open: false, text: '', matches: 0, activeMatch: 0 };
            manager.stopFindInActive();
            setPopover(null);
          }
          break;
      }
    },
    getCosmeticFilter: (hostname) => {
      if (!settings.blockEnabled || !settings.cosmeticFiltering || !blocker) {
        return { enabled: false, hosts: [] };
      }
      const allow = makeMatcher(blocker.allowHosts());
      if (allow.test(hostname)) return { enabled: false, hosts: [] };
      // The maintained engine handles the comprehensive cosmetic rules. These
      // hosts are only for the browser's supplemental popup scan.
      return {
        enabled: true,
        hosts: blocker.blockHosts().filter((h) => !allow.test(h)),
      };
    },
  };

  manager = new TabManager(deps, host);

  // Player fullscreen stays in the same browser window. The tracker handles
  // HTML5/JavaScript/WebKit reports, while the presentation callbacks enter
  // native macOS fullscreen on this existing window. No second player window
  // is created, and the Noads browser chrome remains in the same view.
  fullscreen = createFullscreenTracker({
    window: () => mainWindow,
    relayout: layoutPageView,
    enter: enterPlayerFullscreen,
    exit: exitPlayerFullscreen,
  });

  pendingRestoreTabs = settings.lastTabs.filter((url) => /^https?:/i.test(url));
  preservingStartupTabs = pendingRestoreTabs.length > 0;
  // Every launch begins on a clean home tab. Previous tabs are offered as an
  // explicit choice instead of being opened immediately.
  manager.createTab(HOME_URL);

  // Downloads triggered by the page itself: ask where to save; never silently fail.
  session.defaultSession.on('will-download', (_e, item) => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) {
      item.cancel();
      return;
    }
    dialog
      .showSaveDialog(win, { defaultPath: item.getFilename() })
      .then((res) => {
        if (res.canceled || !res.filePath) {
          item.cancel();
          return;
        }
        item.savePath = res.filePath;
      })
      .catch((err: unknown) => {
        console.error('[download] save dialog failed:', err);
        item.cancel();
      });
  });

  // Activity pings from the chrome renderer (mouse/keyboard over the UI).
  ipcMain.on('ui:activity', () => {
    noteActivity();
  });

  // Long-press reports from the injected page script (one-way, validated).
  ipcMain.on('page:longpress', (_e, raw: unknown) => {
    handleLongPress(raw);
  });

  // YouTube skip-control reports from the page script. The sender is mapped
  // back to a tab before main synthesizes any input.
  ipcMain.on('page:youtube-control', (event, raw: unknown) => {
    const tab = manager?.all.find((candidate) => candidate.wc === event.sender);
    if (tab) handleYoutubeControl(tab, raw);
  });

  // Page clicks are only hints for popup policy. Main validates the sender and
  // the destination before Tab records the gesture; page content never gets
  // to open an arbitrary child tab by sending this message.
  ipcMain.on('page:user-gesture', (event) => {
    const tab = manager?.all.find((candidate) => candidate.wc === event.sender);
    tab?.noteUserGesture();
  });
  ipcMain.on('page:user-link', (event, raw: unknown) => {
    if (typeof raw !== 'string' || raw.length > 4096) return;
    const tab = manager?.all.find((candidate) => candidate.wc === event.sender);
    if (!tab) return;
    try {
      const target = new URL(raw);
      if (target.protocol === 'http:' || target.protocol === 'https:') {
        tab.noteUserLink(target.toString());
      }
    } catch {
      // Invalid page input is ignored.
    }
  });

  // Fallback fullscreen signal from pagePreload. The sender lookup prevents a
  // page from changing another tab's fullscreen state.
  ipcMain.on('page:fullscreen', (event, entered: unknown) => {
    fullscreenDebug('page-report', { entered, senderId: event.sender.id });
    if (typeof entered !== 'boolean') {
      console.error('[fullscreen] invalid page fullscreen payload');
      return;
    }
    const tab = manager?.all.find((candidate) => candidate.wc === event.sender);
    if (!tab) {
      console.error('[fullscreen] fullscreen report came from an unknown page');
      return;
    }
    tab.setHtmlFullscreen(entered);
  });

  registerIpc({
    getSettings: () => settings,
    getState: () => collectState(),
    updateSettings: (update: Partial<Settings>): Settings => {
      settings = applySettingsUpdate(settings, update);
      persistSettingsDebounced();
      blocker?.refresh();
      if (!settings.autoHideChrome && chromeHidden) {
        chromeHidden = false;
        layoutPageView();
      }
      resetChromeAutoHide();
      broadcastState();
      return { ...settings };
    },
    navigate: (raw: string): NavigationTarget => {
      dismissRestoreOffer();
      return manager!.navigateActive(raw);
    },
    back: () => manager!.back(),
    forward: () => manager!.forward(),
    reload: () => manager!.reload(),
    stop: () => manager!.stop(),
    createTab: () => {
      dismissRestoreOffer();
      manager!.createTab();
    },
    closeTab: (id: string) => {
      dismissRestoreOffer();
      manager!.close(id);
    },
    activateTab: (id: string) => manager!.activate(id),
    addBookmark: (url: string, title: string): Settings =>
      addBookmarkToSettings(url, title),
    removeBookmark: (id: string): Settings => removeBookmarkFromSettings(id),
    exitFullScreen: () => {
      // Esc on an internal screen (home/error) or any stuck-fullscreen case.
      fullscreen?.forceExit();
    },
    setPopover,
    restoreTabs: restorePreviousTabs,
    dismissRestoreTabs: dismissRestoreOffer,
    duplicateTab: (id: string) => {
      manager?.duplicateTab(id);
    },
    togglePin: (id: string) => {
      manager?.togglePin(id);
    },
    toggleMute: (id: string) => {
      manager?.toggleMute(id);
    },
    closeOthers: (id: string) => {
      dismissRestoreOffer();
      manager?.closeOthers(id);
    },
    moveTab: (id: string, index: number) => {
      manager?.moveTab(id, index);
    },
    find: (text: string, forward: boolean, findNext: boolean) => {
      findState = { open: text !== '', text, matches: 0, activeMatch: 0 };
      manager?.findInActive(text, forward, findNext);
      scheduleBroadcast();
    },
    stopFind: () => {
      findState = { open: false, text: '', matches: 0, activeMatch: 0 };
      manager?.stopFindInActive();
      scheduleBroadcast();
    },
    zoom: (direction) => {
      const factor = manager?.zoomActive(direction) ?? 1;
      setNotice(`Zoom ${Math.round(factor * 100)}%`);
      return factor;
    },
    getHistory: () => [...historyEntries],
    clearHistory: () => {
      historyEntries = [];
      persistHistoryDebounced();
      setNotice('Browsing history cleared');
    },
    updateFilters: async () => {
      const status = (await blocker?.forceUpdate()) ?? {
        source: 'custom-only' as const,
        updatedAt: null,
        updating: false,
      };
      setNotice(
        status.updating
          ? 'Filter update in progress…'
          : blocker?.warning
            ? blocker.warning
            : 'Filters are up to date.',
      );
      return status;
    },
  });

  createWindow();

  if (process.env.NOADS_SMOKE === '1') {
    void blockerReady
      .then(() =>
        runSmoke({
          getUiWindow: () => mainWindow,
          getPage: () => manager!.active.view,
          manager: manager!,
          fullscreen: fullscreen!,
          blocker: blocker!,
        }),
      )
      .then(
        () => app.exit(0),
        (err: unknown) => {
          console.error('SMOKE FAILED:', err);
          app.exit(1);
        },
      );
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('[settings] failed to persist on quit:', err);
  }
  if (historySaveTimer) {
    clearTimeout(historySaveTimer);
    historySaveTimer = null;
  }
  try {
    fs.writeFileSync(historyPath(), JSON.stringify(historyEntries), 'utf8');
  } catch (err) {
    console.error('[history] failed to persist on quit:', err);
  }
});
