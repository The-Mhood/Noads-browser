/**
 * Settings panel (rendered inside the native settings popover).
 * Sections: Ad blocking · Search · Privacy · About. All changes persist via
 * the settings repository and take effect immediately.
 */
import { useState } from 'react';
import { useBrowser } from '../context/BrowserContext';
import { SEARCH_PROVIDERS } from '../../shared/searchProviders';

function DomainListEditor({
  title,
  hint,
  domains,
  placeholder,
  onChange,
}: {
  title: string;
  hint: string;
  domains: string[];
  placeholder: string;
  onChange: (next: string[]) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const entry = draft.trim();
    if (entry === '') return;
    const message = await onChange([...domains, entry]);
    setError(message);
    if (message === null) setDraft('');
  };

  const remove = async (domain: string) => {
    const message = await onChange(domains.filter((d) => d !== domain));
    setError(message);
  };

  return (
    <div className="section">
      <h3 className="section-title">{title}</h3>
      <p className="hint">{hint}</p>
      <div className="dom-input">
        <input
          className="dom-input-field"
          placeholder={placeholder}
          aria-label={`${title} — add domain`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <button className="btn-primary btn-small" onClick={() => void add()}>
          Add
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {domains.length > 0 && (
        <div className="dom-list">
          {domains.map((d) => (
            <span key={d} className="dom-chip">
              {d}
              <button
                className="chip-x"
                aria-label={`Remove ${d}`}
                onClick={() => void remove(d)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function SettingsPanel({ standalone = false }: { standalone?: boolean }) {
  const { shape, actions } = useBrowser();
  const settings = shape.settings;

  return (
    <div className={standalone ? 'panel panel-standalone' : 'panel'}>
      {standalone && (
        <div className="panel-titlebar">
          <span>Settings</span>
          <button className="chip-x" aria-label="Close settings" onClick={() => actions.closePopover()}>
            ×
          </button>
        </div>
      )}
      {!settings ? (
        <p className="hint">Loading settings…</p>
      ) : (
        <>
          <div className="section">
            <h3 className="section-title">General</h3>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.autoHideChrome}
                onChange={(e) =>
                  void actions.saveSettings({ autoHideChrome: e.target.checked })
                }
              />
              <span>
                Auto-hide tabs and toolbar
                <small className="toggle-sub">
                  Hides the browser chrome after 11 seconds of inactivity on a page;
                  any mouse or keyboard activity brings it back.
                </small>
              </span>
            </label>
          </div>

          <div className="section">
            <h3 className="section-title">Ad blocking</h3>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.blockEnabled}
                onChange={(e) => void actions.saveSettings({ blockEnabled: e.target.checked })}
              />
              <span>
                Block ads, trackers and popups
                <small className="toggle-sub">Network-level filtering plus popup denial.</small>
              </span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.cosmeticFiltering}
                disabled={!settings.blockEnabled}
                onChange={(e) =>
                  void actions.saveSettings({ cosmeticFiltering: e.target.checked })
                }
              />
              <span>
                Hide in-page ads &amp; popups
                <small className="toggle-sub">
                  Cosmetic filtering inside pages (applies on next page load).
                </small>
              </span>
            </label>
          </div>

          <DomainListEditor
            title="Always block"
            hint="Domains added here are blocked even if filter lists allow them."
            domains={settings.blockDomains}
            placeholder="ads.example.com"
            onChange={(next) => actions.saveSettings({ blockDomains: next })}
          />
          <DomainListEditor
            title="Never block"
            hint="Allowed domains bypass all blocking — use for sites that break."
            domains={settings.allowDomains}
            placeholder="example.com"
            onChange={(next) => actions.saveSettings({ allowDomains: next })}
          />

          <div className="section">
            <h3 className="section-title">Search</h3>
            <label className="field-label" htmlFor="search-provider">
              Address-bar search engine
            </label>
            <select
              id="search-provider"
              className="select"
              value={settings.searchProvider}
              onChange={(e) =>
                void actions.saveSettings({ searchProvider: e.target.value })
              }
            >
              {SEARCH_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="section">
            <h3 className="section-title">Privacy</h3>
            <p className="hint">
              Browsing history is stored locally on this device only. Camera, microphone,
              location and notification requests from websites are always denied.
            </p>
            <button className="btn-ghost btn-small" onClick={() => actions.historyClear()}>
              Clear browsing history
            </button>
          </div>

          <div className="section">
            <h3 className="section-title">About Noads Browser</h3>
            <p className="hint">
              A desktop browser that blocks ads, trackers and popups at the network level,
              with maintained EasyList/uBlock-compatible filters and per-site controls.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
