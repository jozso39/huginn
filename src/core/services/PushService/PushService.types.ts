import type { NewPushDevice } from '@/core/push/PushDevice.types';

export interface PushDeviceView {
  readonly id: string;
  readonly endpoint: string;
  readonly label: string;
  readonly createdAt: Date;
}

/** Pushes new Important items to the user's devices. */
export interface IPushService {
  /** Null when the server has no VAPID keys: the dashboard then explains how to add them. */
  publicKey(): string | null;
  devices(): Promise<readonly PushDeviceView[]>;
  register(device: NewPushDevice): Promise<PushDeviceView>;
  unregister(endpoint: string): Promise<void>;
  /** Sends a test notification to one device; false if it is unknown or unreachable. */
  test(endpoint: string): Promise<boolean>;
  /** Starts listening for new items. */
  start(): void;
  stop(): void;
}
