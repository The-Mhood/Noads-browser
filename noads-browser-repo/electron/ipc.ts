/**
 * IPC routes — the "API layer" between the React renderer and the main
 * process. All handlers return values (including error results); nothing is
 * thrown across the IPC boundary and nothing is swallowed.
 */
import { ipcMain } from 'electron';
import type {
  BrowserState,
  FilterEngineStatus,
  HistoryEntry,
  IpcResult,
  NavigationTarget,
  PopoverKind,
  Settings,
} from '../shared/types';

const POPOVER_KINDS = new Set<PopoverKind>(['settings', 'blocker', 'history', 'find']);

export interface IpcDeps {
  getSettings(): Settings;
  getState(): BrowserState;
  /** Throws on invalid input (validated in electron/settings.ts). */
  updateSettings(update: Partial<Settings>): Settings;
  navigate(raw: string): NavigationTarget;
  back(): void;
  forward(): void;
  reload(): void;
  stop(): void;
  createTab(): void;
  closeTab(id: string): void;
  activateTab(id: string): void;
  /** Throws on invalid input (validated in electron/settings.ts). */
  addBookmark(url: string, title: string): Settings;
  /** Throws on invalid input. */
  removeBookmark(id: string): Settings;
  exitFullScreen(): void;
  setPopover(kind: PopoverKind | null): void;
  restoreTabs(): void;
  dismissRestoreTabs(): void;
  duplicateTab(id: string): void;
  togglePin(id: string): void;
  toggleMute(id: string): void;
  closeOthers(id: string): void;
  moveTab(id: string, index: number): void;
  find(text: string, forward: boolean, findNext: boolean): void;
  stopFind(): void;
  zoom(direction: 'in' | 'out' | 'reset'): number;
  getHistory(): HistoryEntry[];
  clearHistory(): void;
  updateFilters(): Promise<FilterEngineStatus>;
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle('nav:navigate', (_event, raw: unknown): IpcResult => {
    if (typeof raw !== 'string' || raw.length > 2048) {
      return { ok: false, message: 'Address is empty or too long.' };
    }
    const target = deps.navigate(raw);
    if (target.kind === 'error') return { ok: false, message: target.message };
    return { ok: true, value: undefined };
  });

  ipcMain.handle('browser:exit-fullscreen', () => deps.exitFullScreen());
  ipcMain.handle('ui:popover', (_event, kind: unknown) => {
    if (kind !== null && (typeof kind !== 'string' || !POPOVER_KINDS.has(kind as PopoverKind))) {
      throw new Error('Invalid popover kind.');
    }
    deps.setPopover(kind as PopoverKind | null);
  });
  ipcMain.handle('session:restore-tabs', () => deps.restoreTabs());
  ipcMain.handle('session:dismiss-restore', () => deps.dismissRestoreTabs());

  ipcMain.handle('nav:back', () => deps.back());
  ipcMain.handle('nav:forward', () => deps.forward());
  ipcMain.handle('nav:reload', () => deps.reload());
  ipcMain.handle('nav:stop', () => deps.stop());

  ipcMain.handle('browser:get-state', (): BrowserState => deps.getState());

  ipcMain.handle('settings:get', (): Settings => ({ ...deps.getSettings() }));

  ipcMain.handle(
    'settings:set',
    (_event, update: unknown): IpcResult<Settings> => {
      if (typeof update !== 'object' || update === null) {
        return { ok: false, message: 'Invalid settings payload.' };
      }
      try {
        const next = deps.updateSettings(update as Partial<Settings>);
        return { ok: true, value: next };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    'bookmarks:add',
    (_event, url: unknown, title: unknown): IpcResult<Settings> => {
      if (typeof url !== 'string' || url.length > 2048 || typeof title !== 'string') {
        return { ok: false, message: 'Invalid bookmark payload.' };
      }
      try {
        return { ok: true, value: deps.addBookmark(url, title) };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    'bookmarks:remove',
    (_event, id: unknown): IpcResult<Settings> => {
      if (typeof id !== 'string' || id.length === 0) {
        return { ok: false, message: 'Invalid bookmark id.' };
      }
      try {
        return { ok: true, value: deps.removeBookmark(id) };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle('tabs:create', () => deps.createTab());
  ipcMain.handle('tabs:close', (_event, id: unknown) => {
    if (typeof id === 'string') deps.closeTab(id);
  });
  ipcMain.handle('tabs:activate', (_event, id: unknown) => {
    if (typeof id === 'string') deps.activateTab(id);
  });
  ipcMain.handle('tabs:duplicate', (_event, id: unknown) => {
    if (typeof id === 'string') deps.duplicateTab(id);
  });
  ipcMain.handle('tabs:toggle-pin', (_event, id: unknown) => {
    if (typeof id === 'string') deps.togglePin(id);
  });
  ipcMain.handle('tabs:toggle-mute', (_event, id: unknown) => {
    if (typeof id === 'string') deps.toggleMute(id);
  });
  ipcMain.handle('tabs:close-others', (_event, id: unknown) => {
    if (typeof id === 'string') deps.closeOthers(id);
  });
  ipcMain.handle('tabs:move', (_event, id: unknown, index: unknown) => {
    if (typeof id === 'string' && typeof index === 'number' && Number.isInteger(index)) {
      deps.moveTab(id, index);
    }
  });

  ipcMain.handle('find:search', (_event, text: unknown, forward: unknown, findNext: unknown) => {
    if (typeof text !== 'string' || text.length > 512) return;
    deps.find(text, forward !== false, findNext === true);
  });
  ipcMain.handle('find:stop', () => deps.stopFind());

  ipcMain.handle('zoom:set', (_event, direction: unknown): number => {
    if (direction !== 'in' && direction !== 'out' && direction !== 'reset') {
      return deps.zoom('reset');
    }
    return deps.zoom(direction);
  });

  ipcMain.handle('history:get', (): HistoryEntry[] => deps.getHistory());
  ipcMain.handle('history:clear', () => deps.clearHistory());

  ipcMain.handle('filters:update', (): Promise<FilterEngineStatus> => deps.updateFilters());
}
