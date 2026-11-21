/**
 * Find-in-page bar (native popover, top-right below the toolbar).
 * Searches live as you type; Enter / Shift+Enter step through matches.
 */
import { useEffect, useRef, useState } from 'react';
import { useBrowser } from '../context/BrowserContext';

export function FindPanel() {
  const { shape, actions } = useBrowser();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const find = shape.browser?.find;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const close = () => {
    actions.findStop();
    actions.closePopover();
  };

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        className="find-input"
        placeholder="Find in page"
        aria-label="Find in page"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          actions.findSearch(e.target.value, true, false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (text !== '') actions.findSearch(text, !e.shiftKey, true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
      />
      <span className="find-count" aria-live="polite">
        {text === ''
          ? ''
          : find && find.matches > 0
            ? `${find.activeMatch}/${find.matches}`
            : find && find.text === text
              ? '0/0'
              : ''}
      </span>
      <button
        className="tb-btn"
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        disabled={text === ''}
        onClick={() => actions.findSearch(text, false, true)}
      >
        ↑
      </button>
      <button
        className="tb-btn"
        title="Next match (Enter)"
        aria-label="Next match"
        disabled={text === ''}
        onClick={() => actions.findSearch(text, true, true)}
      >
        ↓
      </button>
      <button className="tb-btn" title="Close (Esc)" aria-label="Close find" onClick={close}>
        ×
      </button>
    </div>
  );
}
