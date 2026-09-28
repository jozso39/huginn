import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Connection, Item } from '../api.types';
import { CONNECTOR_META, KIND_LABEL, QUICK_EMOJI, relativeTime } from '../connectorMeta';

interface ThreadCardProps {
  items: Item[];
  connection: Connection | undefined;
  selected: boolean;
  /** Owned by the inbox so the `r` shortcut and the button open the same box. */
  replying: boolean;
  onStartReply: () => void;
  onCloseReply: () => void;
  onSelect: () => void;
  onChanged: (item: Item) => void;
}

/**
 * One conversation: the newest item on top, earlier ones folded underneath.
 * Reply and emoji act on the newest item; Done closes the whole thread.
 */
export const ThreadCard = ({
  items,
  connection,
  selected,
  replying,
  onStartReply,
  onCloseReply,
  onSelect,
  onChanged,
}: ThreadCardProps) => {
  const [latest, ...earlier] = items;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (selected) {
      cardRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

  useEffect(() => {
    if (replying) {
      textRef.current?.focus();
    }
  }, [replying]);

  if (!latest) {
    return null;
  }

  const meta = CONNECTOR_META[connection?.kind ?? 'Ingest'];
  const canReply = connection?.kind !== 'Ingest';

  const run = async (action: () => Promise<Item | Item[]>) => {
    setBusy(true);
    setError(null);

    try {
      const result = await action();

      (Array.isArray(result) ? result : [result]).forEach(onChanged);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sendReply = () =>
    run(async () => {
      const item = await api.reply(latest.id, text.trim());

      setText('');
      onCloseReply();
      // The reply closed the newest item; the rest of the thread goes with it.
      const rest = await Promise.all(earlier.map((i) => api.done(i.id)));

      return [item, ...rest];
    });

  return (
    <article
      ref={cardRef}
      className={`thread${selected ? ' thread--selected' : ''}`}
      onClick={onSelect}
    >
      <header className="thread__head">
        {latest.url ? (
          <a
            className="badge"
            style={{ background: meta.color }}
            href={latest.url}
            target="_blank"
            rel="noreferrer"
            title={`Open in ${meta.label}`}
            onClick={(e) => e.stopPropagation()}
          >
            {meta.glyph}
          </a>
        ) : (
          <span className="badge" style={{ background: meta.color }} title={meta.label}>
            {meta.glyph}
          </span>
        )}
        <div className="thread__titles">
          <h3 className="thread__title">{latest.title}</h3>
          <p className="thread__meta">
            <span>{latest.author}</span>
            <span>·</span>
            <span>{KIND_LABEL[latest.kind]}</span>
            <span>·</span>
            <span>{connection?.name ?? 'unknown source'}</span>
            <span>·</span>
            <time dateTime={latest.receivedAt} title={new Date(latest.receivedAt).toLocaleString()}>
              {relativeTime(latest.receivedAt)}
            </time>
          </p>
        </div>
      </header>

      {latest.body && <p className="thread__body">{latest.body}</p>}

      {earlier.length > 0 && (
        <button
          type="button"
          className="linklike"
          onClick={(e) => {
            e.stopPropagation();
            setShowEarlier((v) => !v);
          }}
        >
          {showEarlier ? 'Hide' : 'Show'} {earlier.length} earlier in this thread
        </button>
      )}
      {showEarlier && (
        <ol className="thread__earlier">
          {earlier.map((item) => (
            <li key={item.id}>
              <strong>{item.author}</strong>{' '}
              <span className="muted">{relativeTime(item.receivedAt)}</span>
              {item.body && <p>{item.body}</p>}
            </li>
          ))}
        </ol>
      )}

      {replying && (
        <div className="reply" onClick={(e) => e.stopPropagation()}>
          <textarea
            ref={textRef}
            value={text}
            rows={3}
            placeholder={`Reply in ${meta.label}…  (⌘↵ to send, Esc to cancel)`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) {
                e.preventDefault();
                void sendReply();
              }

              if (e.key === 'Escape') {
                onCloseReply();
              }
            }}
          />
          <div className="reply__actions">
            <button type="button" onClick={() => onCloseReply()} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void sendReply()}
              disabled={busy || !text.trim()}
            >
              Send reply
            </button>
          </div>
        </div>
      )}

      <footer className="thread__actions" onClick={(e) => e.stopPropagation()}>
        {canReply && !replying && (
          <button type="button" onClick={() => onStartReply()} disabled={busy} title="r">
            Reply
          </button>
        )}
        {connection?.kind === 'Slack' && (
          <span className="emoji-row">
            {QUICK_EMOJI.map((emoji) => (
              <button
                key={emoji.name}
                type="button"
                className="emoji"
                title={`:${emoji.name}:`}
                disabled={busy}
                onClick={() => void run(() => api.react(latest.id, emoji.name))}
              >
                {emoji.char}
              </button>
            ))}
          </span>
        )}
        <span className="spacer" />
        <button
          type="button"
          onClick={() => void run(() => Promise.all(items.map((i) => api.done(i.id))))}
          disabled={busy}
          title="e"
        >
          Done
        </button>
      </footer>

      {error && <p className="error">{error}</p>}
    </article>
  );
};
