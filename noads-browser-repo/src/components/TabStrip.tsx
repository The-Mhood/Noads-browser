/**
 * Tab strip: favicons, titles, loading spinners, audio/mute indicators,
 * pinned tabs, middle-click to close, drag-to-reorder, and a right-click
 * tab menu (duplicate / pin / mute / close others).
 */
import { useEffect, useRef, useState } from 'react';
import type { TabState } from '../types';
import { useBrowser } from '../context/BrowserContext';

interface TabMenuState {
  tabId: string;
  x: number;
  y: number;
}

function TabIcon({ tab }: { tab: TabState }) {
  if (tab.isLoading) return <span className="tab-spinner" aria-hidden />;
  if (tab.favicon) {
    return (
      <img
        className="tab-favicon"
        src={tab.favicon}
        alt=""
        draggable={false}
        onError={(e) => {
          // A broken favicon falls back to the letter marker.
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  const letter = (tab.title.trim()[0] ?? 'N').toUpperCase();
  return <span className="tab-letter" aria-hidden>{letter}</span>;
}

export function TabStrip() {
  const { shape, actions } = useBrowser();
  const [menu, setMenu] = useState<TabMenuState | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  const tabs = shape.browser?.tabs ?? [];
  const activeId = shape.browser?.activeTabId ?? '';

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  const onDrop = (index: number) => {
    if (dragId !== null) actions.tabsMove(dragId, index);
    setDragId(null);
    setDropIndex(null);
  };

  const menuTab = menu ? tabs.find((t) => t.id === menu.tabId) : null;

  return (
    <div className="tabstrip" ref={stripRef} role="tablist" aria-label="Tabs">
      {tabs.map((tab, index) => {
        const active = tab.id === activeId;
        const classes = [
          'tab',
          active ? 'tab-active' : '',
          tab.pinned ? 'tab-pinned' : '',
          dropIndex === index && dragId !== null && dragId !== tab.id ? 'tab-drop' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div
            key={tab.id}
            className={classes}
            role="tab"
            aria-selected={active}
            title={tab.title}
            draggable
            onDragStart={(e) => {
              setDragId(tab.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => {
              setDragId(null);
              setDropIndex(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDropIndex(index);
            }}
            onDrop={(e) => {
              e.preventDefault();
              onDrop(index);
            }}
            onClick={() => actions.tabsActivate(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1 && !tab.pinned) actions.tabsClose(tab.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
            }}
          >
            {tab.pinned ? (
              <span className="tab-pin-mark" aria-label="Pinned">
                <TabIcon tab={tab} />
              </span>
            ) : (
              <>
                <TabIcon tab={tab} />
                <span className="tab-title">{tab.title}</span>
                {(tab.audible || tab.muted) && (
                  <button
                    className={`tab-audio${tab.muted ? ' tab-muted' : ''}`}
                    title={tab.muted ? 'Unmute tab' : 'Mute tab'}
                    aria-label={tab.muted ? 'Unmute tab' : 'Mute tab'}
                    onClick={(e) => {
                      e.stopPropagation();
                      actions.tabsToggleMute(tab.id);
                    }}
                  >
                    {tab.muted ? '\u{1F507}' : '\u{1F50A}'}
                  </button>
                )}
                <button
                  className="tab-x"
                  title="Close tab"
                  aria-label={`Close ${tab.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.tabsClose(tab.id);
                  }}
                >
                  ×
                </button>
              </>
            )}
          </div>
        );
      })}
      <button
        className="tab-new"
        title="New tab (Ctrl+T)"
        aria-label="New tab"
        onClick={() => actions.tabsCreate()}
      >
        +
      </button>
      {menu && menuTab && (
        <div
          className="tab-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              actions.tabsActivate(menu.tabId);
              setMenu(null);
            }}
          >
            Switch to tab
          </button>
          <button
            onClick={() => {
              actions.tabsDuplicate(menu.tabId);
              setMenu(null);
            }}
          >
            Duplicate
          </button>
          <button
            onClick={() => {
              actions.tabsTogglePin(menu.tabId);
              setMenu(null);
            }}
          >
            {menuTab.pinned ? 'Unpin tab' : 'Pin tab'}
          </button>
          <button
            onClick={() => {
              actions.tabsToggleMute(menu.tabId);
              setMenu(null);
            }}
          >
            {menuTab.muted ? 'Unmute tab' : 'Mute tab'}
          </button>
          <div className="tab-menu-sep" />
          <button
            onClick={() => {
              actions.tabsCloseOthers(menu.tabId);
              setMenu(null);
            }}
          >
            Close other tabs
          </button>
          <button
            onClick={() => {
              actions.tabsClose(menu.tabId);
              setMenu(null);
            }}
          >
            Close tab
          </button>
        </div>
      )}
    </div>
  );
}
