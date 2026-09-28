import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Connection, Item } from '../api.types';
import { ThreadCard } from './ThreadCard';

interface InboxViewProps {
  items: Item[];
  connections: Connection[];
  onChanged: (item: Item) => void;
}

interface Thread {
  key: string;
  items: Item[];
}

const threadKeyOf = (item: Item) => `${item.connectionId}:${item.threadKey}`;

/**
 * Items arrive newest first, so thread order follows each thread's newest item
 * and the first item of every thread is its newest.
 */
const groupByThread = (items: Item[]): Thread[] =>
  [...new Set(items.map(threadKeyOf))].map((key) => ({
    key,
    items: items.filter((item) => threadKeyOf(item) === key),
  }));

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);

export const InboxView = ({ items, connections, onChanged }: InboxViewProps) => {
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [cursor, setCursor] = useState(0);
  const [replyFor, setReplyFor] = useState<string | null>(null);

  const filtered = useMemo(
    () => (sourceFilter === 'all' ? items : items.filter((i) => i.connectionId === sourceFilter)),
    [items, sourceFilter]
  );
  const threads = useMemo(() => groupByThread(filtered), [filtered]);
  const connectionById = useMemo(() => new Map(connections.map((c) => [c.id, c])), [connections]);
  const countBySource = useMemo(
    () =>
      new Map(
        [...new Set(items.map((i) => i.connectionId))].map((id) => [
          id,
          items.filter((i) => i.connectionId === id).length,
        ])
      ),
    [items]
  );

  const selected = Math.min(cursor, Math.max(threads.length - 1, 0));
  const closeReply = useCallback(() => setReplyFor(null), []);

  // j/k to move, e to mark done, r to reply, o to open in the source app.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const thread = threads[selected];

      if (event.key === 'j') {
        setCursor(Math.min(selected + 1, threads.length - 1));
      } else if (event.key === 'k') {
        setCursor(Math.max(selected - 1, 0));
      } else if (event.key === 'e' && thread) {
        void Promise.all(thread.items.map((i) => api.done(i.id))).then((done) =>
          done.forEach(onChanged)
        );
      } else if (event.key === 'r' && thread) {
        event.preventDefault();
        setReplyFor(thread.key);
      } else if (event.key === 'o' && thread?.items[0]?.url) {
        window.open(thread.items[0].url, '_blank', 'noopener');
      }
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [threads, selected, onChanged]);

  return (
    <section>
      <nav className="sources" aria-label="Filter by source">
        <button
          type="button"
          className={sourceFilter === 'all' ? 'chip chip--on' : 'chip'}
          onClick={() => setSourceFilter('all')}
        >
          All <span className="count">{items.length}</span>
        </button>
        {connections
          .filter((c) => countBySource.has(c.id))
          .map((c) => (
            <button
              key={c.id}
              type="button"
              className={sourceFilter === c.id ? 'chip chip--on' : 'chip'}
              onClick={() => setSourceFilter(c.id)}
            >
              {c.name} <span className="count">{countBySource.get(c.id)}</span>
            </button>
          ))}
      </nav>

      {threads.length === 0 ? (
        <div className="empty">
          <p className="empty__title">Nothing waiting.</p>
          <p className="muted">
            New messages appear here the moment a connection picks them up.
            {connections.length === 0 && ' Start by adding a connection.'}
          </p>
        </div>
      ) : (
        <div className="threads">
          {threads.map((thread, index) => (
            <ThreadCard
              key={thread.key}
              items={thread.items}
              connection={connectionById.get(thread.items[0]?.connectionId ?? '')}
              selected={index === selected}
              replying={replyFor === thread.key}
              onStartReply={() => setReplyFor(thread.key)}
              onCloseReply={closeReply}
              onSelect={() => setCursor(index)}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
      <p className="hint muted">
        <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>r</kbd> reply · <kbd>e</kbd> done · <kbd>o</kbd> open
        in source
      </p>
    </section>
  );
};
