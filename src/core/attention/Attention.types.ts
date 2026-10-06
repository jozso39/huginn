/** Something worth interrupting the user for: a new Important item. */
export interface AttentionNotice {
  readonly itemId: string;
  readonly title: string;
  readonly body: string;
}

/** Where attention goes: the Mac app's menu-bar count, Dock badge and notifications. */
export interface IAttentionSink {
  /** Open Important items, after every change (deduplicated by the service). */
  badge(important: number): void;
  notify(notice: AttentionNotice): void;
}
