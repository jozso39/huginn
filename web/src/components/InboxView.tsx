import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type {
  Category,
  Connection,
  ConnectorCapabilities,
  ConnectorDescriptor,
  Item,
  Verdict,
} from '../api.types';
import { CONNECTOR_META } from '../connectorMeta';
import { ThreadCard } from './ThreadCard';

interface InboxViewProps {
  items: Item[];
  connections: Connection[];
  kinds: ConnectorDescriptor[];
  onChanged: (item: Item) => void;
}

type Filter = 'Inbox' | Category;

const FILTERS: { id: Filter; label: string; categories: Category[] }[] = [
  { id: 'Inbox', label: 'Inbox', categories: ['Important', 'Undecided'] },
  { id: 'Important', label: 'Important', categories: ['Important'] },
  { id: 'Undecided', label: 'Undecided', categories: ['Undecided'] },
  { id: 'Spam', label: 'Spam', categories: ['Spam'] },
];

const NONE: ConnectorCapabilities = { reply: false, draft: false, react: false, ack: false };
const RANK: Record<Category, number> = { Important: 0, Undecided: 1, Spam: 2 };
const EXPANDED_KEY = 'huginn.expandedGroups';

interface Thread {
  key: string;
  items: Item[];
}

interface Group {
  name: string;
  connections: Connection[];
  threads: Thread[];
  important: number;
}

const threadKeyOf = (item: Item) => `${item.connectionId}:${item.threadKey}`;

/** Items arrive newest first, so a thread's first item is its newest. */
const groupByThread = (items: Item[]): Thread[] =>
  [...new Set(items.map(threadKeyOf))].map((key) => ({
    key,
    items: items.filter((item) => threadKeyOf(item) === key),
  }));

/** Important threads first, then by recency (which the list already has). */
const byImportance = (a: Thread, b: Thread) =>
  RANK[a.items[0]?.category ?? 'Undecided'] - RANK[b.items[0]?.category ?? 'Undecided'];

const groupNameOf = (connection: Connection | undefined) =>
  connection?.groupName ?? connection?.name ?? 'Unknown source';

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);

/** Per-browser convenience; a private window simply starts all collapsed. */
const loadExpanded = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
};

const saveExpanded = (expanded: Set<string>) => {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
  } catch {
    // Storage unavailable: collapse state just is not remembered.
  }
};

