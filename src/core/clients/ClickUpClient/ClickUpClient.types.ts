export interface ClickUpUser {
  readonly id: number;
  readonly username: string;
  readonly email?: string;
}

export interface ClickUpTask {
  readonly id: string;
  readonly name: string;
  readonly text_content?: string;
  readonly description?: string;
  /** `type` is `open`, `custom`, `done` or `closed`. */
  readonly status: { readonly status: string; readonly type?: string };
  readonly assignees: readonly ClickUpUser[];
  readonly creator?: ClickUpUser;
  readonly url: string;
  readonly list?: { readonly id: string; readonly name: string };
  readonly priority?: { readonly priority: string } | null;
  /** Epoch milliseconds, as a string. */
  readonly date_created?: string;
  readonly date_updated?: string;
}

/** One segment of a rich comment. A mention is `{ type: 'tag', user }`. */
export interface ClickUpCommentPart {
  readonly text?: string;
  readonly type?: string;
  readonly user?: { readonly id: number };
}

export interface ClickUpComment {
  readonly id: string;
  readonly comment?: readonly ClickUpCommentPart[];
  readonly comment_text: string;
  readonly user: ClickUpUser;
  /** An assigned comment ("action item") and who it is for. */
  readonly assignee?: ClickUpUser | null;
  readonly resolved?: boolean;
  /** Epoch milliseconds, as a string. */
  readonly date: string;
  readonly reply_count?: string | number;
}

export interface ClickUpWorkspace {
  readonly id: string;
  readonly name: string;
}

/** One ClickUp account via a personal API token. */
export interface IClickUpClient {
  me(): Promise<ClickUpUser>;
  workspaces(): Promise<readonly ClickUpWorkspace[]>;
  /** Tasks assigned to the user, changed after `since`; one page, the API's order. */
  myTasksUpdatedSince(
    workspaceId: string,
    userId: number,
    since: number
  ): Promise<readonly ClickUpTask[]>;
  /** Ids of every open task assigned to the user (paginates). */
  myOpenTaskIds(workspaceId: string, userId: number): Promise<readonly string[]>;
  /** The 25 newest comments, newest first. */
  taskComments(taskId: string): Promise<readonly ClickUpComment[]>;
  commentOnTask(taskId: string, text: string): Promise<{ readonly id: string }>;
  replyToComment(commentId: string, text: string): Promise<{ readonly id: string }>;
  /** From the last response's X-RateLimit-Remaining; null before the first call. */
  rateLimitRemaining(): number | null;
}
