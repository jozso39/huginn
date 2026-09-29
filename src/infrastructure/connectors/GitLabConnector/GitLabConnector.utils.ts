import type { GitLabTodo } from '@/core/clients/GitLabClient/GitLabClient.types';
import type { ItemStatus, NewItem } from '@/core/items/Item.types';
import { ItemKind, StatusTone } from '@/core/items/Item.types';

const MENTION_ACTIONS = new Set(['mentioned', 'directly_addressed']);
const REVIEW_ACTIONS = new Set(['review_requested', 'approval_required']);

const kindFor = (action: string): ItemKind => {
  if (REVIEW_ACTIONS.has(action)) {
    return ItemKind.ReviewRequest;
  }

  if (MENTION_ACTIONS.has(action)) {
    return ItemKind.Mention;
  }

  if (action === 'assigned') {
    return ItemKind.Assignment;
  }

  if (action === 'build_failed') {
    return ItemKind.Alert;
  }

  return ItemKind.Todo;
};

/** GitLab's own wording and badge colours for a merge request's state. */
const MR_STATUS: Readonly<Record<string, ItemStatus>> = {
  opened: { label: 'Open', tone: StatusTone.Success },
  merged: { label: 'Merged', tone: StatusTone.Info },
  closed: { label: 'Closed', tone: StatusTone.Danger },
  locked: { label: 'Locked', tone: StatusTone.Warning },
};

export const mergeRequestStatus = (todo: GitLabTodo): ItemStatus | null =>
  todo.target_type === 'MergeRequest' ? (MR_STATUS[todo.target.state ?? ''] ?? null) : null;

export const todoExternalId = (todo: GitLabTodo): string => `todo:${todo.id}`;

/**
 * One todo becomes one item. The thread key is the MR/issue, so several todos
 * on the same MR (review requested, then mentioned in a comment) sit together.
 */
export const todoToItem = (
  connectionId: string,
  todo: GitLabTodo,
  maxBodyChars: number
): NewItem => {
  const project = todo.project?.path_with_namespace ?? 'unknown';

  return {
    connectionId,
    externalId: todoExternalId(todo),
    threadKey: `${project}#${todo.target_type}/${todo.target.iid}`,
    kind: kindFor(todo.action_name),
    author: todo.author.name,
    title: `${project}!${todo.target.iid} ${todo.target.title}`,
    body: todo.body.slice(0, maxBodyChars),
    url: todo.target_url,
    status: mergeRequestStatus(todo),
    receivedAt: new Date(todo.created_at),
    features: {
      action: todo.action_name,
      targetType: todo.target_type,
      targetState: todo.target.state ?? null,
      project,
      author: todo.author.username,
      isMention: MENTION_ACTIONS.has(todo.action_name),
      isReviewRequest: REVIEW_ACTIONS.has(todo.action_name),
      isAssignment: todo.action_name === 'assigned',
    },
    raw: todo,
  };
};
