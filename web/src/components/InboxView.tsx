import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
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
import { metaOf } from '../connectorMeta';
import type { Outline, Thread } from '../inboxModel';
import {
  counterpart,
  inboxSections,
  jumpTarget,
  resolveSelection,
  sectionOf,
  sidePanel,
  walkable,
} from '../inboxModel';
import { isMac, itemLink, MOD, openOutside } from '../openLink';
import { ConnectorIcon } from './ConnectorIcon';
import { SidePanel } from './SidePanel';
import { ThreadCard } from './ThreadCard';

interface InboxViewProps {
  /** Hidden while another tab is open; it stays mounted so nothing typed is lost. */
  visible: boolean;
  items: Item[];
  connections: Connection[];
  kinds: ConnectorDescriptor[];
  /** Categories: connections in one share a section. */
  groups: ConnectionGroup[];
  /** The quick reactions chosen in Settings, in order ("👍"). */
  reactions: string[];
  sideOpen: boolean;
  onSideOpen: (open: boolean) => void;
  /** Brings the inbox tab forward (⌘B and ⌘X work from every tab). */
  onShow: () => void;
  onChanged: (item: Item) => void;
}

type Filter = 'Inbox' | Category;
type Region = 'side' | 'center';

const FILTERS: { id: Filter; label: string; categories: Category[] }[] = [
  { id: 'Inbox', label: 'Inbox', categories: ['Important', 'Undecided'] },
  { id: 'Important', label: 'Important', categories: ['Important'] },
  { id: 'Undecided', label: 'Undecided', categories: ['Undecided'] },
  { id: 'Spam', label: 'Spam', categories: ['Spam'] },
];

const NONE: ConnectorCapabilities = { reply: false, draft: false, react: false, ack: false };
// Keyed by category or connection id, so renaming one keeps it open.
const EXPANDED_KEY = 'huginn.openSections';
const FOLDED_KEY = 'huginn.sidePanel.folded';

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (['TEXTAREA', 'INPUT', 'SELECT'].includes(target.tagName) || target.isContentEditable);

/** Per-browser conveniences; a private window simply starts with the defaults. */
const load = <T,>(key: string, fallback: T[]): Set<T> => {
  try {
    const stored = localStorage.getItem(key);

    return new Set(stored ? (JSON.parse(stored) as T[]) : fallback);
  } catch {
    return new Set(fallback);
  }
};

const save = <T,>(key: string, values: Set<T>) => {
  try {
    localStorage.setItem(key, JSON.stringify([...values]));
  } catch {
    // Storage unavailable: it just is not remembered.
  }
};

const flip = <T,>(set: ReadonlySet<T>, value: T, on: boolean): Set<T> =>
  new Set(on ? [...set, value] : [...set].filter((v) => v !== value));

