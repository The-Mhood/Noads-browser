/**
 * Renderer data repository — the ONLY place components talk to IPC.
 * Components never touch `window.browser` directly; swapping the preload
 * bridge for a different transport later means changing this file only.
 */
import type { BrowserApi } from '../../electron/preload';
import type {
  BrowserState,
  FilterEngineStatus,
  HistoryEntry,
  IpcResult,
  PopoverKind,
  Settings,
} from '../types';

declare global {
  interface Window {
    browser?: BrowserApi;
  }
}

const api: BrowserApi | null = typeof window !== 'undefined' ? (window.browser ?? null) : null;

function unavailable(): Error {
  return new Error('The browser bridge is unavailable (preload did not load).');
}

export const ipc = {
  available: api !== null,

  navigate: (raw: string): Promise<IpcResult> => api?.navigate(raw) ?? Promise.reject(unavailable()),
  goBack: (): Promise<void> => api?.goBack() ?? Promise.reject(unavailable()),
  goForward: (): Promise<void> => api?.goForward() ?? Promise.reject(unavailable()),
  reload: (): Promise<void> => api?.reload() ?? Promise.reject(unavailable()),
  stop: (): Promise<void> => api?.stop() ?? Promise.reject(unavailable()),
  getState: (): Promise<BrowserState> => api?.getState() ?? Promise.reject(unavailable()),
  exitFullScreen: (): Promise<void> => api?.exitFullScreen() ?? Promise.reject(unavailable()),
  reportActivity: (): void => {
    api?.reportActivity();
  },
  setPopover: (kind: PopoverKind | null): Promise<void> =>
    api?.setPopover(kind) ?? Promise.reject(unavailable()),
  restoreTabs: (): Promise<void> => api?.restoreTabs() ?? Promise.reject(unavailable()),
  dismissRestoreTabs: (): Promise<void> => api?.dismissRestoreTabs() ?? Promise.reject(unavailable()),
  getSettings: (): Promise<Settings> => api?.getSettings() ?? Promise.reject(unavailable()),
  saveSettings: (update: Partial<Settings>): Promise<IpcResult<Settings>> =>
    api?.saveSettings(update) ?? Promise.reject(unavailable()),
  bookmarksAdd: (url: string, title: string): Promise<IpcResult<Settings>> =>
    api?.bookmarksAdd(url, title) ?? Promise.reject(unavailable()),
  bookmarksRemove: (id: string): Promise<IpcResult<Settings>> =>
    api?.bookmarksRemove(id) ?? Promise.reject(unavailable()),
  tabsCreate: (): Promise<void> => api?.tabsCreate() ?? Promise.reject(unavailable()),
  tabsClose: (id: string): Promise<void> => api?.tabsClose(id) ?? Promise.reject(unavailable()),
  tabsActivate: (id: string): Promise<void> => api?.tabsActivate(id) ?? Promise.reject(unavailable()),
  tabsDuplicate: (id: string): Promise<void> => api?.tabsDuplicate(id) ?? Promise.reject(unavailable()),
  tabsTogglePin: (id: string): Promise<void> => api?.tabsTogglePin(id) ?? Promise.reject(unavailable()),
  tabsToggleMute: (id: string): Promise<void> => api?.tabsToggleMute(id) ?? Promise.reject(unavailable()),
  tabsCloseOthers: (id: string): Promise<void> => api?.tabsCloseOthers(id) ?? Promise.reject(unavailable()),
  tabsMove: (id: string, index: number): Promise<void> =>
    api?.tabsMove(id, index) ?? Promise.reject(unavailable()),
  findSearch: (text: string, forward: boolean, findNext: boolean): Promise<void> =>
    api?.findSearch(text, forward, findNext) ?? Promise.reject(unavailable()),
  findStop: (): Promise<void> => api?.findStop() ?? Promise.reject(unavailable()),
  zoomSet: (direction: 'in' | 'out' | 'reset'): Promise<number> =>
    api?.zoomSet(direction) ?? Promise.reject(unavailable()),
  historyGet: (): Promise<HistoryEntry[]> => api?.historyGet() ?? Promise.reject(unavailable()),
  historyClear: (): Promise<void> => api?.historyClear() ?? Promise.reject(unavailable()),
  filtersUpdate: (): Promise<FilterEngineStatus> =>
    api?.filtersUpdate() ?? Promise.reject(unavailable()),

  onState: (cb: (state: BrowserState) => void): (() => void) => api?.onState(cb) ?? (() => {}),
  onShortcut: (cb: (name: string) => void): (() => void) => api?.onShortcut(cb) ?? (() => {}),
};
