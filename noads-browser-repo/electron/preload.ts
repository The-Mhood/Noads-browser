/**
 * Preload: the only bridge between the sandboxed UI renderer and the main
 * process. Exposes a minimal, typed, promise-based API — no Node, no raw
 * ipcRenderer — under window.browser.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type {
  BrowserState,
  FilterEngineStatus,
  HistoryEntry,
  IpcResult,
  PopoverKind,
  Settings,
} from '../shared/types';

const api = {
  navigate: (raw: string): Promise<IpcResult> =>
    ipcRenderer.invoke('nav:navigate', raw),
  goBack: (): Promise<void> => ipcRenderer.invoke('nav:back'),
  goForward: (): Promise<void> => ipcRenderer.invoke('nav:forward'),
  reload: (): Promise<void> => ipcRenderer.invoke('nav:reload'),
  stop: (): Promise<void> => ipcRenderer.invoke('nav:stop'),
  getState: (): Promise<BrowserState> => ipcRenderer.invoke('browser:get-state'),
  exitFullScreen: (): Promise<void> => ipcRenderer.invoke('browser:exit-fullscreen'),
  /** Ping main that the user is interacting with the chrome (auto-hide). */
  reportActivity: (): void => {
    ipcRenderer.send('ui:activity');
  },
  setPopover: (kind: PopoverKind | null): Promise<void> =>
    ipcRenderer.invoke('ui:popover', kind),
  restoreTabs: (): Promise<void> => ipcRenderer.invoke('session:restore-tabs'),
  dismissRestoreTabs: (): Promise<void> => ipcRenderer.invoke('session:dismiss-restore'),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (update: Partial<Settings>): Promise<IpcResult<Settings>> =>
    ipcRenderer.invoke('settings:set', update),
  bookmarksAdd: (url: string, title: string): Promise<IpcResult<Settings>> =>
    ipcRenderer.invoke('bookmarks:add', url, title),
  bookmarksRemove: (id: string): Promise<IpcResult<Settings>> =>
    ipcRenderer.invoke('bookmarks:remove', id),
  tabsCreate: (): Promise<void> => ipcRenderer.invoke('tabs:create'),
  tabsClose: (id: string): Promise<void> => ipcRenderer.invoke('tabs:close', id),
  tabsActivate: (id: string): Promise<void> => ipcRenderer.invoke('tabs:activate', id),
  tabsDuplicate: (id: string): Promise<void> => ipcRenderer.invoke('tabs:duplicate', id),
  tabsTogglePin: (id: string): Promise<void> => ipcRenderer.invoke('tabs:toggle-pin', id),
  tabsToggleMute: (id: string): Promise<void> => ipcRenderer.invoke('tabs:toggle-mute', id),
  tabsCloseOthers: (id: string): Promise<void> => ipcRenderer.invoke('tabs:close-others', id),
  tabsMove: (id: string, index: number): Promise<void> =>
    ipcRenderer.invoke('tabs:move', id, index),
  findSearch: (text: string, forward: boolean, findNext: boolean): Promise<void> =>
    ipcRenderer.invoke('find:search', text, forward, findNext),
  findStop: (): Promise<void> => ipcRenderer.invoke('find:stop'),
  zoomSet: (direction: 'in' | 'out' | 'reset'): Promise<number> =>
    ipcRenderer.invoke('zoom:set', direction),
  historyGet: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:get'),
  historyClear: (): Promise<void> => ipcRenderer.invoke('history:clear'),
  filtersUpdate: (): Promise<FilterEngineStatus> => ipcRenderer.invoke('filters:update'),
  /** Subscribe to consolidated state pushes. Returns an unsubscribe fn. */
  onState: (cb: (state: BrowserState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: BrowserState): void =>
      cb(state);
    ipcRenderer.on('browser:state', listener);
    return () => {
      ipcRenderer.removeListener('browser:state', listener);
    };
  },
  /** Subscribe to main-process shortcut relays (e.g. focus the address bar). */
  onShortcut: (cb: (name: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, name: string): void => cb(name);
    ipcRenderer.on('browser:shortcut', listener);
    return () => {
      ipcRenderer.removeListener('browser:shortcut', listener);
    };
  },
};

export type BrowserApi = typeof api;

contextBridge.exposeInMainWorld('browser', api);
