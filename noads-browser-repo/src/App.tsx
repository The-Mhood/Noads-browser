import { useEffect } from 'react';
import { HOME_URL, TABSTRIP_HEIGHT, TOOLBAR_HEIGHT } from '../shared/constants';
import type { PopoverKind } from '../shared/types';
import { BrowserProvider, useActiveTab, useBrowser } from './context/BrowserContext';
import { ipc } from './data/ipc';
import { TabStrip } from './components/TabStrip';
import { Toolbar } from './components/Toolbar';
import { InternalScreen } from './components/InternalScreen';
import { Toast } from './components/Toast';
import { SettingsPanel } from './components/SettingsPanel';
import { BlockerStatusPanel } from './components/BlockerStatusPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { FindPanel } from './components/FindPanel';
import './styles.css';

function Chrome() {
  // Single source of truth for chrome heights (shared/constants.ts);
  // main uses the same constants to lay out the native page view.
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--tabstrip-h', `${TABSTRIP_HEIGHT}px`);
    root.setProperty('--toolbar-h', `${TOOLBAR_HEIGHT}px`);
  }, []);

  const { shape, actions } = useBrowser();
  const tab = useActiveTab();

  // Keyboard shortcuts while the CHROME has focus (page-level shortcuts are
  // intercepted in the main process before the page sees them):
  //  Ctrl/Cmd+T new tab · Ctrl/Cmd+W close tab · Ctrl/Cmd+L focus address bar
  //  Ctrl/Cmd+R reload · Ctrl/Cmd+F find · Ctrl/Cmd+D bookmark
  //  Ctrl/Cmd+= / - / 0 zoom · Esc exit fullscreen / reset the bar
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const inField =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (!mod || inField) {
        if (e.key === 'Escape' && !inField) actions.exitFullScreen();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 't') {
        e.preventDefault();
        actions.tabsCreate();
      } else if (k === 'w') {
        e.preventDefault();
        const activeId = shape.browser?.activeTabId;
        if (activeId) actions.tabsClose(activeId);
      } else if (k === 'l') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('adf:focus-address'));
      } else if (k === 'r') {
        e.preventDefault();
        actions.reload();
      } else if (k === 'f') {
        e.preventDefault();
        actions.openPopover('find');
      } else if (k === 'd') {
        e.preventDefault();
        const active = shape.browser?.tabs.find(
          (t) => t.id === shape.browser?.activeTabId,
        );
        if (active && active.url !== HOME_URL) {
          const existing = shape.settings?.bookmarks.find((b) => b.url === active.url);
          if (existing) void actions.removeBookmark(existing.id);
          else void actions.addBookmark(active.url, active.title);
        }
      } else if (k === '=' || k === '+') {
        e.preventDefault();
        actions.zoom('in');
      } else if (k === '-') {
        e.preventDefault();
        actions.zoom('out');
      } else if (k === '0') {
        e.preventDefault();
        actions.zoom('reset');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, shape.browser, shape.settings]);

  // Chrome-area activity pings keep the auto-hide timer alive while the user
  // interacts with the tab strip / toolbar / internal screens.
  useEffect(() => {
    let last = 0;
    const ping = () => {
      const now = Date.now();
      if (now - last < 300) return;
      last = now;
      ipc.reportActivity();
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'];
    for (const e of events) window.addEventListener(e, ping, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, ping);
    };
  }, []);

  // Internal screens render in React (the active tab's native view is
  // detached by main while they show):
  //  - home:  empty state / start page
  //  - error: failed load, blocked page, or crash — shown while not loading
  const onHome = tab?.url === HOME_URL && !tab?.error;
  const onInternal = onHome || (tab?.error != null && !tab.isLoading);

  return (
    <div className={`chrome${shape.browser?.chromeHidden ? ' chrome-hidden' : ''}`}>
      <TabStrip />
      <Toolbar />
      {onInternal && <InternalScreen home={onHome} error={tab?.error ?? null} />}
      <Toast />
    </div>
  );
}

function OverlayChrome({ kind }: { kind: PopoverKind }) {
  const { dispatch } = useBrowser();

  useEffect(() => {
    dispatch({ type: kind === 'settings' ? 'PANEL' : 'BLOCK_PANEL', open: true });
  }, [dispatch, kind]);

  return (
    <div className="native-overlay-root">
      {kind === 'settings' ? (
        <SettingsPanel standalone />
      ) : kind === 'blocker' ? (
        <BlockerStatusPanel standalone />
      ) : kind === 'history' ? (
        <HistoryPanel />
      ) : (
        <FindPanel />
      )}
    </div>
  );
}

function overlayKind(): PopoverKind | null {
  const value = new URLSearchParams(window.location.search).get('overlay');
  return value === 'settings' || value === 'blocker' || value === 'history' || value === 'find'
    ? value
    : null;
}

export default function App() {
  const kind = overlayKind();
  return (
    <BrowserProvider>
      {kind ? <OverlayChrome kind={kind} /> : <Chrome />}
    </BrowserProvider>
  );
}
