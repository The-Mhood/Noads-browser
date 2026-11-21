import { useEffect } from 'react';
import { HOME_URL, TABSTRIP_HEIGHT, TOOLBAR_HEIGHT } from '../shared/constants';
import type { PopoverKind } from '../shared/types';
import { BrowserProvider, useActiveTab, useBrowser } from './context/BrowserContext';
import { TabStrip } from './components/TabStrip';
import { Toolbar } from './components/Toolbar';
import { InternalScreen } from './components/InternalScreen';
import { Toast } from './components/Toast';
import { SettingsPanel } from './components/SettingsPanel';
import { BlockerStatusPanel } from './components/BlockerStatusPanel';
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

  // Keyboard shortcuts (ignored while typing in a field):
  //  Cmd/Ctrl+T new tab · Cmd/Ctrl+W close tab · Cmd/Ctrl+L focus address bar
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
        // Esc on an internal screen (or anywhere the UI has focus) exits
        // fullscreen — a no-op when nothing is fullscreen.
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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, shape.browser?.activeTabId]);

  // Internal screens render in React (the active tab's native view is
  // detached by main while they show):
  //  - home:  empty state / start page
  //  - error: failed load, blocked page, or crash — shown while not loading
  const onHome = tab?.url === HOME_URL && !tab?.error;
  const onInternal = onHome || (tab?.error != null && !tab.isLoading);

  return (
    <div className="chrome">
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
      ) : (
        <BlockerStatusPanel standalone />
      )}
    </div>
  );
}

function overlayKind(): PopoverKind | null {
  const value = new URLSearchParams(window.location.search).get('overlay');
  return value === 'settings' || value === 'blocker' ? value : null;
}

export default function App() {
  const kind = overlayKind();
  return (
    <BrowserProvider>
      {kind ? <OverlayChrome kind={kind} /> : <Chrome />}
    </BrowserProvider>
  );
}
