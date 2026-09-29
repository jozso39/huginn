import type { PushDevice } from '@/core/push/PushDevice.types';

/** What the service worker gets; it is encrypted end to end to the device. */
export interface PushMessage {
  readonly title: string;
  readonly body: string;
  /** Opened when the notification is tapped, relative to the app. */
  readonly url: string;
  /** Notifications with the same tag replace each other (one per conversation). */
  readonly tag: string;
  /** Open Important items, for the app icon badge. */
  readonly badge: number;
}

export type PushSendResult =
  | { readonly ok: true }
  /** `gone`: the browser unsubscribed or was reset; the device should be forgotten. */
  | { readonly ok: false; readonly gone: boolean; readonly error: string };

export interface IPushClient {
  /** The VAPID public key browsers subscribe with; null when push is not configured. */
  readonly publicKey: string | null;
  send(device: PushDevice, message: PushMessage): Promise<PushSendResult>;
}
