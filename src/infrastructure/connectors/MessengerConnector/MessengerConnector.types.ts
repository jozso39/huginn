/** What an item needs to be answered or marked read later, without another lookup. */
export interface MessengerItemRaw {
  readonly threadId: string;
  readonly id: string;
  readonly senderId: string;
  readonly encrypted: boolean;
}
