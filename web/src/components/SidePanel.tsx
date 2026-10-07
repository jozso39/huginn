import type { FocusEvent, RefObject } from 'react';
import { useEffect, useRef } from 'react';
import type { Category, ConnectorKind } from '../api.types';
import { tint } from '../colors';
import type { SideCategory, Thread } from '../inboxModel';
import { previewOf, shortTime } from '../inboxModel';
import { ConnectorIcon } from './ConnectorIcon';

interface SidePanelProps {
  categories: SideCategory[];
  folded: ReadonlySet<Category>;
  /** The selected conversation, when the panel lists it. */
  selected: Thread | undefined;
  /** The panel has the keyboard: ↑ ↓ walk it. */
  focused: boolean;
  listRef: RefObject<HTMLDivElement | null>;
  onToggle: (category: Category) => void;
  /** A click: show the conversation in the inbox. */
  onPick: (thread: Thread) => void;
  onFocusChange: (focused: boolean) => void;
}

const rowId = (thread: Thread) => `side-${thread.items[0]?.id ?? thread.key}`;

const Row = ({
  thread,
  kind,
  selected,
  onPick,
}: {
  thread: Thread;
  kind: ConnectorKind | undefined;
  selected: boolean;
  onPick: (thread: Thread) => void;
}) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const [latest] = thread.items;

  useEffect(() => {
    if (selected) {
      rowRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

  if (!latest) {
    return null;
  }

  const { place, subject, text } = previewOf(latest, kind);

  return (
    <div
      ref={rowRef}
      id={rowId(thread)}
      role="option"
      aria-selected={selected}
      className={selected ? 'side-row side-row--on' : 'side-row'}
      onClick={() => onPick(thread)}
    >
      <div className="side-row__top">
        <span className="side-row__author">{latest.author}</span>
        {thread.items.length > 1 && <span className="side-row__count">{thread.items.length}</span>}
        {place && <span className="side-row__place">{place}</span>}
        <time
          className="side-row__time"
          dateTime={latest.receivedAt}
          title={new Date(latest.receivedAt).toLocaleString()}
        >
          {shortTime(latest.receivedAt)}
        </time>
      </div>
      {subject && <div className="side-row__subject">{subject}</div>}
      {text && <div className="side-row__text">{text}</div>}
    </div>
  );
};

/**
 * Everything waiting, at a glance: Important, Undecided and (folded) Spam, each by
 * connection, every conversation with its first lines. A click shows it in the inbox.
 */
export const SidePanel = ({
  categories,
  folded,
  selected,
  focused,
  listRef,
  onToggle,
  onPick,
  onFocusChange,
}: SidePanelProps) => {
  // Closed while it had the keyboard: it no longer has it.
  useEffect(() => () => onFocusChange(false), [onFocusChange]);

  const leaves = (event: FocusEvent) =>
    !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget));
  const empty = categories.every((c) => c.threads.length === 0);

  return (
    <aside
      className={focused ? 'side side--focused' : 'side'}
      aria-label="Waiting messages"
      onFocus={() => onFocusChange(true)}
      onBlur={(event) => leaves(event) && onFocusChange(false)}
    >
      <div
        ref={listRef}
        className="side__list"
        role="listbox"
        aria-label="Waiting messages"
        tabIndex={0}
        aria-activedescendant={selected ? rowId(selected) : undefined}
      >
        {categories.map(({ category, connections, threads }) => {
          const open = !folded.has(category);

          return (
            <div key={category} role="group" aria-label={category} className="side-cat">
              <button
                type="button"
                tabIndex={-1}
                className="side-cat__head"
                aria-expanded={open}
                onClick={() => onToggle(category)}
              >
                <span className="side-cat__chevron" aria-hidden>
                  ▸
                </span>
                <span className="side-cat__name">{category}</span>
                <span
                  className={
                    category === 'Important' && threads.length > 0
                      ? 'count count--important'
                      : 'count'
                  }
                >
                  {threads.length}
                </span>
              </button>
              {open &&
                connections.map(({ id, connection, threads: waiting }) => (
                  <div key={id} className="side-conn" style={tint(connection?.color)}>
                    <div className="side-conn__head">
                      <ConnectorIcon kind={connection?.kind} small />
                      <span className="side-conn__name">
                        {connection?.name ?? 'Unknown source'}
                      </span>
                    </div>
                    {waiting.map((thread) => (
                      <Row
                        key={thread.key}
                        thread={thread}
                        kind={connection?.kind}
                        selected={thread === selected}
                        onPick={onPick}
                      />
                    ))}
                  </div>
                ))}
            </div>
          );
        })}
        {empty && <p className="side__empty muted">Nothing waiting.</p>}
      </div>
    </aside>
  );
};
