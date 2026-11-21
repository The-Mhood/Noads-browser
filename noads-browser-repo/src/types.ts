/**
 * Renderer-side type surface. The shapes live in shared/ (single source of
 * truth with the main process); this module just re-exports them so
 * components import from one place.
 */
export type {
  BrowserError,
  BrowserState,
  BlockState,
  IpcResult,
  NavigationTarget,
  Notice,
  Settings,
  TabState,
} from '../shared/types';
export type { SearchProvider } from '../shared/searchProviders';
