/** Keeps the app's count current and announces new Important items. */
export interface IAttentionService {
  start(): Promise<void>;
  stop(): void;
}
