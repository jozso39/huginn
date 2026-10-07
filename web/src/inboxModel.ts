import type { Category, Connection, ConnectionGroup, ConnectorKind, Item } from './api.types';
import { emojiFor } from './slack/emoji';

/** One conversation at one source, newest message first. */
export interface Thread {
  /** `<connection id>:<thread key>`. */
  key: string;
  items: Item[];
}

const threadKeyOf = (item: Item) => `${item.connectionId}:${item.threadKey}`;

/** Items arrive newest first, so a thread's first item is its newest. */
export const groupByThread = (items: Item[]): Thread[] =>
  [...new Set(items.map(threadKeyOf))].map((key) => ({
    key,
    items: items.filter((item) => threadKeyOf(item) === key),
  }));

const holds = (thread: Thread, itemId: string) => thread.items.some((item) => item.id === itemId);

const RANK: Record<Category, number> = { Important: 0, Undecided: 1, Spam: 2 };

/** Important threads first, then by recency (which the list already has). */
const byImportance = (a: Thread, b: Thread) =>
  RANK[a.items[0]?.category ?? 'Undecided'] - RANK[b.items[0]?.category ?? 'Undecided'];

/** A section of the inbox: a category of connections, or a connection without one. */
export interface Section {
  /** `g:<category id>`, or `c:<connection id>` for a connection without a category. */
  key: string;
  name: string;
  connections: Connection[];
  threads: Thread[];
  important: number;
}

/** Where a connection is shown: its category's section, or a section of its own. */
export const sectionOf = (
  connection: Connection | undefined,
  groupById: ReadonlyMap<string, ConnectionGroup>
): { key: string; name: string } => {
  const group = connection?.groupId ? groupById.get(connection.groupId) : undefined;

  if (group) {
    return { key: `g:${group.id}`, name: group.name };
  }

  return { key: `c:${connection?.id ?? 'unknown'}`, name: connection?.name ?? 'Unknown source' };
};

