import { useEffect, useState } from 'react';
import { ArchiveView } from './components/ArchiveView';
import { InboxView } from './components/InboxView';
import { RulesView } from './components/RulesView';
import { SettingsView } from './components/SettingsView';
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
    live,
    error,
    refresh,
    applyItem,
    saveSettings,
    createGroup,
  } = useHuginn();
  const [route, setRoute] = useState<Route>(routeFromHash);
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/logo.png" alt="" width={30} height={30} />
          <span>Huginn</span>
        </div>
        <nav className="tabs">
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

      <main className="content">
        {tab === 'inbox' && (
          <InboxView
            items={open}
            connections={connections}
            kinds={kinds}
            groups={groups}
            reactions={reactions}
            onChanged={applyItem}
          />
        )}
        {tab === 'archive' && (
          <ArchiveView items={closed} connections={connections} onChanged={applyItem} />
        )}
        {tab === 'settings' && rulesConnection && <RulesView connection={rulesConnection} />}
        {tab === 'settings' && !rulesConnection && (
          <SettingsView
            connections={connections}
            kinds={kinds}
            groups={groups}
            settings={settings}
            categoriesRequest={route.categoriesAt}
            onChanged={refresh}
            onCreateGroup={createGroup}
            saveSettings={saveSettings}
          />
        )}
      </main>
    </div>
  );
};
