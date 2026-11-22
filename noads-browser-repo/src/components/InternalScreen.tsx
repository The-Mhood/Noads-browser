/**
 * Internal screens rendered in React while the tab's native view is detached:
 *  - home: brand, search, quick links, bookmarks manager, recent history,
 *    and the previous-session restore offer;
 *  - error: Chromium error code + message with retry.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BrowserError, HistoryEntry } from '../types';
import { useBrowser } from '../context/BrowserContext';
import { ipc } from '../data/ipc';

const QUICK_LINKS: Array<{ name: string; url: string }> = [
  { name: 'YouTube', url: 'https://www.youtube.com' },
  { name: 'Spotify', url: 'https://open.spotify.com' },
  { name: 'Wikipedia', url: 'https://en.wikipedia.org' },
  { name: 'Twitch', url: 'https://www.twitch.tv' },
  { name: 'Vimeo', url: 'https://vimeo.com' },
  { name: 'Reddit', url: 'https://www.reddit.com' },
];

/** Subtle animated warm-squares backdrop for internal screens (canvas 2D,
 *  deliberately lightweight — no WebGL dependency, no per-frame React). */
function HomeBackground() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const squares = Array.from({ length: 26 }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      s: 26 + Math.random() * 90,
      speed: 0.00016 + Math.random() * 0.0004,
      phase: i * 0.7,
    }));
    const draw = (t: number) => {
      const { width, height } = canvas.getBoundingClientRect();
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.clearRect(0, 0, width, height);
      for (const sq of squares) {
        const drift = (t * sq.speed + sq.phase) % 1;
        const x = sq.x * width;
        const y = ((sq.y + drift) % 1.2) * height - sq.s;
        const alpha = 0.05 + 0.05 * Math.sin(t * 0.0004 + sq.phase);
        ctx.fillStyle = `rgba(113, 57, 75, ${alpha.toFixed(3)})`;
        ctx.fillRect(x, y, sq.s, sq.s);
        ctx.strokeStyle = `rgba(185, 154, 125, ${alpha + 0.03})`;
        ctx.strokeRect(x + 0.5, y + 0.5, sq.s - 1, sq.s - 1);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="internal-bg" aria-hidden />;
}

function RestorePrompt() {
  const { shape, actions } = useBrowser();
  const restoreTabs = shape.browser?.restoreTabs ?? [];
  if (restoreTabs.length === 0) return null;
  return (
    <div className="restore-prompt">
      <span>
        Restore {restoreTabs.length} tab{restoreTabs.length === 1 ? '' : 's'} from your last
        session?
      </span>
      <div className="restore-actions">
        <button className="btn-primary btn-small" onClick={() => actions.restoreTabs()}>
          Restore tabs
        </button>
        <button className="btn-ghost btn-small" onClick={() => actions.dismissRestoreTabs()}>
          Not now
        </button>
      </div>
    </div>
  );
}

function BookmarkManager() {
  const { shape, actions } = useBrowser();
  const bookmarks = shape.settings?.bookmarks ?? [];
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const message = await actions.addBookmark(url, title || url);
    setError(message);
    if (message === null) {
      setUrl('');
      setTitle('');
    }
  };

  return (
    <section className="bookmarks" aria-label="Bookmarks">
      <h2 className="section-title">Bookmarks</h2>
      {bookmarks.length === 0 ? (
        <p className="empty-note">
          No bookmarks yet. Add one below, or press the ☆ in the toolbar while browsing.
        </p>
      ) : (
        <div className="bm-list">
          {bookmarks.map((b) => (
            <span key={b.id} className="bm-chip">
              <button
                className="bm-title"
                title={b.url}
                onClick={() => void actions.navigate(b.url)}
              >
                {b.title}
              </button>
              <button
                className="chip-x"
                aria-label={`Remove bookmark ${b.title}`}
                onClick={() => void actions.removeBookmark(b.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="bm-add">
        <input
          className="bm-input"
          placeholder="example.com"
          aria-label="Bookmark address"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <input
          className="bm-input"
          placeholder="Name (optional)"
          aria-label="Bookmark name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <button className="btn-primary btn-small bm-add-btn" onClick={() => void add()}>
          Add
        </button>
      </div>
      {error && <p className="bm-error" role="alert">{error}</p>}
    </section>
  );
}

function RecentHistory() {
  const { actions } = useBrowser();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    let live = true;
    ipc
      .historyGet()
      .then((list) => {
        if (live) setEntries(list.slice(0, 8));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (entries.length === 0) return null;
  return (
    <section aria-label="Recently visited">
      <h2 className="section-title">Recently visited</h2>
      <div className="bm-list">
        {entries.map((entry) => (
          <span key={entry.url} className="bm-chip bm-chip-history">
            <button
              className="bm-title"
              title={entry.url}
              onClick={() => void actions.navigate(entry.url)}
            >
              {entry.title}
            </button>
          </span>
        ))}
      </div>
    </section>
  );
}

function HomeScreen() {
  const { actions } = useBrowser();
  const [query, setQuery] = useState('');
  const year = useMemo(() => new Date().getFullYear(), []);
  return (
    <div className="internal-screen internal-home">
      <HomeBackground />
      <div className="internal-vignette" />
      <div className="internal-overlay">
        <RestorePrompt />
        <div className="home-hero">
          <h1 className="brand">
            Noads<span className="brand-dot">.</span>
          </h1>
          <p className="tagline">Browse the web without the noise.</p>
          <div className="home-search">
            <input
              className="home-search-input"
              placeholder="Search the web or enter an address"
              aria-label="Search or enter address"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && query.trim() !== '') {
                  void actions.navigate(query.trim());
                }
              }}
            />
          </div>
          <div className="quick-links">
            {QUICK_LINKS.map((link) => (
              <button
                key={link.url}
                className="quick-link"
                onClick={() => void actions.navigate(link.url)}
              >
                {link.name}
              </button>
            ))}
          </div>
        </div>
        <BookmarkManager />
        <RecentHistory />
        <p className="home-foot">Noads Browser · {year} · Ads and trackers blocked by default</p>
      </div>
    </div>
  );
}

function ErrorScreen({ error }: { error: BrowserError }) {
  const { actions } = useBrowser();
  return (
    <div className="internal-screen">
      <HomeBackground />
      <div className="internal-vignette" />
      <div className="internal-overlay error-card-wrap">
        <div className="error-card">
          <div className="error-code">
            {error.blocked ? 'BLOCKED' : `ERR ${error.code}`}
          </div>
          <p className="error-message">{error.message}</p>
          <p className="error-url">{error.url}</p>
          <div className="error-actions">
            <button className="btn-primary" onClick={() => actions.reload()}>
              Try again
            </button>
            <button className="btn-ghost" onClick={() => actions.goHome()}>
              Go home
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InternalScreen({ home, error }: { home: boolean; error: BrowserError | null }) {
  if (home) return <HomeScreen />;
  return error ? <ErrorScreen error={error} /> : null;
}
