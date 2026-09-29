import type { SignalTarget } from '@/core/clients/SignalClient/SignalClient.types';

/** What an item needs to be answered or reacted to without another lookup. */
export interface SignalItemRaw {
  readonly target: SignalTarget;
  /** Who wrote it (uuid, else number) and when: Signal's id for a message. */
  readonly author: string;
  readonly timestamp: number;
  readonly text: string;
}
