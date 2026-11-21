/**
 * Navigation toolbar: back/forward/reload/home, the address/search field
 * with security indicator and live predictions (history, bookmarks, domain
 * completions, search), the protection shield (blocked-count badge +
 * warning dot), bookmark star, history and settings.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useActiveTab, useBrowser } from '../context/BrowserContext';
import { suggestAddress } from '../../electron/normalize';
import { HOME_URL } from '../../shared/constants';
import type { HistoryEntry } from '../types';
import { ipc } from '../data/ipc';

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

interface Suggestion {
  kind: 'history' | 'bookmark' | 'domain' | 'search';
  /** Primary line (title or domain). */
  label: string;
  /** Secondary line (url or provider name). */
  detail: string;
  /** What gets submitted when picked. */
  value: string;
}

const MAX_SUGGESTIONS = 7;

export function Toolbar() {
  const { shape, actions } = useBrowser();
  const tab = useActiveTab();
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const displayUrl = tab?.displayUrl ?? '';
  const bookmarks = shape.settings?.bookmarks ?? [];

  // Follow the active tab's address while the user is not typing.
  useEffect(() => {
    if (!editing) setValue(displayUrl);
  }, [displayUrl, editing]);

  // Ctrl+L relayed from main (page-level shortcut) or chrome keydown.
  useEffect(() => {
    const focus = () => {
      setEditing(true);
      setValue(displayUrl);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    };
    window.addEventListener('adf:focus-address', focus);
    return () => window.removeEventListener('adf:focus-address', focus);
  }, [displayUrl]);

  // History is loaded lazily the first time the address bar gains focus.
  useEffect(() => {
    if (!editing) return;
    let live = true;
    ipc
      .historyGet()
      .then((list) => {
        if (live) setHistory(list);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [editing]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!editing) return [];
    const q = value.trim().toLowerCase();
    const out: Suggestion[] = [];
    const seen = new Set<string>();

    const push = (s: Suggestion) => {
      if (out.length >= MAX_SUGGESTIONS || seen.has(s.value)) return;
      seen.add(s.value);
      out.push(s);
    };

    if (q === '') {
      // Empty field: most recent history, then bookmarks.
      for (const h of history.slice(0, 4)) {
        push({ kind: 'history', label: h.title, detail: h.url.replace(/^https?:\/\//, ''), value: h.url });
      }
      for (const b of bookmarks.slice(0, 3)) {
        push({ kind: 'bookmark', label: b.title, detail: b.url.replace(/^https?:\/\//, ''), value: b.url });
      }
      return out;
    }

    // Domain completion first (explicit prefix match, e.g. "goo" → google.com).
    const domain = suggestAddress(value);
    if (domain) {
      push({ kind: 'domain', label: domain, detail: 'Open website', value: domain });
    }

    // History + bookmark matches (title or URL contains the query).
    for (const h of history) {
      if (out.length >= MAX_SUGGESTIONS - 1) break;
      if (
        h.url.toLowerCase().includes(q) ||
        h.title.toLowerCase().includes(q)
      ) {
        push({ kind: 'history', label: h.title, detail: h.url.replace(/^https?:\/\//, ''), value: h.url });
      }
    }
    for (const b of bookmarks) {
      if (out.length >= MAX_SUGGESTIONS - 1) break;
      if (
        b.url.toLowerCase().includes(q) ||
        b.title.toLowerCase().includes(q)
      ) {
        push({ kind: 'bookmark', label: b.title, detail: b.url.replace(/^https?:\/\//, ''), value: b.url });
      }
    }

    // Last row: search for the typed text.
    push({
      kind: 'search',
      label: `Search for “${value.trim()}”`,
      detail: 'Search',
      value: value.trim(),
    });
    return out;
  }, [editing, value, history, bookmarks]);

  // Reset the highlight whenever the suggestion list changes.
  useEffect(() => {
    setHighlight(suggestions.length > 0 ? 0 : -1);
  }, [suggestions]);

  const submit = async (raw: string) => {
    const text = raw.trim();
    if (text === '') return;
    setError(null);
    const message = await actions.navigate(text);
    if (message !== null) {
      setError(message);
    } else {
      setEditing(false);
      inputRef.current?.blur();
    }
  };

  const blocks = shape.browser?.blocks;
  const engine = shape.browser?.engine;
  const shieldCount = tab?.blockedCount ?? 0;
  const isSecure = tab ? tab.url.startsWith('https://') : false;
  const isHttp = tab ? tab.url.startsWith('http://') : false;
  const onHome = !tab || tab.url === HOME_URL;
  const bookmarked =
    shape.settings?.bookmarks.some((b) => b.url === tab?.url) === true && tab?.url !== HOME_URL;

  const toggleBookmark = () => {
    if (!tab || tab.url === HOME_URL) return;
    const existing = shape.settings?.bookmarks.find((b) => b.url === tab.url);
    if (existing) void actions.removeBookmark(existing.id);
    else void actions.addBookmark(tab.url, tab.title).then((msg) => setError(msg));
  };

  const KIND_ICON: Record<Suggestion['kind'], string> = {
    history: '🕘',
    bookmark: '★',
    domain: '🌐',
    search: '🔍',
  };

  return (
    <div className="toolbar">
      <div className="nav-buttons">
        <button
          className="tb-btn"
          title="Back"
          aria-label="Back"
          disabled={!tab?.canGoBack}
          onClick={() => actions.back()}
        >
          ←
        </button>
        <button
          className="tb-btn"
          title="Forward"
          aria-label="Forward"
          disabled={!tab?.canGoForward}
          onClick={() => actions.forward()}
        >
          →
        </button>
        {tab?.isLoading ? (
          <button className="tb-btn" title="Stop" aria-label="Stop loading" onClick={() => actions.stop()}>
            ✕
          </button>
        ) : (
          <button className="tb-btn" title="Reload (Ctrl+R)" aria-label="Reload" onClick={() => actions.reload()}>
            ⟳
          </button>
        )}
        <button
          className="tb-btn"
          title="Home"
          aria-label="Home"
          disabled={onHome}
          onClick={() => actions.goHome()}
        >
          ⌂
        </button>
      </div>

      <div className={`addr${error ? ' addr-error' : ''}`}>
        <span
          className={`addr-lock${isSecure ? ' addr-lock-secure' : ''}`}
          title={
            onHome
              ? 'Noads start page'
              : isSecure
                ? `Secure connection to ${hostOf(tab?.url ?? '') ?? ''}`
                : isHttp
                  ? 'Not secure — this page uses plain HTTP'
                  : ''
          }
        >
          {onHome ? '⌂' : isSecure ? '🔒' : isHttp ? '⚠' : '·'}
        </span>
        <input
          ref={inputRef}
          className="addr-input"
          value={value}
          placeholder="Search or enter address"
          aria-label="Address and search bar"
          aria-expanded={editing && suggestions.length > 0}
          role="combobox"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onFocus={() => {
            setEditing(true);
            setValue(displayUrl);
          }}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onBlur={() => {
            // Delay so a click on a suggestion lands before the list closes.
            setTimeout(() => {
              setEditing(false);
              setError(null);
              setValue(displayUrl);
            }, 120);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && suggestions.length > 0) {
              e.preventDefault();
              setHighlight((h) => (h + 1) % suggestions.length);
            } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
              e.preventDefault();
              setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const picked = highlight >= 0 && highlight < suggestions.length
                ? suggestions[highlight].value
                : value;
              void submit(picked);
            } else if (e.key === 'Escape') {
              setEditing(false);
              setValue(displayUrl);
              inputRef.current?.blur();
            } else if (e.key === 'Tab') {
              const domain = suggestAddress(value);
              if (domain) {
                e.preventDefault();
                setValue(domain);
              }
            }
          }}
        />
        {tab?.isLoading && <span className="addr-spinner" aria-hidden />}
        {error && <div className="addr-error-ring" role="alert">{error}</div>}
        {editing && suggestions.length > 0 && (
          <ul className="addr-dropdown" role="listbox" aria-label="Suggestions">
            {suggestions.map((s, i) => (
              <li key={`${s.kind}-${s.value}`} role="option" aria-selected={i === highlight}>
                <button
                  className={`addr-drop-item${i === highlight ? ' addr-drop-active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void submit(s.value);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                >
                  <span className="addr-drop-icon" aria-hidden>{KIND_ICON[s.kind]}</span>
                  <span className="addr-drop-label">{s.label}</span>
                  <span className="addr-drop-detail">{s.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="nav-buttons">
        <button
          className={`tb-btn tb-btn-star${bookmarked ? ' tb-btn-star-on' : ''}`}
          title={bookmarked ? 'Remove bookmark' : 'Bookmark this page (Ctrl+D)'}
          aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
          disabled={!tab || tab.url === HOME_URL}
          onClick={toggleBookmark}
        >
          {bookmarked ? '★' : '☆'}
        </button>
        <button
          className="tb-btn"
          title="Browsing history"
          aria-label="Browsing history"
          onClick={() => actions.openPopover('history')}
        >
          🕘
        </button>
        <button
          className={`tb-btn shield${blocks?.enabled ? ' shield-on' : ' shield-off'}`}
          title={
            blocks?.enabled
              ? `Protection on — ${shieldCount} blocked on this tab`
              : 'Protection disabled — click to review'
          }
          aria-label="Protection status"
          onClick={() => actions.openPopover('blocker')}
        >
          🛡
          {(blocks?.warning || engine?.source === 'custom-only') && (
            <span className="shield-warn-dot" aria-label="Filter warning" />
          )}
          {shieldCount > 0 && <span className="shield-badge">{shieldCount > 99 ? '99+' : shieldCount}</span>}
        </button>
        <button
          className="tb-btn"
          title="Settings"
          aria-label="Settings"
          onClick={() => actions.openPopover('settings')}
        >
          ⚙
        </button>
      </div>
    </div>
  );
}
