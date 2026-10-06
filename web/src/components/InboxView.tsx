import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type {
  Category,
  Connection,
  ConnectionGroup,
  ConnectorCapabilities,
  ConnectorDescriptor,
  Item,
  Verdict,
} from '../api.types';
import { ThreadCard } from './ThreadCard';
import { ConnectorIcon } from './ConnectorIcon';

interface InboxViewProps {
  items: Item[];
  connections: Connection[];
  kinds: ConnectorDescriptor[];
  /** Categories: connections in one share a section. */
  groups: ConnectionGroup[];
  /** The quick reactions chosen in Settings, in order ("👍"). */
  reactions: string[];
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
// Keyed by category or connection id, so renaming one keeps it open.
const EXPANDED_KEY = 'huginn.openSections';

interface Thread {
  key: string;
  items: Item[];
}

interface Group {
  /** `g:<category id>`, or `c:<connection id>` for one without a category. */
  key: string;
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

/** Where a connection is shown: its category's section, or a section of its own. */
const sectionOf = (
  connection: Connection | undefined,
  groupById: Map<string, ConnectionGroup>
): { key: string; name: string } => {
  const group = connection?.groupId ? groupById.get(connection.groupId) : undefined;

  if (group) {
    return { key: `g:${group.id}`, name: group.name };
  }

  return { key: `c:${connection?.id ?? 'unknown'}`, name: connection?.name ?? 'Unknown source' };
};

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

export const InboxView = ({
  items,
  connections,
  kinds,
  groups,
  reactions,
  onChanged,
}: InboxViewProps) => {
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
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const capabilitiesOf = (connection: Connection | undefined): ConnectorCapabilities =>
    kinds.find((kind) => kind.kind === connection?.kind)?.capabilities ?? NONE;

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((f) => [f.id, items.filter((i) => f.categories.includes(i.category)).length])
      ) as Record<Filter, number>,
    [items]
  );

  const sections = useMemo((): Group[] => {
    const categories = FILTERS.find((f) => f.id === filter)?.categories ?? [];
    const visible = items.filter((item) => categories.includes(item.category));
    const sectionOfItem = (item: Item) =>
      sectionOf(connectionById.get(item.connectionId), groupById);
    const sections = [
      ...new Map(visible.map((item) => [sectionOfItem(item).key, sectionOfItem(item)])).values(),
    ];

    const built = sections.map(({ key, name }): Group => {
      const threads = [
        ...groupByThread(visible.filter((item) => sectionOfItem(item).key === key)),
      ].sort(byImportance);

      return {
        key,
        name,
        connections: connections.filter((c) => sectionOf(c, groupById).key === key),
        threads,
        important: threads.filter((t) => t.items[0]?.category === 'Important').length,
      };
    });

    // Groups with something important first, then alphabetical: stable, predictable.
    return [...built].sort(
      (a, b) => Number(b.important > 0) - Number(a.important > 0) || a.name.localeCompare(b.name)
    );
  }, [items, filter, connections, connectionById, groupById]);

  // Keyboard navigation walks the threads of the open groups only.
  const navigable = useMemo(
    () => sections.filter((g) => expanded.has(g.key)).flatMap((g) => g.threads),
    [sections, expanded]
  );
  const selected = Math.min(cursor, Math.max(navigable.length - 1, 0));
  const selectedKey = navigable[selected]?.key;

  const toggle = (key: string) => {
    const next = new Set(
      expanded.has(key) ? [...expanded].filter((open) => open !== key) : [...expanded, key]
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
      } else if (event.key === 'o' && thread?.items[0]?.appUrl) {
        // An app link replaces nothing: the browser hands it to the app and stays here.
        window.location.assign(thread.items[0].appUrl);
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

      {sections.length === 0 ? (
        <div className="empty">
          <p className="empty__title">{filter === 'Spam' ? 'No spam.' : 'Nothing waiting.'}</p>
          <p className="muted">
            New messages appear here the moment a connection picks them up.
            {connections.length === 0 && ' Start by adding a connection.'}
          </p>
        </div>
      ) : (
        <div className="groups">
          {sections.map((group) => {
            const open = expanded.has(group.key);

            return (
              <section key={group.key} className={open ? 'group group--open' : 'group'}>
                <button
                  type="button"
                  className="group__head"
                  aria-expanded={open}
                  onClick={() => toggle(group.key)}
                >
                  <span className="group__chevron" aria-hidden>
                    ▸
                  </span>
                  <span className="group__badges">
                    {[...new Set(group.connections.map((c) => c.kind))].map((kind) => (
                      <ConnectorIcon key={kind} kind={kind} small />
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
                          reactions={reactions}
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
