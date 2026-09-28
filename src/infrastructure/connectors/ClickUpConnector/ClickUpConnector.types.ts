/** Kept on each item so a reply lands in the right place without another lookup. */
export interface ClickUpItemRaw {
  readonly taskId: string;
  /** Present for comment items: replies go into the comment's thread. */
  readonly commentId?: string;
}

export interface ClickUpCursor {
  /** date_updated (ms) of the newest task already processed. */
  readonly updatedSince?: number;
  /** Tasks known to be assigned to the user; a task not in here is a new assignment. */
  readonly knownTasks?: readonly string[];
  readonly workspaceId?: string;
}
