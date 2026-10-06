import type { AttentionNotice, IAttentionSink } from '@/core/attention/Attention.types';

/** Records what the Mac app would have shown. */
export class MockAttentionSink implements IAttentionSink {
  public badges: readonly number[] = [];
  public notices: readonly AttentionNotice[] = [];

  public badge(important: number): void {
    this.badges = [...this.badges, important];
  }

  public notify(notice: AttentionNotice): void {
    this.notices = [...this.notices, notice];
  }
}
