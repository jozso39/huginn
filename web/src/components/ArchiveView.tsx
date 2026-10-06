import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Action, Connection, Item } from '../api.types';
import { tint } from '../colors';
import { CONNECTOR_META, relativeTime } from '../connectorMeta';
import { ConnectorIcon } from './ConnectorIcon';
import { StatusPill } from './StatusPill';

interface ArchiveViewProps {
  items: Item[];
  connections: Connection[];
  onChanged: (item: Item) => void;
}

// The newest matches; a query that finds more is better made narrower than paged.
const SEARCH_LIMIT = 200;
// Typing pauses this long before the archive is searched.
const SEARCH_DELAY_MS = 250;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const describeAction = (action: Action): string => {
  switch (action.type) {
    case 'Reply':
      return `Replied: “${text(action.payload.text)}”`;
    case 'React': {
      const emoji = text(action.payload.emoji);

      // Reactions used to be stored by Slack short name.
      return /^[a-z0-9_+:-]+$/.test(emoji) ? `Reacted :${emoji}:` : `Reacted ${emoji}`;
    }

    case 'Done':
      return 'Marked done';
    case 'Synced':
      return 'Closed at the source';
    default:
      return action.type;
  }
};

/** Everything that left the inbox, with what was done about it, and a search over all of it. */
export const ArchiveView = ({ items, connections, onChanged }: ArchiveViewProps) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actions, setActions] = useState<Record<string, Action[]>>({});
  const [query, setQuery] = useState('');
  // Results belong to the query they were found for; anything else is still searching.
  const [found, setFound] = useState<{ query: string; items: Item[] } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const connectionById = new Map(connections.map((c) => [c.id, c]));
  const wanted = query.trim().replace(/\s+/g, ' ');

  useEffect(() => {
    if (wanted === '') {
      return undefined;
    }

    // A later query or leaving the page makes this answer irrelevant.
    let current = true;
    const timer = setTimeout(() => {
      api
        .searchArchive(wanted, SEARCH_LIMIT)
        .then((matches) => {
          if (current) {
            setFound({ query: wanted, items: matches });
            setSearchError(null);
          }
        })
        .catch((e: unknown) => {
          if (current) {
            setSearchError(e instanceof Error ? e.message : String(e));
          }
        });
    }, SEARCH_DELAY_MS);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [wanted]);

  const toggle = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);

      return;
    }

    setExpanded(id);

    if (!actions[id]) {
      const detail = await api.getItem(id);

      setActions((current) => ({ ...current, [id]: detail.actions }));
    }
  };

  const reopen = async (id: string) => {
    const item = await api.reopen(id);

    onChanged(item);
    setFound((current) =>
      current ? { ...current, items: current.items.filter((i) => i.id !== id) } : current
    );
  };

  const searching = wanted !== '';
  const results = searching ? (found?.query === wanted ? found.items : null) : items;

  return (
    <section className="archive-view">
      <div className="archive-search">
        <svg
          className="archive-search__icon"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          aria-hidden
        >
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={query}
          placeholder="Search the archive: words from the title, sender or text"
          aria-label="Search the archive"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {searching && (
        <p className="archive-search__status muted small">
          {searchError ? (
            <span className="error">{searchError}</span>
          ) : results === null ? (
            'Searching…'
          ) : results.length === 0 ? (
            `Nothing in the archive matches “${wanted}”.`
          ) : results.length >= SEARCH_LIMIT ? (
            `The newest ${SEARCH_LIMIT} matches. Add a word to narrow it down.`
          ) : (
            `${results.length} ${results.length === 1 ? 'match' : 'matches'}`
          )}
        </p>
      )}

      {!searching && items.length === 0 && (
        <div className="empty">
          <p className="empty__title">The archive is empty.</p>
          <p className="muted">Replied and done items land here.</p>
        </div>
      )}

      {results && results.length > 0 && (
        <ul className="archive">
          {results.map((item) => {
            const connection = connectionById.get(item.connectionId);
            const meta = CONNECTOR_META[connection?.kind ?? 'Ingest'];
            const itemActions = actions[item.id];

            return (
              <li key={item.id} className="archive__row" style={tint(connection?.color)}>
                <button
                  type="button"
                  className="archive__summary"
                  onClick={() => void toggle(item.id)}
                >
                  <ConnectorIcon kind={connection?.kind ?? 'Ingest'} small />
                  <span className="archive__title">
                    <StatusPill status={item.status} />
                    {item.title}
                  </span>
                  <span className="muted">{item.author}</span>
                  <time className="muted" dateTime={item.stateChangedAt}>
                    {relativeTime(item.stateChangedAt)}
                  </time>
                </button>
                {expanded === item.id && (
                  <div className="archive__detail">
                    {item.body && <p className="thread__body">{item.body}</p>}
                    {itemActions === undefined ? (
                      <p className="muted">Loading…</p>
                    ) : itemActions.length === 0 ? (
                      <p className="muted">Closed at the source; no action taken here.</p>
                    ) : (
                      <ol className="actions-log">
                        {itemActions.map((action) => (
                          <li key={action.id}>
                            {describeAction(action)}{' '}
                            <span className="muted">{relativeTime(action.createdAt)}</span>
                            {action.result?.ok === false && (
                              <span className="error"> — failed: {text(action.result.error)}</span>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                    <div className="archive__buttons">
                      {item.appUrl ? (
                        <a href={item.appUrl}>Open in {meta.label}</a>
                      ) : (
                        item.url && (
                          <a href={item.url} target="_blank" rel="noreferrer">
                            Open in {meta.label}
                          </a>
                        )
                      )}
                      <button type="button" onClick={() => void reopen(item.id)}>
                        Move back to inbox
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