/** Phones: the side panel covers the inbox, so it closes once something is picked. */
const narrow = () => window.matchMedia('(max-width: 760px)').matches;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const InboxView = ({
  visible,
  items,
  connections,
  kinds,
  groups,
  reactions,
  sideOpen,
  onSideOpen,
  onShow,
  onChanged,
}: InboxViewProps) => {
  const [filter, setFilter] = useState<Filter>('Inbox');
  const [expanded, setExpanded] = useState<Set<string>>(() => load<string>(EXPANDED_KEY, []));
  const [folded, setFolded] = useState<Set<Category>>(() => load<Category>(FOLDED_KEY, ['Spam']));
  // The selected conversation, by a message in it; `index` is its place in the list it
  // was picked from, where the selection stays when the conversation leaves (Done).
  const [selection, setSelection] = useState<{ id: string | null; index: number }>({
    id: null,
    index: 0,
  });
  const [sideFocused, setSideFocused] = useState(false);
  // Messages being closed: hidden at once, back if the server says no.
  const [closing, setClosing] = useState<ReadonlySet<string>>(new Set());
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<{ key: string; verdict: Verdict } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ region: Region; at: number } | null>(null);
  // A pick in the side panel scrolls its card to the top of the inbox.
  const [reveal, setReveal] = useState(0);
  const sideRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLElement>(null);

  // Long enough to read a sentence about the rule that changed.
  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timer = setTimeout(() => setToast(null), 8000);

    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (focusRequest) {
      (focusRequest.region === 'side' ? sideRef : centerRef).current?.focus({
        preventScroll: true,
      });
    }
  }, [focusRequest]);

  useEffect(() => {
    if (reveal > 0) {
      centerRef.current?.querySelector('.thread--selected')?.scrollIntoView({ block: 'start' });
    }
  }, [reveal]);

  const connectionById = useMemo(() => new Map(connections.map((c) => [c.id, c])), [connections]);
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const capabilitiesOf = (connection: Connection | undefined): ConnectorCapabilities =>
    kinds.find((kind) => kind.kind === connection?.kind)?.capabilities ?? NONE;

  const waiting = useMemo(() => items.filter((item) => !closing.has(item.id)), [items, closing]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((f) => [f.id, waiting.filter((i) => f.categories.includes(i.category)).length])
      ) as Record<Filter, number>,
    [waiting]
  );

  const sections = useMemo(() => {
    const categories = FILTERS.find((f) => f.id === filter)?.categories ?? [];

    return inboxSections(
      waiting.filter((item) => categories.includes(item.category)),
      connections,
      groups
    );
  }, [waiting, filter, connections, groups]);

  const side = useMemo(() => sidePanel(waiting, connections), [waiting, connections]);

  const centerOutline: Outline[] = sections.map((s) => ({
    key: s.key,
    threads: s.threads,
    open: expanded.has(s.key),
  }));
  const sideOutline: Outline[] = side.map((c) => ({
    key: c.category,
    threads: c.threads,
    open: !folded.has(c.category),
  }));
  const centerOrder = walkable(centerOutline);
  const sideOrder = walkable(sideOutline);

  // ↑ ↓ walk the panel that has the keyboard; both show the same selection.
  const region: Region = sideOpen && sideFocused ? 'side' : 'center';
  const outline = region === 'side' ? sideOutline : centerOutline;
  const order = region === 'side' ? sideOrder : centerOrder;
  // Until something is picked, the inbox's first conversation is the selected one, in
  // both panels: giving the side panel the keyboard does not move the selection.
  const anchor = selection.id ?? centerOrder[0]?.items[0]?.id ?? null;
  const at = resolveSelection(order, anchor, selection.index);
  const current = order[at];
  const centerSelected = counterpart(centerOrder, current);
  const sideSelected = counterpart(sideOrder, current);

  const requestFocus = (target: Region) => setFocusRequest({ region: target, at: Date.now() });

  const setSection = (key: string, open: boolean) => {
    const next = flip(expanded, key, open);

    setExpanded(next);
    save(EXPANDED_KEY, next);
  };

  const setCategory = (category: Category, open: boolean) => {
    const next = flip(folded, category, !open);

    setFolded(next);
    save(FOLDED_KEY, next);
  };

  const select = (thread: Thread, index: number) =>
    setSelection({ id: thread.items[0]?.id ?? null, index });

  /** The inbox follows the side panel: the right filter, the section open. */
  const showInCenter = (thread: Thread) => {
    const latest = thread.items[0];

    if (!latest) {
      return;
    }

    if (!FILTERS.find((f) => f.id === filter)?.categories.includes(latest.category)) {
      setFilter(latest.category === 'Spam' ? 'Spam' : 'Inbox');
    }

    const section = sectionOf(connectionById.get(latest.connectionId), groupById).key;

    if (!expanded.has(section)) {
      setSection(section, true);
    }
  };

  /** A click in the side panel (or ↵ there): the conversation, in the inbox, with the keyboard. */
  const pick = (thread: Thread) => {
    select(thread, sideOrder.indexOf(thread));
    showInCenter(thread);
    setReveal((n) => n + 1);
    requestFocus('center');

    if (narrow()) {
      onSideOpen(false);
    }
  };

  const step = (direction: 1 | -1) => {
    const index = at === -1 ? 0 : Math.min(Math.max(at + direction, 0), order.length - 1);
    const thread = order[index];

    if (thread) {
      select(thread, index);

      if (region === 'side') {
        showInCenter(thread);
      }
    }
  };

  const jump = (direction: 1 | -1) => {
    const target = jumpTarget(outline, current, direction);

    if (!target) {
      return;
    }

    if (region === 'side') {
      setCategory(target.part as Category, true);
      showInCenter(target.thread);
    } else {
      setSection(target.part, true);
    }

    const opened = outline.map((part) =>
      part.key === target.part ? { ...part, open: true } : part
    );

    select(target.thread, walkable(opened).indexOf(target.thread));
  };

  // Gone at once; the selection moves on to the next conversation.
  const markDone = (thread: Thread) => {
    const ids = thread.items.map((item) => item.id);

    setClosing((now) => new Set([...now, ...ids]));
    void Promise.allSettled(ids.map((id) => api.done(id))).then((results) => {
      results.forEach((result) => result.status === 'fulfilled' && onChanged(result.value));

      const failed = results.find((result) => result.status === 'rejected');

      if (failed) {
        setToast(`Could not mark it done: ${errorText(failed.reason)}`);
      }

      setClosing((now) => new Set([...now].filter((id) => !ids.includes(id))));
    });
  };

  const closeReply = () => {
    setReplyFor(null);
    requestFocus('center');
  };

  const closeFeedback = () => {
    setFeedbackFor(null);
    requestFocus('center');
  };

  /** Puts the keyboard in the selected card once it shows what was asked for. */
  const focusInCard = (selector: string) =>
    requestAnimationFrame(() =>
      centerRef.current?.querySelector<HTMLElement>(`.thread--selected ${selector}`)?.focus()
    );

  const act = (key: string, thread: Thread) => {
    const latest = thread.items[0];

    if (!latest) {
      return;
    }

    const connection = connectionById.get(latest.connectionId);
    const can = capabilitiesOf(connection);
    const source = metaOf(connection?.kind).label;

    if (key === 'r') {
      if (!can.reply) {
        setToast(`${source} messages cannot be answered from Huginn.`);

        return;
      }

      setReplyFor(thread.key);
      focusInCard('.reply textarea');
    } else if (key === 'e') {
      if (!can.react || reactions.length === 0) {
        setToast(
          can.react
            ? 'Choose your quick reactions in Settings first.'
            : `${source} has no reactions.`
        );

        return;
      }

      focusInCard('.emoji-row button');
    } else if (key === 'd') {
      markDone(thread);
    } else if (key === 'i' || key === 's') {
      setFeedbackFor({ key: thread.key, verdict: key === 'i' ? 'Important' : 'Spam' });
      focusInCard('.feedback textarea');
    }
  };

  const openCurrent = () => {
    const link = current?.items[0] ? itemLink(current.items[0]) : null;

    if (link) {
      openOutside(link);
    } else if (current) {
      setToast('This message has no link to open.');
    }
  };

  // ⌘B: to the side panel; from it, the panel closes; closed, it opens.
  const sidePanelKey = () => {
    if (!visible) {
      onShow();
      onSideOpen(true);
      requestFocus('side');
    } else if (!sideOpen) {
      onSideOpen(true);
      requestFocus('side');
    } else if (!sideFocused) {
      requestFocus('side');
    } else {
      onSideOpen(false);
      setSideFocused(false);
      requestFocus('center');
    }
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const mod = isMac ? event.metaKey : event.ctrlKey;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

    if (mod && !event.altKey && key === 'b') {
      event.preventDefault();
      sidePanelKey();

      return;
    }

    // Everything else leaves text fields alone (⌘X cuts, ⌘↵ sends).
    if (isTyping(event.target) || event.altKey) {
      return;
    }

    if (mod && key === 'x') {
      event.preventDefault();

      if (!visible) {
        onShow();
      }

      requestFocus('center');

      return;
    }

    if (!visible) {
      return;
    }

    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (event.shiftKey || (isMac && event.ctrlKey)) {
        return;
      }

      event.preventDefault();

      // Leaving a card's buttons (the reactions E chose): the keyboard goes back to the list.
      if (region === 'center' && document.activeElement !== centerRef.current) {
        centerRef.current?.focus({ preventScroll: true });
      }

      if (mod) {
        jump(key === 'ArrowDown' ? 1 : -1);
      } else {
        step(key === 'ArrowDown' ? 1 : -1);
      }

      return;
    }

    if (mod && key === 'Enter') {
      event.preventDefault();
      openCurrent();

      return;
    }

    if (mod || event.ctrlKey || event.metaKey) {
      return;
    }

    if (region === 'side' && event.target === sideRef.current) {
      if (key === 'Enter' && current) {
        event.preventDefault();
        pick(current);

        return;
      }

      if (key === 'Escape') {
        requestFocus('center');

        return;
      }
    }

    if (current && ['r', 'e', 'd', 'i', 's'].includes(key)) {
      event.preventDefault();
      act(key, current);
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);

    window.addEventListener('keydown', listener);

    return () => window.removeEventListener('keydown', listener);
  }, []);

  return (
    <div className="inbox-layout" hidden={!visible}>
      {/* Gone with the inbox, so it cannot keep the keyboard while another tab is open. */}
      {sideOpen && visible && (
        <SidePanel
          categories={side}
          folded={folded}
          selected={sideSelected}
          focused={sideFocused}
          listRef={sideRef}
          onToggle={(category) => setCategory(category, folded.has(category))}
          onPick={pick}
          onFocusChange={setSideFocused}
        />
      )}
      <section ref={centerRef} className="pane" tabIndex={-1} aria-label="Inbox">
        <div className="page">
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
                      onClick={() => setSection(group.key, !open)}
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
                          const connection = connectionById.get(
                            thread.items[0]?.connectionId ?? ''
                          );

                          return (
                            <ThreadCard
                              key={thread.key}
                              items={thread.items}
                              connection={connection}
                              capabilities={capabilitiesOf(connection)}
                              reactions={reactions}
                              selected={thread === centerSelected}
                              replying={replyFor === thread.key}
                              onStartReply={() => setReplyFor(thread.key)}
                              onCloseReply={closeReply}
                              feedback={
                                feedbackFor?.key === thread.key ? feedbackFor.verdict : null
                              }
                              onStartFeedback={(verdict) =>
                                setFeedbackFor({ key: thread.key, verdict })
                              }
                              onCloseFeedback={closeFeedback}
                              onSelect={() => select(thread, centerOrder.indexOf(thread))}
                              onDone={() => markDone(thread)}
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
          <p className="hint muted">
            <kbd>↑</kbd>
            <kbd>↓</kbd> move · <kbd>{MOD}↑</kbd>
            <kbd>{MOD}↓</kbd> next category · <kbd>R</kbd> reply · <kbd>E</kbd> react · <kbd>D</kbd>{' '}
            done · <kbd>I</kbd> important · <kbd>S</kbd> spam · <kbd>{MOD}↵</kbd> open in source ·{' '}
            <kbd>{MOD}B</kbd> side panel · <kbd>{MOD}X</kbd> messages
          </p>
        </div>
      </section>
      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
};
