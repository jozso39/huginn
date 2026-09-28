export enum ActionType {
  Reply = 'Reply',
  React = 'React',
  Done = 'Done',
  Archive = 'Archive',
  /** Closed by the provider, not by the user (todo done in GitLab, mail archived). */
  Synced = 'Synced',
}

/**
 * Everything the user (or a sync) did to an item. This is the archive: an item
 * that was replied to keeps its reply text here, an item marked done keeps when.
 */
export interface Action {
  readonly id: string;
  readonly itemId: string;
  readonly type: ActionType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly createdAt: Date;
}

export type NewAction = Pick<Action, 'itemId' | 'type' | 'payload' | 'result'>;
