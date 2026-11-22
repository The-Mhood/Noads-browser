/**
 * Browser state context. The main process owns the truth; the renderer keeps
 * a MIRROR in a reducer, updated by the single `browser:state` push channel.
 * Components read via useBrowser()/useActiveTab() and act through `actions`,
 * which call the repository (src/data/ipc.ts) — never IPC directly.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from 'react';
import type { BrowserState, PopoverKind, Settings, TabState } from '../types';
import { HOME_URL } from '../../shared/constants';
import { ipc } from '../data/ipc';

export interface BrowserShape {
  browser: BrowserState | null;
  settings: Settings | null;
  panelOpen: boolean;
  blockPanelOpen: boolean;
}

type BrowserAction =
  | { type: 'STATE'; state: BrowserState }
  | { type: 'SETTINGS'; settings: Settings }
  | { type: 'PANEL'; open: boolean }
  | { type: 'BLOCK_PANEL'; open: boolean };

const initialShape: BrowserShape = {
  browser: null,
  settings: null,
  panelOpen: false,
  blockPanelOpen: false,
};

function reducer(shape: BrowserShape, action: BrowserAction): BrowserShape {
  switch (action.type) {
    case 'STATE':
      return { ...shape, browser: action.state };
    case 'SETTINGS':
      return { ...shape, settings: action.settings };
    case 'PANEL':
      return { ...shape, panelOpen: action.open };
    case 'BLOCK_PANEL':
      return { ...shape, blockPanelOpen: action.open };
  }
}

export interface BrowserActions {
  navigate(raw: string): Promise<string | null>;
  back(): void;
  forward(): void;
  reload(): void;
  stop(): void;
  goHome(): void;
  exitFullScreen(): void;
  openPopover(kind: PopoverKind): void;
  closePopover(): void;
  restoreTabs(): void;
  dismissRestoreTabs(): void;
  saveSettings(update: Partial<Settings>): Promise<string | null>;
  addBookmark(url: string, title: string): Promise<string | null>;
  removeBookmark(id: string): Promise<string | null>;
  tabsCreate(): void;
  tabsClose(id: string): void;
  tabsActivate(id: string): void;
  tabsDuplicate(id: string): void;
  tabsTogglePin(id: string): void;
  tabsToggleMute(id: string): void;
  tabsCloseOthers(id: string): void;
  tabsMove(id: string, index: number): void;
  findSearch(text: string, forward?: boolean, findNext?: boolean): void;
  findStop(): void;
  zoom(direction: 'in' | 'out' | 'reset'): void;
  historyClear(): void;
  filtersUpdate(): Promise<void>;
}

interface BrowserContextValue {
  shape: BrowserShape;
  dispatch: React.Dispatch<BrowserAction>;
  actions: BrowserActions;
}

const BrowserContext = createContext<BrowserContextValue | null>(null);

export function BrowserProvider({ children }: { children: React.ReactNode }) {
  const [shape, dispatch] = useReducer(reducer, initialShape);

  // Initial load + subscription to the consolidated state channel.
  useEffect(() => {
    let disposed = false;
    ipc
      .getState()
      .then((state) => {
        if (!disposed) dispatch({ type: 'STATE', state });
      })
      .catch(() => {});
    ipc
      .getSettings()
      .then((settings) => {
        if (!disposed) dispatch({ type: 'SETTINGS', settings });
      })
      .catch(() => {});
    const unsubscribe = ipc.onState((state) => dispatch({ type: 'STATE', state }));
    const unsubShortcut = ipc.onShortcut((name) => {
      if (name === 'focus-address') {
        window.dispatchEvent(new CustomEvent('adf:focus-address'));
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
      unsubShortcut();
    };
  }, []);

  const actions = useMemo<BrowserActions>(
    () => ({
      navigate: async (raw) => {
        const result = await ipc.navigate(raw);
        return result.ok ? null : result.message;
      },
      back: () => void ipc.goBack().catch(() => {}),
      forward: () => void ipc.goForward().catch(() => {}),
      reload: () => void ipc.reload().catch(() => {}),
      stop: () => void ipc.stop().catch(() => {}),
      goHome: () => void ipc.navigate(HOME_URL).catch(() => {}),
      exitFullScreen: () => void ipc.exitFullScreen().catch(() => {}),
      openPopover: (kind) => void ipc.setPopover(kind).catch(() => {}),
      closePopover: () => void ipc.setPopover(null).catch(() => {}),
      restoreTabs: () => void ipc.restoreTabs().catch(() => {}),
      dismissRestoreTabs: () => void ipc.dismissRestoreTabs().catch(() => {}),
      saveSettings: async (update) => {
        const result = await ipc.saveSettings(update);
        if (result.ok) {
          dispatch({ type: 'SETTINGS', settings: result.value });
          return null;
        }
        return result.message;
      },
      addBookmark: async (url, title) => {
        const result = await ipc.bookmarksAdd(url, title);
        if (result.ok) {
          dispatch({ type: 'SETTINGS', settings: result.value });
          return null;
        }
        return result.message;
      },
      removeBookmark: async (id) => {
        const result = await ipc.bookmarksRemove(id);
        if (result.ok) {
          dispatch({ type: 'SETTINGS', settings: result.value });
          return null;
        }
        return result.message;
      },
      tabsCreate: () => void ipc.tabsCreate().catch(() => {}),
      tabsClose: (id) => void ipc.tabsClose(id).catch(() => {}),
      tabsActivate: (id) => void ipc.tabsActivate(id).catch(() => {}),
      tabsDuplicate: (id) => void ipc.tabsDuplicate(id).catch(() => {}),
      tabsTogglePin: (id) => void ipc.tabsTogglePin(id).catch(() => {}),
      tabsToggleMute: (id) => void ipc.tabsToggleMute(id).catch(() => {}),
      tabsCloseOthers: (id) => void ipc.tabsCloseOthers(id).catch(() => {}),
      tabsMove: (id, index) => void ipc.tabsMove(id, index).catch(() => {}),
      findSearch: (text, forward = true, findNext = false) =>
        void ipc.findSearch(text, forward, findNext).catch(() => {}),
      findStop: () => void ipc.findStop().catch(() => {}),
      zoom: (direction) => void ipc.zoomSet(direction).catch(() => {}),
      historyClear: () => void ipc.historyClear().catch(() => {}),
      filtersUpdate: async () => {
        await ipc.filtersUpdate().catch(() => null);
      },
    }),
    [],
  );

  const value = useMemo(() => ({ shape, dispatch, actions }), [shape, actions]);
  return <BrowserContext.Provider value={value}>{children}</BrowserContext.Provider>;
}

export function useBrowser(): BrowserContextValue {
  const ctx = useContext(BrowserContext);
  if (!ctx) throw new Error('useBrowser must be used inside <BrowserProvider>');
  return ctx;
}

export function useActiveTab(): TabState | null {
  const { shape } = useBrowser();
  const browser = shape.browser;
  if (!browser) return null;
  return browser.tabs.find((t) => t.id === browser.activeTabId) ?? null;
}
