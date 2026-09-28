import type {
  ClickUpComment,
  ClickUpTask,
  ClickUpUser,
} from '@/core/clients/ClickUpClient/ClickUpClient.types';
import type { NewItem } from '@/core/items/Item.types';
import { ItemKind } from '@/core/items/Item.types';
import type { ClickUpItemRaw } from './ClickUpConnector.types';

export const taskThreadKey = (taskId: string): string => `task:${taskId}`;

const isClosed = (task: ClickUpTask): boolean =>
  task.status.type === 'closed' || task.status.type === 'done';

/** A real mention (tag) of the user, or an @username in plain text as a fallback. */
export const mentionsUser = (comment: ClickUpComment, me: ClickUpUser): boolean =>
  (comment.comment ?? []).some((part) => part.type === 'tag' && part.user?.id === me.id) ||
  comment.comment_text.toLowerCase().includes(`@${me.username.toLowerCase()}`);

const assignedTo = (comment: ClickUpComment, me: ClickUpUser): boolean =>
  comment.assignee?.id === me.id && comment.resolved !== true;

export interface CommentDecision {
  /** The user commented after these: the conversation is answered. */
  readonly answered: boolean;
  /** Comments by others, newer than `since` and than the user's own latest. */
  readonly incoming: readonly ClickUpComment[];
}

/**
 * Which new comments on a task deserve an item. Anything the user already answered
 * by commenting after it does not; if they commented at all, the older items close.
 */
export const decideComments = (
  comments: readonly ClickUpComment[],
  me: ClickUpUser,
  since: number
): CommentDecision => {
  const fresh = comments.filter((comment) => Number(comment.date) > since);
  const latestOwn = Math.max(
    0,
    ...fresh.filter((comment) => comment.user.id === me.id).map((comment) => Number(comment.date))
  );

  return {
    answered: latestOwn > 0,
    incoming: fresh.filter(
      (comment) => comment.user.id !== me.id && Number(comment.date) > latestOwn
    ),
  };
};

const taskFeatures = (task: ClickUpTask) => ({
  taskId: task.id,
  listName: task.list?.name ?? null,
  status: task.status.status,
  isClosed: isClosed(task),
  priority: task.priority?.priority ?? null,
  assignees: task.assignees.length,
});

export const commentToItem = (
  connectionId: string,
  task: ClickUpTask,
  comment: ClickUpComment,
  me: ClickUpUser,
  maxBodyChars: number
): NewItem => {
  const mention = mentionsUser(comment, me);
  const assigned = assignedTo(comment, me);
  const raw: ClickUpItemRaw = { taskId: task.id, commentId: comment.id };

  return {
    connectionId,
    externalId: `comment:${comment.id}`,
    threadKey: taskThreadKey(task.id),
    kind: mention || assigned ? ItemKind.Mention : ItemKind.Comment,
    author: comment.user.username,
    title: task.name,
    body: comment.comment_text.trim().slice(0, maxBodyChars),
    url: `${task.url}?comment=${comment.id}`,
    receivedAt: new Date(Number(comment.date)),
    features: {
      ...taskFeatures(task),
      authorId: comment.user.id,
      isMention: mention,
      isAssignedComment: assigned,
      hasReplies: Number(comment.reply_count ?? 0) > 0,
    },
    raw,
  };
};

export const assignmentToItem = (
  connectionId: string,
  task: ClickUpTask,
  maxBodyChars: number
): NewItem => {
  const raw: ClickUpItemRaw = { taskId: task.id };

  return {
    connectionId,
    externalId: `assigned:${task.id}`,
    threadKey: taskThreadKey(task.id),
    kind: ItemKind.Assignment,
    author: task.creator?.username ?? 'ClickUp',
    title: task.name,
    body: (task.text_content ?? task.description ?? '').trim().slice(0, maxBodyChars),
    url: task.url,
    receivedAt: new Date(Number(task.date_updated ?? task.date_created ?? Date.now())),
    features: { ...taskFeatures(task), isNewAssignment: true },
    raw,
  };
};

export const isNewAssignment = (task: ClickUpTask, known: ReadonlySet<string>): boolean =>
  !known.has(task.id) && !isClosed(task);
