import { useEffect, useState } from 'react';
import { ArchiveView } from './components/ArchiveView';
import { ConnectionsView } from './components/ConnectionsView';
import { InboxView } from './components/InboxView';
import { useHuginn } from './useHuginn';

type Tab = 'inbox' | 'archive' | 'connections';

const TABS: { id: Tab; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'archive', label: 'Archive' },
  { id: 'connections', label: 'Connections' },
];

const tabFromHash = (): Tab => {
  const hash = window.location.hash.replace('#', '');

  return TABS.some((t) => t.id === hash) ? (hash as Tab) : 'inbox';
};

export const App = () => {
  const { open, closed, connections, kinds, live, error, refresh, applyItem } = useHuginn();
  const [tab, setTab] = useState<Tab>(tabFromHash);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());

    window.addEventListener('hashchange', onHash);

    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.title = open.length > 0 ? `(${open.length}) Huginn` : 'Huginn';
  }, [open.length]);

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
              {t.id === 'inbox' && open.length > 0 && <span className="count">{open.length}</span>}
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
        {tab === 'connections' && (
          <ConnectionsView connections={connections} kinds={kinds} onChanged={refresh} />
        )}
      </main>
    </div>
  );
};
