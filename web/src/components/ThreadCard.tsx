import type { KeyboardEvent } from 'react';
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
import { KIND_LABEL, metaOf, relativeTime } from '../connectorMeta';
import { ConnectorIcon } from './ConnectorIcon';
import { itemLink, MOD, openLinkProps } from '../openLink';
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
  /** Owned by the inbox so the R shortcut and the button open the same box. */
  replying: boolean;
  onStartReply: () => void;
  onCloseReply: () => void;
  /** Also owned by the inbox, for the I / S shortcuts. */
  feedback: Verdict | null;
  onStartFeedback: (verdict: Verdict) => void;
  onCloseFeedback: () => void;
  onSelect: () => void;
  /** Closes the whole thread (the inbox hides it at once, like the D shortcut). */
  onDone: () => void;
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
  onDone,
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

  // Into view when selected; a card taller than the pane from its top, to be read.
  useEffect(() => {
    const card = cardRef.current;

    if (!selected || !card) {
      return;
    }

    const pane = card.closest('.pane');
    const tall = pane !== null && card.offsetHeight > pane.clientHeight;

    card.scrollIntoView({ block: tall ? 'start' : 'nearest' });
  }, [selected]);

  useEffect(() => {
    if (replying) {
      textRef.current?.focus();
    }
  }, [replying]);

  if (!latest) {
    return null;
  }

  const meta = metaOf(connection?.kind);
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

  const react = (emoji: string) =>
    run(async () => {
      const item = await api.react(latest.id, emoji);

      setNotice(`Reacted with ${emoji}.`);

      return item;
    });

  const backToList = () =>
    cardRef.current?.closest<HTMLElement>('.pane')?.focus({ preventScroll: true });

  // E puts the keyboard on the reactions: ← → choose, ↵ (or 1–9) reacts, Esc goes back.
  const onEmojiKey = (event: KeyboardEvent<HTMLSpanElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll('button')];
    const at = buttons.findIndex((button) => button === document.activeElement);
    const digit = Number(event.key);
    const chosen =
      event.key === 'Enter' || event.key === ' '
        ? reactions[at]
        : digit >= 1 && digit <= 9
          ? reactions[digit - 1]
          : undefined;

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      buttons[
        (at + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
      ]?.focus();
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      backToList();
    } else if (chosen) {
      event.preventDefault();
      event.stopPropagation();
      backToList();
      void react(chosen);
    }
  };

  return (
    <article
      ref={cardRef}
      className={`thread${selected ? ' thread--selected' : ''}`}
      style={tint(connection?.color)}
      onClick={onSelect}
    >
      <header className="thread__head">
        <ConnectorIcon kind={connection?.kind} href={link} />
        <div className="thread__titles">
          <h3 className="thread__title">
            <StatusPill status={latest.status} />
            {link ? (
              <a
                className="thread__title-link"
                {...openLinkProps(link)}
                title={`Open in ${meta.label} (${MOD}↵)`}
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
          <button type="button" onClick={() => onStartReply()} disabled={busy} title="Reply (R)">
            Reply
          </button>
        )}
        {capabilities.react && reactions.length > 0 && (
          <span className="emoji-row" onKeyDown={onEmojiKey}>
            {reactions.map((emoji, index) => (
              <button
                key={emoji}
                type="button"
                className="emoji"
                aria-label={`React with ${emoji}`}
                title={index < 9 ? `React with ${emoji} (E, then ${index + 1})` : undefined}
                disabled={busy}
                onClick={() => void react(emoji)}
              >
                {emoji}
              </button>
            ))}
            <span className="emoji-row__hint">← → choose · ↵ react · Esc back</span>
          </span>
        )}
        <span className="spacer" />
        {!feedback && latest.category !== 'Important' && (
          <button
            type="button"
            onClick={() => onStartFeedback('Important')}
            disabled={busy}
            title="Important (I)"
          >
            Important
          </button>
        )}
        {!feedback && latest.category !== 'Spam' && (
          <button
            type="button"
            onClick={() => onStartFeedback('Spam')}
            disabled={busy}
            title="Spam (S)"
          >
            Spam
          </button>
        )}
        <button type="button" onClick={onDone} disabled={busy} title="Done (D)">
          Done
        </button>
      </footer>

      {notice && <p className="muted small">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </article>
  );
};
