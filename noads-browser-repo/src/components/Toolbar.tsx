/**
 * Navigation toolbar: back/forward/reload/home, the address/search field
 * with security indicator and domain completion, the protection shield
 * (blocked-count badge + warning dot), bookmark star, history and settings.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useActiveTab, useBrowser } from '../context/BrowserContext';
import { suggestAddress } from '../../electron/normalize';
import { HOME_URL } from '../../shared/constants';

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function Toolbar() {
  const { shape, actions } = useBrowser();
  const tab = useActiveTab();
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const displayUrl = tab?.displayUrl ?? '';

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

  const suggestion = useMemo(() => (editing ? suggestAddress(value) : null), [editing, value]);

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
            setEditing(false);
            setError(null);
            setValue(displayUrl);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit(suggestion && value.trim() !== '' && !value.includes(' ') ? suggestion : value);
            } else if (e.key === 'Escape') {
              setEditing(false);
              setValue(displayUrl);
              inputRef.current?.blur();
            } else if (e.key === 'Tab' && suggestion) {
              e.preventDefault();
              setValue(suggestion);
            }
          }}
        />
        {suggestion && (
          <button
            className="addr-suggestion"
            title={`Open ${suggestion}`}
            onMouseDown={(e) => {
              e.preventDefault();
              void submit(suggestion);
            }}
          >
            {suggestion} ↵
          </button>
        )}
        {tab?.isLoading && <span className="addr-spinner" aria-hidden />}
        {error && <div className="addr-error-ring" role="alert">{error}</div>}
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
