import { useCallback, useEffect, useState } from 'react';
import { ArchiveView } from './components/ArchiveView';
import { InboxView } from './components/InboxView';
import { RulesView } from './components/RulesView';
import { SettingsView } from './components/SettingsView';
import { MOD } from './openLink';
import { applyTheme } from './theme';
import { useHuginn } from './useHuginn';

type Tab = 'inbox' | 'archive' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'archive', label: 'Archive' },
  { id: 'settings', label: 'Settings' },
];

interface Route {
  tab: Tab;
  /** #rules/<connectionId> opens that connection's rules under Settings. */
  rulesFor: string | null;
  /** #settings/categories: when it was asked for, so asking again is a new request. */
  categoriesAt: number | null;
}

const SIDE_KEY = 'huginn.sidePanel';

/** Open unless closed before; on a phone-sized screen it starts closed (it covers the inbox). */
const loadSideOpen = (): boolean => {
  try {
    const stored = localStorage.getItem(SIDE_KEY);

    return stored ? stored === 'open' : !window.matchMedia('(max-width: 760px)').matches;
  } catch {
    return true;
  }
};

const SidePanelIcon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
    <rect
      x="2.75"
      y="3.75"
      width="14.5"
      height="12.5"
      rx="2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path d="M7.75 3.75v12.5" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const routeFromHash = (): Route => {
  const hash = window.location.hash.replace('#', '');

  if (hash.startsWith('rules/')) {
    return { tab: 'settings', rulesFor: hash.slice('rules/'.length), categoriesAt: null };
  }

  if (hash === 'settings/categories') {
    return { tab: 'settings', rulesFor: null, categoriesAt: Date.now() };
  }

  // #connections is where Settings lived before it had more than connections.
  const tab = hash === 'connections' ? 'settings' : TABS.find((t) => t.id === hash)?.id;

  return { tab: tab ?? 'inbox', rulesFor: null, categoriesAt: null };
};

export const App = () => {
  const {
    open,
    closed,
    connections,
    kinds,
    groups,
    settings,
    ai,
    live,
    error,
    refresh,
    applyItem,
    saveSettings,
    createGroup,
    saveAiKey,
    removeAiKey,
  } = useHuginn();
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [sideOpen, setSideOpen] = useState(loadSideOpen);
  const { tab, rulesFor } = route;
  const rulesConnection = connections.find((c) => c.id === rulesFor);
  const theme = settings?.theme;

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());

    window.addEventListener('hashchange', onHash);

    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (theme) {
      applyTheme(theme);
    }
  }, [theme]);

  const reactions = settings?.quickReactions ?? [];

  // The tab title counts what needs you: important items, not everything waiting.
  const importantCount = open.filter((item) => item.category === 'Important').length;

  useEffect(() => {
    document.title = importantCount > 0 ? `(${importantCount}) Huginn` : 'Huginn';

    // Installed as an app, the dock / taskbar icon carries the same count.
    const badge = navigator as Navigator & {
      setAppBadge?: (count: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };

    if (importantCount > 0) {
      void badge.setAppBadge?.(importantCount).catch(() => undefined);
    } else {
      void badge.clearAppBadge?.().catch(() => undefined);
    }
  }, [importantCount]);

  const failing = connections.filter((c) => c.status === 'Error');

  const openSide = useCallback((open: boolean) => {
    setSideOpen(open);

    try {
      localStorage.setItem(SIDE_KEY, open ? 'open' : 'closed');
    } catch {
      // Storage unavailable: it just is not remembered.
    }
  }, []);

  // At once, not on the hashchange: the inbox must be showing when ⌘B / ⌘X focus it.
  const showInbox = useCallback(() => {
    setRoute({ tab: 'inbox', rulesFor: null, categoriesAt: null });
    window.location.assign('#inbox');
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <button
          type="button"
          className="icon-button topbar__side"
          aria-label={sideOpen ? 'Hide the side panel' : 'Show the side panel'}
          aria-pressed={sideOpen}
          title={`Side panel (${MOD}B)`}
          hidden={tab !== 'inbox'}
          onClick={() => openSide(!sideOpen)}
        >
          <SidePanelIcon />
        </button>
        <div className="brand">
          <img src="/logo.png" alt="" width={30} height={30} />
          <span>Huginn</span>
        </div>
        <nav className="topbar__tabs">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} className={tab === t.id ? 'tab tab--on' : 'tab'}>
              {t.label}
              {t.id === 'inbox' && importantCount > 0 && (
                <span className="count count--important">{importantCount}</span>
              )}
              {t.id === 'settings' && failing.length > 0 && (
                <span className="count count--bad">{failing.length}</span>
              )}
            </a>
          ))}
        </nav>
        <span className={live ? 'live live--on' : 'live'} title={live ? 'Live' : 'Reconnecting…'} />
      </header>

      {error && <p className="banner error">Cannot reach the server: {error}</p>}

      <div className="workspace">
        <InboxView
          visible={tab === 'inbox'}
          items={open}
          connections={connections}
          kinds={kinds}
          groups={groups}
          reactions={reactions}
          sideOpen={sideOpen}
          onSideOpen={openSide}
          onShow={showInbox}
          onChanged={applyItem}
        />
        {tab !== 'inbox' && (
          <main className="pane">
            <div className="page">
              {tab === 'archive' && (
                <ArchiveView items={closed} connections={connections} onChanged={applyItem} />
              )}
              {tab === 'settings' && rulesConnection && (
                <RulesView connection={rulesConnection} hasAiKey={ai !== null} />
              )}
              {tab === 'settings' && !rulesConnection && (
                <SettingsView
                  connections={connections}
                  kinds={kinds}
                  groups={groups}
                  settings={settings}
                  ai={ai}
                  categoriesRequest={route.categoriesAt}
                  onChanged={refresh}
                  onCreateGroup={createGroup}
                  saveSettings={saveSettings}
                  onSaveAiKey={saveAiKey}
                  onRemoveAiKey={removeAiKey}
                />
              )}
            </div>
          </main>
        )}
      </div>
    </div>
  );
};
