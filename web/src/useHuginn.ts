import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Connection, HuginnEvent, Item } from './api.types';

export interface HuginnData {
  open: Item[];
  closed: Item[];
  connections: Connection[];
  live: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  applyItem: (item: Item) => void;
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
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyItem = useCallback((item: Item) => {
    const isOpen = item.state === 'Open';

    setOpen((list) => (isOpen ? upsertInto(list, item) : list.filter((i) => i.id !== item.id)));
    setClosed((list) => (isOpen ? list.filter((i) => i.id !== item.id) : upsertInto(list, item)));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [openItems, doneItems, conns] = await Promise.all([
        api.listItems('Open'),
        api.listItems('Done'),
        api.listConnections(),
      ]);

      setOpen(openItems);
      setClosed(doneItems);
      setConnections(conns);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
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

    return () => source.close();
  }, [refresh, applyItem]);

  return { open, closed, connections, live, error, refresh, applyItem };
};
