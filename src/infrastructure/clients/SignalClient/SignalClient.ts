import type { Socket } from 'bun';
import type { Logger } from '@/lib/logger';
import type {
  ISignalClient,
  SignalEnvelope,
  SignalEnvelopeHandler,
  SignalTarget,
} from '@/core/clients/SignalClient/SignalClient.types';
import { ErrorCode, HuginnError, toError } from '@/core/errors/errors';

const CALL_TIMEOUT_MS = 20_000;
// The phone owner has to find the QR screen and scan; give them time.
const LINK_TIMEOUT_MS = 10 * 60 * 1000;
const RECONNECT_MS = 5_000;

interface PendingCall {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface RpcMessage {
  readonly id?: number;
  readonly method?: string;
  readonly result?: unknown;
  readonly error?: { readonly message?: string };
  readonly params?: { readonly account?: string; readonly envelope?: SignalEnvelope };
}

const targetParams = (target: SignalTarget) =>
  'groupId' in target ? { groupId: target.groupId } : { recipient: [target.recipient] };

/**
 * signal-cli's JSON-RPC over its Unix socket (`signal-cli daemon --socket …`): one
 * connection, requests matched to answers by id, received messages pushed as
 * `receive` notifications. A socket, not a port, because whoever can talk to the
 * daemon can read and send as the account.
 */
export class SignalRpcClient implements ISignalClient {
  private socket: Socket | null = null;
  private connecting: Promise<Socket> | null = null;
  private buffer = '';
  private nextId = 1;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<number, PendingCall>();
  private readonly handlers = new Map<string, SignalEnvelopeHandler>();
  private readonly groupNames = new Map<string, string | null>();

  constructor(
    private readonly logger: Logger,
    private readonly socketPath: string | null
  ) {}

  public async accounts(): Promise<readonly string[]> {
    const result = (await this.call('listAccounts', {})) as readonly { number: string }[];

    return result.map((account) => account.number);
  }

  public async subscribe(account: string, handler: SignalEnvelopeHandler): Promise<void> {
    this.closed = false;
    this.handlers.set(account, handler);

    if (!(await this.accounts()).includes(account)) {
      this.handlers.delete(account);
      throw new HuginnError(
        ErrorCode.Unauthorized,
        `${account} is not linked in signal-cli any more — link the phone again`
      );
    }
  }

  public unsubscribe(account: string): void {
    this.handlers.delete(account);
  }

  public async send(
    account: string,
    target: SignalTarget,
    text: string,
    quote?: { readonly timestamp: number; readonly author: string; readonly text: string }
  ): Promise<{ readonly timestamp: number }> {
    const result = (await this.call('send', {
      account,
      ...targetParams(target),
      message: text,
      ...(quote
        ? { quoteTimestamp: quote.timestamp, quoteAuthor: quote.author, quoteMessage: quote.text }
        : {}),
    })) as { timestamp: number };

    return { timestamp: result.timestamp };
  }

  public async react(
    account: string,
    target: SignalTarget,
    emoji: string,
    targetAuthor: string,
    targetTimestamp: number
  ): Promise<void> {
    await this.call('sendReaction', {
      account,
      ...targetParams(target),
      emoji,
      targetAuthor,
      targetTimestamp,
    });
  }

  public async groupName(account: string, groupId: string): Promise<string | null> {
    const key = `${account}:${groupId}`;

    if (!this.groupNames.has(key)) {
      const groups = (await this.call('listGroups', { account })) as readonly {
        id: string;
        name?: string | null;
      }[];

      groups.forEach((group) => this.groupNames.set(`${account}:${group.id}`, group.name ?? null));

      if (!this.groupNames.has(key)) {
        this.groupNames.set(key, null);
      }
    }

    return this.groupNames.get(key) ?? null;
  }

  public async startLink(): Promise<string> {
    const result = (await this.call('startLink', {})) as { deviceLinkUri: string };

    return result.deviceLinkUri;
  }

  public async finishLink(uri: string, deviceName: string): Promise<string> {
    const result = (await this.call(
      'finishLink',
      { deviceLinkUri: uri, deviceName },
      LINK_TIMEOUT_MS
    )) as { number: string };

    return result.number;
  }

  public close(): Promise<void> {
    this.closed = true;
    this.handlers.clear();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.socket?.end();
    this.socket = null;

    return Promise.resolve();
  }

  private async call(method: string, params: object, timeoutMs = CALL_TIMEOUT_MS) {
    const socket = await this.connect();
    const id = this.nextId++;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HuginnError(ErrorCode.Upstream, `signal-cli did not answer ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  private connect(): Promise<Socket> {
    if (this.socket) {
      return Promise.resolve(this.socket);
    }

    if (!this.socketPath) {
      return Promise.reject(
        new HuginnError(
          ErrorCode.Validation,
          'Signal is not set up on this server (HUGINN_SIGNAL_SOCKET, see docs/signal.md)'
        )
      );
    }

    this.connecting ??= Bun.connect({
      unix: this.socketPath,
      socket: {
        data: (_socket, data) => this.receive(data.toString('utf8')),
        close: () => this.dropped(),
        error: (_socket, error) => this.logger.warn({ err: error }, 'signal-cli socket error'),
      },
    })
      .then((socket) => {
        this.socket = socket;

        return socket;
      })
      .catch((error: unknown) => {
        throw new HuginnError(
          ErrorCode.Upstream,
          `Cannot reach signal-cli at ${this.socketPath}: ${toError(error).message}`
        );
      })
      .finally(() => {
        this.connecting = null;
      });

    return this.connecting;
  }

  private receive(chunk: string): void {
    this.buffer += chunk;

    const lines = this.buffer.split('\n');

    this.buffer = lines.pop() ?? '';
    lines.filter((line) => line.trim() !== '').forEach((line) => this.dispatch(line));
  }

  private dispatch(line: string): void {
    const message = ((): RpcMessage | null => {
      try {
        return JSON.parse(line) as RpcMessage;
      } catch {
        return null;
      }
    })();

    if (!message) {
      return;
    }

    if (message.id !== undefined && this.pending.has(message.id)) {
      const call = this.pending.get(message.id);

      this.pending.delete(message.id);
      clearTimeout(call?.timer);

      if (message.error) {
        call?.reject(
          new HuginnError(ErrorCode.Upstream, `signal-cli: ${message.error.message ?? 'error'}`)
        );
      } else {
        call?.resolve(message.result);
      }

      return;
    }

    const account = message.params?.account;
    const envelope = message.params?.envelope;

    if (message.method === 'receive' && account && envelope) {
      this.handlers.get(account)?.(envelope);
    }
  }

  /** The daemon restarted or the socket broke: fail what was waiting, come back if needed. */
  private dropped(): void {
    this.socket = null;
    this.buffer = '';
    [...this.pending.values()].forEach((call) => {
      clearTimeout(call.timer);
      call.reject(new HuginnError(ErrorCode.Upstream, 'signal-cli connection closed'));
    });
    this.pending.clear();

    if (this.closed || this.handlers.size === 0 || this.reconnectTimer) {
      return;
    }

    this.logger.warn('signal-cli connection lost, reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error: unknown) => {
        this.logger.warn({ err: toError(error) }, 'signal-cli reconnect failed');
        this.dropped();
      });
    }, RECONNECT_MS);
  }
}
