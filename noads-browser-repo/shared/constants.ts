/**
 * Shared constants. The renderer applies these as CSS variables (src/App.tsx);
 * main uses CHROME_HEIGHT to lay out the native page view below the chrome.
 */

/** Height of the React tab strip, in CSS pixels. */
export const TABSTRIP_HEIGHT = 36;
/** Height of the React toolbar (address bar row), in CSS pixels. */
export const TOOLBAR_HEIGHT = 56;
/** Total chrome height above the native page view. */
export const CHROME_HEIGHT = TABSTRIP_HEIGHT + TOOLBAR_HEIGHT;

/** Logical home address. NEVER passed to webContents.loadURL — the main
 *  process intercepts it and shows the internal home screen instead. */
export const HOME_URL = 'noads://home';

/** Max tabs restored from a persisted session. */
export const MAX_RESTORED_TABS = 16;

/** Max bookmarks. */
export const MAX_BOOKMARKS = 100;
