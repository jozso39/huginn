/** What kind of thing arrived. Drives the icon and the default triage features. */
export enum ItemKind {
  Message = 'Message',
  DirectMessage = 'DirectMessage',
  Mention = 'Mention',
  Email = 'Email',
  Todo = 'Todo',
  ReviewRequest = 'ReviewRequest',
  Comment = 'Comment',
  Assignment = 'Assignment',
  Alert = 'Alert',
}

export enum ItemState {
  Open = 'Open',
  Done = 'Done',
  Archived = 'Archived',
}

/** The three triage buckets. Phase 1 puts everything in Undecided. */
export enum Category {
  Important = 'Important',
  Undecided = 'Undecided',
  Spam = 'Spam',
}

/**
 * Flat metadata a connector derives from the raw payload. This — not the body —
 * is what hard rules match on and what the feedback agent gets when a message
 * fails the injection guardrail. Keep values primitive and stable per connector.
 */
export type ItemFeatures = Readonly<Record<string, string | number | boolean | null>>;

export interface Item {
  readonly id: string;
  readonly connectionId: string;
  /** Provider id, unique within the connection. Re-ingesting the same one updates. */
  readonly externalId: string;
  /** Groups items of one conversation (Slack thread, mail thread, one MR). */
  readonly threadKey: string;
  readonly kind: ItemKind;
  readonly author: string;
  readonly title: string;
  readonly body: string;
  /** Deep link to the message in its own tool. */
  readonly url: string | null;
  readonly receivedAt: Date;
  readonly features: ItemFeatures;
  readonly raw: unknown;
  readonly category: Category;
  readonly decidedByRuleId: string | null;
  readonly state: ItemState;
  readonly stateChangedAt: Date;
  readonly createdAt: Date;
}

export type NewItem = Pick<
  Item,
  | 'connectionId'
  | 'externalId'
  | 'threadKey'
  | 'kind'
  | 'author'
  | 'title'
  | 'body'
  | 'url'
  | 'receivedAt'
  | 'features'
  | 'raw'
>;
