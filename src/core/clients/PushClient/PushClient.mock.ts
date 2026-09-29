import type {
  IPushClient,
  PushMessage,
  PushSendResult,
} from '@/core/clients/PushClient/PushClient.types';
import type { PushDevice } from '@/core/push/PushDevice.types';

/** Records what would have been pushed; `goneEndpoints` simulates unsubscribed browsers. */
export class MockPushClient implements IPushClient {
  public publicKey: string | null = 'BMockPublicKey';
  public sent: readonly { endpoint: string; message: PushMessage }[] = [];
  public goneEndpoints: ReadonlySet<string> = new Set();

  public send(device: PushDevice, message: PushMessage): Promise<PushSendResult> {
    if (this.goneEndpoints.has(device.endpoint)) {
      return Promise.resolve({ ok: false, gone: true, error: 'gone' });
    }

    this.sent = [...this.sent, { endpoint: device.endpoint, message }];

    return Promise.resolve({ ok: true });
  }
}
