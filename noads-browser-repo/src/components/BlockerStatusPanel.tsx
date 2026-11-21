/**
 * Protection dashboard (shield popover): protection toggle, real counters
 * from the engine (total blocked, popups stopped, this tab), filter-list
 * provenance with a manual update action, recent blocked hosts, and a
 * per-site "allow ads here" exception.
 */
import { useState } from 'react';
import { useActiveTab, useBrowser } from '../context/BrowserContext';
import { HOME_URL } from '../../shared/constants';

function timeAgo(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const SOURCE_LABEL: Record<string, string> = {
  network: 'Downloaded just now',
  cache: 'Up to date (cached)',
  'stale-cache': 'Cached (refresh failed)',
  bundled: 'Bundled snapshot',
  'custom-only': 'Custom rules only',
};

export function BlockerStatusPanel({ standalone = false }: { standalone?: boolean }) {
  const { shape, actions } = useBrowser();
  const tab = useActiveTab();
  const [busy, setBusy] = useState(false);
  const blocks = shape.browser?.blocks;
  const engine = shape.browser?.engine;
  const settings = shape.settings;

  const currentHost = (() => {
    if (!tab || tab.url === HOME_URL) return null;
    try {
      return new URL(tab.url).hostname;
    } catch {
      return null;
    }
  })();
  const siteAllowed =
    currentHost !== null && settings?.allowDomains.includes(currentHost) === true;

  const toggleSite = async () => {
    if (!currentHost || !settings) return;
    const next = siteAllowed
      ? settings.allowDomains.filter((d) => d !== currentHost)
      : [...settings.allowDomains, currentHost];
    await actions.saveSettings({ allowDomains: next });
  };

  const updateFilters = async () => {
    setBusy(true);
    try {
      await actions.filtersUpdate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={standalone ? 'blocker-panel blocker-panel-standalone' : 'blocker-panel'}>
      {standalone && (
        <div className="panel-titlebar">
          <span>Protection</span>
          <button className="chip-x" aria-label="Close" onClick={() => actions.closePopover()}>
            ×
          </button>
        </div>
      )}

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={settings?.blockEnabled ?? false}
          onChange={(e) => void actions.saveSettings({ blockEnabled: e.target.checked })}
        />
        <span>
          Block ads, trackers and popups
          <small className="toggle-sub">
            {blocks?.enabled ? 'Network + in-page protection active' : 'Protection is off'}
          </small>
        </span>
      </label>

      <div className="blocker-stats">
        <div className="blocker-stat">
          <span className="blocker-total">{blocks?.count ?? 0}</span>
          <span className="blocker-section-title">requests blocked</span>
        </div>
        <div className="blocker-stat">
          <span className="blocker-total">{blocks?.popupsBlocked ?? 0}</span>
          <span className="blocker-section-title">popups stopped</span>
        </div>
        <div className="blocker-stat">
          <span className="blocker-total">{tab?.blockedCount ?? 0}</span>
          <span className="blocker-section-title">on this tab</span>
        </div>
      </div>

      {blocks?.warning && <p className="blocker-warning">{blocks.warning}</p>}

      <div className="blocker-section">
        <div className="blocker-section-head">
          <span className="blocker-section-title">Filter lists</span>
          <button
            className="btn-ghost btn-small"
            disabled={busy || engine?.updating === true}
            onClick={() => void updateFilters()}
          >
            {busy || engine?.updating ? 'Updating…' : 'Update now'}
          </button>
        </div>
        <p className="blocker-popup-note">
          {SOURCE_LABEL[engine?.source ?? 'custom-only']}
          {engine?.updatedAt ? ` · updated ${timeAgo(engine.updatedAt)}` : ''}
        </p>
      </div>

      {currentHost && (
        <div className="blocker-section">
          <span className="blocker-section-title">This site</span>
          <button className="btn-ghost btn-small" onClick={() => void toggleSite()}>
            {siteAllowed ? `Re-enable blocking on ${currentHost}` : `Allow ads on ${currentHost}`}
          </button>
        </div>
      )}

      <div className="blocker-section">
        <span className="blocker-section-title">Recent blocked hosts</span>
        {(blocks?.recentBlocked.length ?? 0) === 0 ? (
          <p className="blocker-popup-note">Nothing blocked yet this session.</p>
        ) : (
          <ul className="blocker-list">
            {blocks?.recentBlocked.slice(0, 12).map((entry, i) => (
              <li key={`${entry.host}-${entry.at}-${i}`} className="blocker-entry">
                <span className="blocker-host">{entry.host}</span>
                <span className="blocker-when">{timeAgo(entry.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
