import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type {
  Connection,
  ConnectionGroup,
  ConnectorDescriptor,
  HuginnEvent,
  Item,
  Settings,
} from './api.types';

export interface HuginnData {
  open: Item[];
  closed: Item[];
  connections: Connection[];
  kinds: ConnectorDescriptor[];
  /** Categories, alphabetical. */
  groups: ConnectionGroup[];
  /** Null until the first load. */
  settings: Settings | null;
  live: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  applyItem: (item: Item) => void;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  /** Makes a category (or finds the one with that name) and returns it. */
  createGroup: (name: string) => Promise<ConnectionGroup>;
}

const byNewest = (a: Item, b: Item) => b.receivedAt.localeCompare(a.receivedAt);

const upsertInto = (list: Item[], item: Item): Item[] =>
  [item, ...list.filter((existing) => existing.id !== item.id)].sort(byNewest);

/**
 * All dashboard state in one place: an initial fetch, then the SSE stream keeps
 * it current. Every item lives in exactly one of `open` / `closed`.
 */
export const useHuginn = (): HuginnData => {
  const [open, setOpen] = useState<Item[]>([]);
  const [closed, setClosed] = useState<Item[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [kinds, setKinds] = useState<ConnectorDescriptor[]>([]);
  const [groups, setGroups] = useState<ConnectionGroup[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyItem = useCallback((item: Item) => {
    const isOpen = item.state === 'Open';

    setOpen((list) => (isOpen ? upsertInto(list, item) : list.filter((i) => i.id !== item.id)));
    setClosed((list) => (isOpen ? list.filter((i) => i.id !== item.id) : upsertInto(list, item)));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [openItems, doneItems, conns, kindList, groupList, preferences] = await Promise.all([
        api.listItems('Open'),
        api.listItems('Done'),
        api.listConnections(),
        api.listKinds(),
        api.listGroups(),
        api.getSettings(),
      ]);

      setOpen(openItems);
      setClosed(doneItems);
      setConnections(conns);
      setKinds(kindList);
      setGroups(groupList);
      setSettings(preferences);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    // Shown at once; the server's answer settles it (and puts it back if refused).
    setSettings((current) => (current ? { ...current, ...patch } : current));

    try {
      setSettings(await api.saveSettings(patch));
    } catch (e) {
      setSettings(await api.getSettings());
      throw e;
    }
  }, []);

  const createGroup = useCallback(async (name: string) => {
    const group = await api.createGroup(name);

    setGroups(await api.listGroups());

    return group;
  }, []);

  useEffect(() => {
    // The initial load happens on `open`: the first connect and every reconnect
    // refetch, so nothing missed while the stream was down stays missing.
    const source = new EventSource('/api/events');
    const onEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as HuginnEvent;

      if (event.type === 'ConnectionChanged') {
        setConnections((list) =>
          list.some((c) => c.id === event.connection.id)
            ? list.map((c) => (c.id === event.connection.id ? event.connection : c))
            : [...list, event.connection]
        );

        return;
      }

      applyItem(event.item);
    };

    source.addEventListener('ItemUpserted', onEvent);
    source.addEventListener('ItemChanged', onEvent);
    source.addEventListener('ConnectionChanged', onEvent);
    // EventSource reconnects by itself; `open` fires again and refetches.
    source.addEventListener('error', () => setLive(false));
    source.addEventListener('open', () => {
      setLive(true);
      void refresh();
    });

    // Phones freeze background tabs and the stream silently dies with them; catch up
    // the moment the tab is visible again instead of waiting for the reconnect.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };

    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      source.close();
    };
  }, [refresh, applyItem]);

  return {
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
  };
};
