/** A browser (usually the home-screen app on a phone) that receives Web Push. */
export interface PushDevice {
  readonly id: string;
  /** The push service URL; unique per browser installation. */
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  /** What the user sees in the device list ("iPhone", "Mac Chrome"). */
  readonly label: string;
  readonly createdAt: Date;
}

export type NewPushDevice = Pick<PushDevice, 'endpoint' | 'p256dh' | 'auth' | 'label'>;

export interface IPushDeviceStore {
  list(): Promise<readonly PushDevice[]>;
  /** Re-subscribing the same browser replaces its keys instead of adding a device. */
  save(device: NewPushDevice): Promise<PushDevice>;
  removeByEndpoint(endpoint: string): Promise<boolean>;
}
