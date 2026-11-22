/**
 * History popover: the persisted local browsing history, newest first.
 * Entries open in the current tab; "Clear history" wipes the store.
 */
import { useEffect, useState } from 'react';
import type { HistoryEntry } from '../types';
import { useBrowser } from '../context/BrowserContext';
import { ipc } from '../data/ipc';

function formatWhen(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function HistoryPanel() {
  const { actions } = useBrowser();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    let live = true;
    ipc
      .historyGet()
      .then((list) => {
        if (live) setEntries(list);
      })
      .catch(() => {
        if (live) setEntries([]);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="panel panel-standalone">
      <div className="panel-titlebar">
        <span>History</span>
        <div className="panel-titlebar-actions">
          <button
            className="btn-ghost btn-small"
            onClick={() => {
              actions.historyClear();
              setEntries([]);
            }}
          >
            Clear
          </button>
          <button className="chip-x" aria-label="Close history" onClick={() => actions.closePopover()}>
            ×
          </button>
        </div>
      </div>
      {entries === null ? (
        <p className="hint">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="hint">No browsing history yet. Pages you visit will appear here.</p>
      ) : (
        <ul className="history-list">
          {entries.map((entry) => (
            <li key={entry.url}>
              <button
                className="history-entry"
                title={entry.url}
                onClick={() => {
                  void actions.navigate(entry.url);
                  actions.closePopover();
                }}
              >
                <span className="history-title">{entry.title}</span>
                <span className="history-url">{entry.url.replace(/^https?:\/\//, '')}</span>
                <span className="history-when">{formatWhen(entry.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
