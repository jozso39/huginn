import { useState } from 'react';
import { api } from '../api';
import type { Action, Connection, Item } from '../api.types';
import { CONNECTOR_META, relativeTime } from '../connectorMeta';

interface ArchiveViewProps {
  items: Item[];
  connections: Connection[];
  onChanged: (item: Item) => void;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const describeAction = (action: Action): string => {
  switch (action.type) {
    case 'Reply':
      return `Replied: “${text(action.payload.text)}”`;
    case 'React':
      return `Reacted :${text(action.payload.emoji)}:`;
    case 'Done':
      return 'Marked done';
    case 'Synced':
      return 'Closed at the source';
    default:
      return action.type;
  }
};

/** Everything that left the inbox, with what was done about it. */
export const ArchiveView = ({ items, connections, onChanged }: ArchiveViewProps) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actions, setActions] = useState<Record<string, Action[]>>({});
  const connectionById = new Map(connections.map((c) => [c.id, c]));

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

  if (items.length === 0) {
    return (
      <div className="empty">
        <p className="empty__title">The archive is empty.</p>
        <p className="muted">Replied and done items land here.</p>
      </div>
    );
  }

  return (
    <ul className="archive">
      {items.map((item) => {
        const meta = CONNECTOR_META[connectionById.get(item.connectionId)?.kind ?? 'Ingest'];
        const itemActions = actions[item.id];

        return (
          <li key={item.id} className="archive__row">
            <button type="button" className="archive__summary" onClick={() => void toggle(item.id)}>
              <span className="badge badge--small" style={{ background: meta.color }}>
                {meta.glyph}
              </span>
              <span className="archive__title">{item.title}</span>
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
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      Open in {meta.label}
                    </a>
                  )}
                  <button type="button" onClick={() => void api.reopen(item.id).then(onChanged)}>
                    Move back to inbox
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};
