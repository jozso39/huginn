import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type {
  Connection,
  ConnectorCapabilities,
  Item,
  TriageDecision,
  Verdict,
} from '../api.types';
import { tint } from '../colors';
import { CONNECTOR_META, KIND_LABEL, relativeTime } from '../connectorMeta';
import { ConnectorIcon } from './ConnectorIcon';
import { itemLink, openLinkProps } from '../openLink';
import { MessageBody } from './MessageBody';
import { StatusPill } from './StatusPill';

interface ThreadCardProps {
  items: Item[];
  connection: Connection | undefined;
  /** What this source supports; the buttons follow it. */
  capabilities: ConnectorCapabilities;
  /** The quick reactions chosen in Settings, as emoji. */
  reactions: string[];
  selected: boolean;
  /** Owned by the inbox so the `r` shortcut and the button open the same box. */
  replying: boolean;
  onStartReply: () => void;
  onCloseReply: () => void;
  /** Also owned by the inbox, for the `i` / `s` shortcuts. */
  feedback: Verdict | null;
  onStartFeedback: (verdict: Verdict) => void;
  onCloseFeedback: () => void;
  onSelect: () => void;
  onChanged: (item: Item) => void;
  /** Messages that must outlive the card (it may leave the view after Spam). */
  onNotice: (message: string) => void;
}

/** One line on why the item is where it is. */
const whyText = (decision: TriageDecision | null): string => {
  if (!decision) {
    return 'Not sorted yet';
  }

  switch (decision.source) {
    case 'Rule':
      return `Rule “${decision.ruleName ?? '?'}”`;
    case 'User':
      return 'You put it here';
    case 'ClassifierUnavailable':
      return 'No rule matched (the classifier was unreachable)';
    case 'NoAiKey':
      return 'No rule matched; sentence rules are off without an AI key (Settings → AI Triage)';
    default:
      return 'No rule matched';
  }
};

/**
 * One conversation: the newest item on top, earlier ones folded underneath.
 * Reply and emoji act on the newest item; Done closes the whole thread.
 */
export const ThreadCard = ({
  items,
  connection,
  capabilities,
  reactions,
  selected,
  replying,
  onStartReply,
  onCloseReply,
  feedback,
  onStartFeedback,
  onCloseFeedback,
  onSelect,
  onChanged,
  onNotice,
}: ThreadCardProps) => {
  const [latest, ...earlier] = items;
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
  const link = itemLink(latest);

  const run = async (action: () => Promise<Item | Item[]>) => {
    setBusy(true);
    setError(null);
    setNotice(null);

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

  const sendFeedback = (verdict: Verdict) =>
    run(async () => {
      const result = await api.feedback(latest.id, verdict, reason);

      setReason('');
      onCloseFeedback();
      onNotice(result.message);

      return result.item;
    });

  // The item stays open: it is answered once the draft is actually sent.
  const saveDraft = () =>
    run(async () => {
      const item = await api.draft(latest.id, text.trim());

      setText('');
      onCloseReply();
      setNotice(`Draft saved in ${meta.label}.`);

      return item;
    });

  return (
    <article
      ref={cardRef}
      className={`thread${selected ? ' thread--selected' : ''}`}
      style={tint(connection?.color)}
      onClick={onSelect}
    >
      <header className="thread__head">
        <ConnectorIcon kind={connection?.kind ?? 'Ingest'} href={link} />
        <div className="thread__titles">
          <h3 className="thread__title">
            <StatusPill status={latest.status} />
            {link ? (
              <a
                className="thread__title-link"
                {...openLinkProps(link)}
                title={`Open in ${meta.label}`}
                onClick={(e) => e.stopPropagation()}
              >
                {latest.title}
              </a>
            ) : (
              latest.title
            )}
          </h3>
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
        <span
          className={`category category--${latest.category.toLowerCase()}`}
          title={whyText(latest.decision)}
        >
          {latest.category}
        </span>
      </header>
      <p className="why">{whyText(latest.decision)}</p>

      <MessageBody item={latest} connection={connection} />

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
              <MessageBody item={item} connection={connection} />
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
            {capabilities.draft && (
              <button
                type="button"
                onClick={() => void saveDraft()}
                disabled={busy || !text.trim()}
              >
                Save as draft
              </button>
            )}
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

      {feedback && (
        <form
          className="feedback"
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            void sendFeedback(feedback);
          }}
        >
          <label className="small">
            Why is this {feedback === 'Spam' ? 'spam' : 'important'}? Optional — with a reason,
            Huginn adjusts its rules so similar messages land here too.
            <textarea
              autoFocus
              rows={2}
              value={reason}
              placeholder={
                feedback === 'Spam' ? meta.spamExample : 'e.g. anything from my boss is important'
              }
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void sendFeedback(feedback);
                }

                if (e.key === 'Escape') {
                  onCloseFeedback();
                }
              }}
            />
          </label>
          <div className="reply__actions">
            <button type="button" onClick={onCloseFeedback} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Learning…' : feedback === 'Spam' ? 'Mark as spam' : 'Mark as important'}
            </button>
          </div>
        </form>
      )}

      <footer className="thread__actions" onClick={(e) => e.stopPropagation()}>
        {capabilities.reply && !replying && (
          <button type="button" onClick={() => onStartReply()} disabled={busy} title="r">
            Reply
          </button>
        )}
        {capabilities.react && (
          <span className="emoji-row">
            {reactions.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="emoji"
                aria-label={`React with ${emoji}`}
                disabled={busy}
                onClick={() => void run(() => api.react(latest.id, emoji))}
              >
                {emoji}
              </button>
            ))}
          </span>
        )}
        <span className="spacer" />
        {!feedback && latest.category !== 'Important' && (
          <button
            type="button"
            onClick={() => onStartFeedback('Important')}
            disabled={busy}
            title="i"
          >
            Important
          </button>
        )}
        {!feedback && latest.category !== 'Spam' && (
          <button type="button" onClick={() => onStartFeedback('Spam')} disabled={busy} title="s">
            Spam
          </button>
        )}
        <button
          type="button"
          onClick={() => void run(() => Promise.all(items.map((i) => api.done(i.id))))}
          disabled={busy}
          title="e"
        >
          Done
        </button>
      </footer>

      {notice && <p className="muted small">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </article>
  );
};