export const InboxView = ({ items, connections, kinds, onChanged }: InboxViewProps) => {
  const [filter, setFilter] = useState<Filter>('Inbox');
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [cursor, setCursor] = useState(0);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<{ key: string; verdict: Verdict } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Long enough to read a sentence about the rule that changed.
  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timer = setTimeout(() => setToast(null), 8000);

    return () => clearTimeout(timer);
  }, [toast]);

  const connectionById = useMemo(() => new Map(connections.map((c) => [c.id, c])), [connections]);
  const capabilitiesOf = (connection: Connection | undefined): ConnectorCapabilities =>
    kinds.find((kind) => kind.kind === connection?.kind)?.capabilities ?? NONE;

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((f) => [f.id, items.filter((i) => f.categories.includes(i.category)).length])
      ) as Record<Filter, number>,
    [items]
  );

  const groups = useMemo((): Group[] => {
    const categories = FILTERS.find((f) => f.id === filter)?.categories ?? [];
    const visible = items.filter((item) => categories.includes(item.category));
    const names = [
      ...new Set(visible.map((item) => groupNameOf(connectionById.get(item.connectionId)))),
    ];

    const built = names.map((name): Group => {
      const threads = [
        ...groupByThread(
          visible.filter((item) => groupNameOf(connectionById.get(item.connectionId)) === name)
        ),
      ].sort(byImportance);

      return {
        name,
        connections: connections.filter((c) => groupNameOf(c) === name),
        threads,
        important: threads.filter((t) => t.items[0]?.category === 'Important').length,
      };
    });

    // Groups with something important first, then alphabetical: stable, predictable.
    return [...built].sort(
      (a, b) => Number(b.important > 0) - Number(a.important > 0) || a.name.localeCompare(b.name)
    );
  }, [items, filter, connections, connectionById]);

  // Keyboard navigation walks the threads of the open groups only.
  const navigable = useMemo(
    () => groups.filter((g) => expanded.has(g.name)).flatMap((g) => g.threads),
    [groups, expanded]
  );
  const selected = Math.min(cursor, Math.max(navigable.length - 1, 0));
  const selectedKey = navigable[selected]?.key;

  const toggle = (name: string) => {
    const next = new Set(
      expanded.has(name) ? [...expanded].filter((open) => open !== name) : [...expanded, name]
    );

    setExpanded(next);
    saveExpanded(next);
  };

  const closeReply = useCallback(() => setReplyFor(null), []);
  const closeFeedback = useCallback(() => setFeedbackFor(null), []);

  // j/k move, r reply, e done, i/s important/spam, o open in the source app.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const thread = navigable[selected];

      if (event.key === 'j') {
        setCursor(Math.min(selected + 1, navigable.length - 1));
      } else if (event.key === 'k') {
        setCursor(Math.max(selected - 1, 0));
      } else if (event.key === 'e' && thread) {
        void Promise.all(thread.items.map((i) => api.done(i.id))).then((done) =>
          done.forEach(onChanged)
        );
      } else if (event.key === 'r' && thread) {
        event.preventDefault();
        setReplyFor(thread.key);
      } else if ((event.key === 'i' || event.key === 's') && thread) {
        event.preventDefault();
        setFeedbackFor({ key: thread.key, verdict: event.key === 'i' ? 'Important' : 'Spam' });
      } else if (event.key === 'o' && thread?.items[0]?.url) {
        window.open(thread.items[0].url, '_blank', 'noopener');
      }
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [navigable, selected, onChanged]);

  return (
    <section>
      <nav className="sources" aria-label="Filter by category">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={filter === f.id ? 'chip chip--on' : 'chip'}
            onClick={() => setFilter(f.id)}
          >
            {f.label} <span className="count">{counts[f.id]}</span>
          </button>
        ))}
      </nav>

      {groups.length === 0 ? (
        <div className="empty">
          <p className="empty__title">{filter === 'Spam' ? 'No spam.' : 'Nothing waiting.'}</p>
          <p className="muted">
            New messages appear here the moment a connection picks them up.
            {connections.length === 0 && ' Start by adding a connection.'}
          </p>
        </div>
      ) : (
        <div className="groups">
          {groups.map((group) => {
            const open = expanded.has(group.name);

            return (
              <section key={group.name} className={open ? 'group group--open' : 'group'}>
                <button
                  type="button"
                  className="group__head"
                  aria-expanded={open}
                  onClick={() => toggle(group.name)}
                >
                  <span className="group__chevron" aria-hidden>
                    ▸
                  </span>
                  <span className="group__badges">
                    {[...new Set(group.connections.map((c) => c.kind))].map((kind) => (
                      <span
                        key={kind}
                        className="badge badge--small"
                        style={{ background: CONNECTOR_META[kind].color }}
                      >
                        {CONNECTOR_META[kind].glyph}
                      </span>
                    ))}
                  </span>
                  <span className="group__name">{group.name}</span>
                  <span className="spacer" />
                  {group.important > 0 && filter !== 'Important' && (
                    <span className="count count--important">{group.important} important</span>
                  )}
                  <span className="count">{group.threads.length} waiting</span>
                </button>
                {open && (
                  <div className="threads">
                    {group.threads.map((thread) => {
                      const connection = connectionById.get(thread.items[0]?.connectionId ?? '');

                      return (
                        <ThreadCard
                          key={thread.key}
                          items={thread.items}
                          connection={connection}
                          capabilities={capabilitiesOf(connection)}
                          selected={thread.key === selectedKey}
                          replying={replyFor === thread.key}
                          onStartReply={() => setReplyFor(thread.key)}
                          onCloseReply={closeReply}
                          feedback={feedbackFor?.key === thread.key ? feedbackFor.verdict : null}
                          onStartFeedback={(verdict) =>
                            setFeedbackFor({ key: thread.key, verdict })
                          }
                          onCloseFeedback={closeFeedback}
                          onSelect={() =>
                            setCursor(navigable.findIndex((t) => t.key === thread.key))
                          }
                          onChanged={onChanged}
                          onNotice={setToast}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
      <p className="hint muted">
        <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>r</kbd> reply · <kbd>e</kbd> done · <kbd>i</kbd>{' '}
        important · <kbd>s</kbd> spam · <kbd>o</kbd> open in source
      </p>
    </section>
  );
};
