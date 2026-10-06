import type {
  ISignalClient,
  SignalEnvelope,
  SignalEnvelopeHandler,
  SignalTarget,
} from '@/core/clients/SignalClient/SignalClient.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';

export const MOCK_SIGNAL_ACCOUNT = '+420600000001';
export const MOCK_SIGNAL_LINK = 'sgnl://linkdevice?uuid=test&pub_key=test';

/** A friend's direct message. */
export const MOCK_SIGNAL_DM: SignalEnvelope = {
  source: '+420600000002',
  sourceNumber: '+420600000002',
  sourceUuid: 'uuid-petra',
  sourceName: 'Petra',
  timestamp: 1759046400000,
  dataMessage: { timestamp: 1759046400000, message: 'Are we still on for Friday?' },
};

/** Linking succeeds with MOCK_SIGNAL_ACCOUNT; `deliver` plays the daemon pushing envelopes. */
export class MockSignalClient implements ISignalClient {
  /** Set to false to play a Mac without signal-cli. */
  public available = true;
  public linked: readonly string[] = [];
  public sent: readonly {
    target: SignalTarget;
    text: string;
    quote?: { timestamp: number; author: string };
  }[] = [];
  public reactions: readonly { target: SignalTarget; emoji: string; timestamp: number }[] = [];
  private handlers: ReadonlyMap<string, SignalEnvelopeHandler> = new Map();

  public isAvailable(): boolean {
    return this.available;
  }

  public accounts(): Promise<readonly string[]> {
    return Promise.resolve(this.linked);
  }

  public subscribe(account: string, handler: SignalEnvelopeHandler): Promise<void> {
    if (!this.linked.includes(account)) {
      return Promise.reject(new HuginnError(ErrorCode.Unauthorized, `${account} is not linked`));
    }

    this.handlers = new Map([...this.handlers, [account, handler]]);

    return Promise.resolve();
  }

  public unsubscribe(account: string): void {
    this.handlers = new Map([...this.handlers].filter(([key]) => key !== account));
  }

  public send(
    _account: string,
    target: SignalTarget,
    text: string,
    quote?: { readonly timestamp: number; readonly author: string; readonly text: string }
  ): Promise<{ readonly timestamp: number }> {
    this.sent = [
      ...this.sent,
      {
        target,
        text,
        ...(quote ? { quote: { timestamp: quote.timestamp, author: quote.author } } : {}),
      },
    ];

    return Promise.resolve({ timestamp: 1759046500000 });
  }

  public react(
    _account: string,
    target: SignalTarget,
    emoji: string,
    _targetAuthor: string,
    targetTimestamp: number
  ): Promise<void> {
    this.reactions = [...this.reactions, { target, emoji, timestamp: targetTimestamp }];

    return Promise.resolve();
  }

  public groupName(_account: string, groupId: string): Promise<string | null> {
    return Promise.resolve(groupId === 'group-family' ? 'Family' : null);
  }

  public startLink(): Promise<string> {
    return Promise.resolve(MOCK_SIGNAL_LINK);
  }

  public finishLink(uri: string, _deviceName: string): Promise<string> {
    if (uri !== MOCK_SIGNAL_LINK) {
      return Promise.reject(new HuginnError(ErrorCode.Upstream, 'unknown link'));
    }

    this.linked = [...this.linked, MOCK_SIGNAL_ACCOUNT];

    return Promise.resolve(MOCK_SIGNAL_ACCOUNT);
  }

  public deliver(envelope: SignalEnvelope, account = MOCK_SIGNAL_ACCOUNT): void {
    this.handlers.get(account)?.(envelope);
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }
}
