import webpush, { WebPushError } from 'web-push';
import type { Logger } from '@/lib/logger';
import type {
  IPushClient,
  PushMessage,
  PushSendResult,
} from '@/core/clients/PushClient/PushClient.types';
import type { PushDevice } from '@/core/push/PushDevice.types';
import { toError } from '@/core/errors/errors';

export interface VapidConfig {
  readonly publicKey: string;
  readonly privateKey: string;
  /** A mailto: or https: contact the push services can reach the sender at. */
  readonly subject: string;
}

// Push services keep undelivered messages this long (e.g. a phone that is off).
const TTL_SECONDS = 12 * 60 * 60;

/** Web Push (RFC 8030) with VAPID; payloads are encrypted to the device (RFC 8291). */
export class WebPushClient implements IPushClient {
  public readonly publicKey: string | null;

  constructor(
    private readonly logger: Logger,
    private readonly vapid: VapidConfig | null
  ) {
    this.publicKey = vapid?.publicKey ?? null;
  }

  public async send(device: PushDevice, message: PushMessage): Promise<PushSendResult> {
    if (!this.vapid) {
      return { ok: false, gone: false, error: 'push is not configured' };
    }

    try {
      await webpush.sendNotification(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        JSON.stringify(message),
        { vapidDetails: this.vapid, TTL: TTL_SECONDS, urgency: 'high', timeout: 10_000 }
      );

      return { ok: true };
    } catch (error) {
      // 404/410: the subscription no longer exists (app removed, permission revoked).
      const status = error instanceof WebPushError ? error.statusCode : null;
      const gone = status === 404 || status === 410;

      if (!gone) {
        this.logger.warn({ status, err: toError(error) }, 'web push failed');
      }

      return { ok: false, gone, error: toError(error).message };
    }
  }
}
