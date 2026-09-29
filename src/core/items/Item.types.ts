import type { TriageDecision } from '@/core/triage/Rule.types';

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

export enum RichFormat {
  /** Slack's own markup; the dashboard renders it like Slack does. */
  SlackMrkdwn = 'SlackMrkdwn',
  /** A whole e-mail body; the dashboard shows it in a sandboxed frame. */
  Html = 'Html',
  Text = 'Text',
}

/**
 * How to show a message properly, next to the plain-text `body` that rules and
 * Jev read. Slack's comes with the names its references point to.
 */
export type RichContent =
  | {
      readonly format: RichFormat.SlackMrkdwn;
      readonly text: string;
      readonly users: Readonly<Record<string, string>>;
      readonly channels: Readonly<Record<string, string>>;
      readonly groups: Readonly<Record<string, string>>;
    }
  | { readonly format: RichFormat.Html; readonly html: string }
  | { readonly format: RichFormat.Text; readonly text: string };

/** Colour families of a status pill; named after GitLab's badge variants, which they copy. */
export enum StatusTone {
  Success = 'Success',
  Info = 'Info',
  Danger = 'Danger',
  Warning = 'Warning',
  Neutral = 'Neutral',
}

/** The state of the thing an item is about (an MR: Open / Merged / Closed), shown as a pill. */
export interface ItemStatus {
  readonly label: string;
  readonly tone: StatusTone;
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
  /** Stored rich form when it is small (Slack); large ones (e-mail) are fetched on demand. */
  readonly rich: RichContent | null;
  /** Refreshed with the item, so it follows the source (an MR gets merged). */
  readonly status: ItemStatus | null;
  readonly receivedAt: Date;
  readonly features: ItemFeatures;
  readonly raw: unknown;
  readonly category: Category;
  readonly decidedByRuleId: string | null;
  /** Why it is in its category; null until triaged. */
  readonly decision: TriageDecision | null;
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
> & { readonly rich?: RichContent | null; readonly status?: ItemStatus | null };