/** The inbox's sections for these items: those with something important first, then by name. */
export const inboxSections = (
  items: Item[],
  connections: Connection[],
  groups: ConnectionGroup[]
): Section[] => {
  const connectionById = new Map(connections.map((c) => [c.id, c]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const sectionOfItem = (item: Item) => sectionOf(connectionById.get(item.connectionId), groupById);
  const found = [...new Map(items.map((item) => [sectionOfItem(item).key, sectionOfItem(item)]))];

  const built = found.map(([key, { name }]): Section => {
    const threads = [
      ...groupByThread(items.filter((item) => sectionOfItem(item).key === key)),
    ].sort(byImportance);

    return {
      key,
      name,
      connections: connections.filter((c) => sectionOf(c, groupById).key === key),
      threads,
      important: threads.filter((t) => t.items[0]?.category === 'Important').length,
    };
  });

  return [...built].sort(
    (a, b) => Number(b.important > 0) - Number(a.important > 0) || a.name.localeCompare(b.name)
  );
};

/** One connection's conversations in a category of the side panel. */
export interface SideConnection {
  id: string;
  /** Undefined while the item's connection is not loaded. */
  connection: Connection | undefined;
  threads: Thread[];
}

export interface SideCategory {
  category: Category;
  connections: SideConnection[];
  /** Every conversation in the category, in the order shown. */
  threads: Thread[];
}

const CATEGORIES: Category[] = ['Important', 'Undecided', 'Spam'];

/**
 * The side panel: Important, Undecided, then Spam; in each, its connections by name and
 * their conversations newest first. A conversation is filed by its newest message, the
 * way the inbox shows it, so both list the same conversations.
 */
export const sidePanel = (items: Item[], connections: Connection[]): SideCategory[] => {
  const connectionById = new Map(connections.map((c) => [c.id, c]));
  const inbox = groupByThread(items.filter((item) => item.category !== 'Spam'));
  const spam = groupByThread(items.filter((item) => item.category === 'Spam'));

  return CATEGORIES.map((category) => {
    const threads =
      category === 'Spam' ? spam : inbox.filter((t) => t.items[0]?.category === category);
    const ids = [...new Set(threads.map((t) => t.items[0]?.connectionId ?? ''))];
    const byConnection = [
      ...ids.map((id): SideConnection => ({
        id,
        connection: connectionById.get(id),
        threads: threads.filter((t) => t.items[0]?.connectionId === id),
      })),
    ].sort((a, b) => (a.connection?.name ?? '').localeCompare(b.connection?.name ?? ''));

    return { category, connections: byConnection, threads: byConnection.flatMap((c) => c.threads) };
  });
};

/** A part of a panel the arrow keys walk through: a category, or a section. */
export interface Outline {
  key: string;
  threads: Thread[];
  /** Folded parts are skipped by ↑ ↓; ⌘↑ ⌘↓ unfold them. */
  open: boolean;
}

/** The conversations ↑ ↓ walk: those of the unfolded parts, in order. */
export const walkable = (outline: Outline[]): Thread[] =>
  outline.filter((part) => part.open).flatMap((part) => part.threads);

/**
 * The selected conversation's place in `order`: the one holding `itemId`, else the one
 * now at `index` (where the selection was before its conversation left). -1 when empty.
 */
export const resolveSelection = (order: Thread[], itemId: string | null, index: number): number => {
  const found = itemId === null ? -1 : order.findIndex((thread) => holds(thread, itemId));

  return found !== -1 ? found : Math.min(Math.max(index, 0), order.length - 1);
};

/** The conversation in `threads` that shows any message of `thread`. */
export const counterpart = (threads: Thread[], thread: Thread | undefined): Thread | undefined =>
  thread && threads.find((candidate) => thread.items.some((item) => holds(candidate, item.id)));

/**
 * Where ⌘↓ (1) and ⌘↑ (-1) go from `current`: the first conversation of the next or
 * previous part that has any. ⌘↑ in the first part goes to its top; ⌘↓ in the last
 * goes nowhere. Folded parts count: going there unfolds them.
 */
export const jumpTarget = (
  outline: Outline[],
  current: Thread | undefined,
  direction: 1 | -1
): { part: string; thread: Thread } | null => {
  const parts = outline.filter((part) => part.threads.length > 0);
  const head = current?.items[0]?.id;
  const at = head ? parts.findIndex((part) => part.threads.some((t) => holds(t, head))) : -1;
  const target =
    at === -1 ? parts[0] : direction === 1 ? parts[at + 1] : (parts[at - 1] ?? parts[at]);
  const thread = target?.threads[0];

  return target && thread ? { part: target.key, thread } : null;
};

/** What a message in the side panel shows besides its author. */
export interface Preview {
  /** Where at the source: a Slack channel, a Signal group. */
  place: string | null;
  /** What it is about, for sources whose titles say so: a subject, a task, a merge request. */
  subject: string | null;
  /** Its first lines, as one line of text (the panel cuts it to fit). */
  text: string;
}

// Chats title their messages "Jana in #dev", which the author and place already say.
const CHATS: ReadonlySet<ConnectorKind> = new Set<ConnectorKind>(['Slack', 'Signal']);

const SHORTCODE = /:([a-z0-9_+'-]+(?:::skin-tone-[2-6])?):/g;

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export const previewOf = (item: Item, kind: ConnectorKind | undefined): Preview => {
  const { channelName, groupName } = item.features;
  const chat = kind !== undefined && CHATS.has(kind);
  const text = oneLine(
    item.body.replace(SHORTCODE, (code, name: string) => emojiFor(name) ?? code)
  );

  return {
    place:
      typeof channelName === 'string'
        ? `#${channelName}`
        : typeof groupName === 'string'
          ? groupName
          : null,
    subject: chat ? null : oneLine(item.title) || null,
    text: text || (chat ? oneLine(item.title) : ''),
  };
};

const DAY_MS = 86_400_000;

/** When, as short as a list needs: 14:05 today, Tue this week, 6 Oct before. */
export const shortTime = (iso: string, now: Date = new Date()): string => {
  const date = new Date(iso);

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  if (now.getTime() - date.getTime() < 6 * DAY_MS) {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
};
