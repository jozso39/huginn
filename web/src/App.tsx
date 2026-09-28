import { useEffect, useState } from 'react';
import { ArchiveView } from './components/ArchiveView';
import { ConnectionsView } from './components/ConnectionsView';
import { InboxView } from './components/InboxView';
import { RulesView } from './components/RulesView';
import { useHuginn } from './useHuginn';

type Tab = 'inbox' | 'archive' | 'connections';

const TABS: { id: Tab; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'archive', label: 'Archive' },
  { id: 'connections', label: 'Connections' },
];

interface Route {
  tab: Tab;
  /** #rules/<connectionId> opens that connection's rules under the Connections tab. */
  rulesFor: string | null;
}

const routeFromHash = (): Route => {
  const hash = window.location.hash.replace('#', '');

  if (hash.startsWith('rules/')) {
    return { tab: 'connections', rulesFor: hash.slice('rules/'.length) };
  }

  return { tab: TABS.some((t) => t.id === hash) ? (hash as Tab) : 'inbox', rulesFor: null };
};

export const App = () => {
  const { open, closed, connections, kinds, live, error, refresh, applyItem } = useHuginn();
  const [route, setRoute] = useState<Route>(routeFromHash);
  const { tab, rulesFor } = route;
  const rulesConnection = connections.find((c) => c.id === rulesFor);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());

    window.addEventListener('hashchange', onHash);

    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // The tab title counts what needs you: important items, not everything waiting.
  const importantCount = open.filter((item) => item.category === 'Important').length;

  useEffect(() => {
    document.title = importantCount > 0 ? `(${importantCount}) Huginn` : 'Huginn';
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
              {t.id === 'connections' && failing.length > 0 && (
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
          <InboxView items={open} connections={connections} kinds={kinds} onChanged={applyItem} />
        )}
        {tab === 'archive' && (
          <ArchiveView items={closed} connections={connections} onChanged={applyItem} />
        )}
        {tab === 'connections' && rulesConnection && <RulesView connection={rulesConnection} />}
        {tab === 'connections' && !rulesConnection && (
          <ConnectionsView connections={connections} kinds={kinds} onChanged={refresh} />
        )}
      </main>
    </div>
  );
};
