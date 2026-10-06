import type { Subprocess } from 'bun';
import { mkdir } from 'node:fs/promises';
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
// signal-cli exits within ~100 ms of SIGTERM; one that hangs is killed after this.
const STOP_GRACE_MS = 3_000;
// A run this long was healthy: the next crash restarts it with the shortest wait again.
const HEALTHY_RUN_MS = 60_000;
// Homebrew's folders (Apple silicon, Intel): the Mac app starts with neither on PATH.
const HOMEBREW_BINS = ['/opt/homebrew/bin', '/usr/local/bin'];
// Nothing is downloaded but text. Manual receiving: messages wait on Signal's servers
// until a connection subscribes, so a paused connection loses nothing.
const ARGS = [
  'jsonRpc',
  '--receive-mode=manual',
  '--ignore-attachments',
  '--ignore-stories',
  '--ignore-avatars',
  '--ignore-stickers',
];

type SignalProcess = Subprocess<'pipe', 'pipe', 'pipe'>;

interface PendingCall {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface ReceivedMessage {
  readonly account?: string;
  readonly envelope?: SignalEnvelope;
}

interface RpcMessage {
  readonly id?: number;
  readonly method?: string;
  readonly result?: unknown;
  readonly error?: { readonly message?: string };
  // A subscription's `receive` carries the message in `result`.
  readonly params?: ReceivedMessage & { readonly result?: ReceivedMessage };
}

export interface SignalCliOptions {
  /** The signal-cli to run; null finds it on PATH or in Homebrew's folders. */
  readonly cli: string | null;
  /** signal-cli's data: the linked device's keys. */
  readonly dataDir: string;
  /** Waits before starting it again after it stopped on its own, one per failure in a row. */
  readonly restartBackoffMs: readonly number[];
}

const targetParams = (target: SignalTarget) =>
  'groupId' in target ? { groupId: target.groupId } : { recipient: [target.recipient] };

/**
 * signal-cli, run by Huginn itself in JSON-RPC mode over its stdin and stdout: requests
 * matched to answers by id, received messages pushed as `receive` notifications. It
 * starts on first use and stops with Huginn. There is no socket or port on purpose:
 * whoever can talk to it can read and send as the account.
 */
export class SignalRpcClient implements ISignalClient {
  private child: SignalProcess | null = null;
  private starting: Promise<SignalProcess> | null = null;
  private startedAt = 0;
  private failures = 0;
  private nextId = 1;
  private closed = false;
  private subscription: number | null = null;
  private subscribing: Promise<void> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<number, PendingCall>();
  private readonly handlers = new Map<string, SignalEnvelopeHandler>();
  private readonly groupNames = new Map<string, string | null>();

  constructor(
    private readonly logger: Logger,
    private readonly options: SignalCliOptions
  ) {}

  public isAvailable(): boolean {
    return this.locate() !== null;
  }

  public async accounts(): Promise<readonly string[]> {
    const result = (await this.call('listAccounts', {})) as readonly { number: string }[];

    return result.map((account) => account.number);
  }

  public async subscribe(account: string, handler: SignalEnvelopeHandler): Promise<void> {
    this.closed = false;
    this.handlers.set(account, handler);

    try {
      if (!(await this.accounts()).includes(account)) {
        throw new HuginnError(
          ErrorCode.Unauthorized,
          `${account} is not linked in signal-cli any more — link the phone again`
        );
      }

      await this.receive();
    } catch (error) {
      this.handlers.delete(account);
      throw error;
    }
  }

  public unsubscribe(account: string): void {
    this.handlers.delete(account);

    if (this.handlers.size > 0 || this.subscription === null || !this.child) {
      return;
    }

    const subscription = this.subscription;

    this.subscription = null;
    // Nobody listens any more: let messages wait on Signal's servers again.
    this.call('unsubscribeReceive', { subscription }).catch((error: unknown) =>
      this.logger.warn({ err: toError(error) }, 'signal-cli unsubscribe failed')
    );
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

  public async close(): Promise<void> {
    this.closed = true;
    this.handlers.clear();

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    const running = this.child ?? (await this.starting?.catch(() => null)) ?? null;

    if (!running) {
      return;
    }

    // SIGTERM lets it save and exit; a closed stdin alone makes it abort.
    running.kill('SIGTERM');

    const stopped = await Promise.race([
      running.exited.then(() => true),
      Bun.sleep(STOP_GRACE_MS).then(() => false),
    ]);

    if (!stopped) {
      running.kill('SIGKILL');
    }
  }

  /** One subscription for every account; messages are routed by their account. */
  private receive(): Promise<void> {
    if (this.subscription !== null) {
      return Promise.resolve();
    }

    this.subscribing ??= this.call('subscribeReceive', {})
      .then((id) => {
        this.subscription = id as number;
      })
      .finally(() => {
        this.subscribing = null;
      });

    return this.subscribing;
  }

  private async call(method: string, params: object, timeoutMs = CALL_TIMEOUT_MS) {
    const running = await this.running();
    const id = this.nextId++;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HuginnError(ErrorCode.Upstream, `signal-cli did not answer ${method}`));
      }, timeoutMs);

      const fail = (error: unknown) => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new HuginnError(ErrorCode.Upstream, `signal-cli: ${toError(error).message}`));
      };

      this.pending.set(id, { resolve, reject, timer });

      try {
        // A pipe that just closed fails here or later; either way only this call fails.
        Promise.resolve(
          running.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
        )
          .then(() => running.stdin.flush())
          .catch(fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  private running(): Promise<SignalProcess> {
    if (this.child) {
      return Promise.resolve(this.child);
    }

    this.starting ??= this.launch().finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  private async launch(): Promise<SignalProcess> {
    const cli = this.locate();

    if (!cli) {
      throw new HuginnError(
        ErrorCode.Validation,
        'Signal needs signal-cli on this Mac: install it with "brew install signal-cli", then try again'
      );
    }

    await mkdir(this.options.dataDir, { recursive: true, mode: 0o700 });

    const child = Bun.spawn([cli, '--config', this.options.dataDir, ...ARGS], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    // However Huginn exits, signal-cli is told to stop cleanly too.
    const stopWithHuginn = () => child.kill('SIGTERM');

    process.on('exit', stopWithHuginn);
    this.child = child;
    this.startedAt = Date.now();
    SignalRpcClient.readLines(child.stdout, (line) => this.dispatch(line)).catch((error: unknown) =>
      this.logger.warn({ err: toError(error) }, 'signal-cli output lost')
    );
    SignalRpcClient.readLines(child.stderr, (line) => this.log(line)).catch(() => undefined);
    void child.exited.then((code) => {
      process.off('exit', stopWithHuginn);
      this.exited(child, code);
    });
    this.logger.info({ pid: child.pid }, 'signal-cli started');

    return child;
  }

  private locate(): string | null {
    return this.options.cli
      ? Bun.which(this.options.cli)
      : (Bun.which('signal-cli') ?? Bun.which('signal-cli', { PATH: HOMEBREW_BINS.join(':') }));
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

    const received = message.params?.result ?? message.params;

    if (message.method !== 'receive' || !received?.account || !received.envelope) {
      return;
    }

    try {
      this.handlers.get(received.account)?.(received.envelope);
    } catch (error) {
      // One bad message must not stop the reading of everything after it.
      this.logger.warn({ err: toError(error) }, 'signal message dropped');
    }
  }

  /** signal-cli's own log: its warnings are worth keeping, the rest only when debugging. */
  private log(line: string): void {
    const entry = { line: line.slice(0, 500) };

    if (/^(WARN|ERROR|Fatal)/.test(line)) {
      this.logger.warn(entry, 'signal-cli');
    } else {
      this.logger.debug(entry, 'signal-cli');
    }
  }

  /** Fails what was waiting; starts it again if connections still listen. */
  private exited(child: SignalProcess, code: number | null): void {
    if (this.child !== child) {
      return;
    }

    this.child = null;
    this.subscription = null;
    [...this.pending.values()].forEach((call) => {
      clearTimeout(call.timer);
      call.reject(new HuginnError(ErrorCode.Upstream, `signal-cli stopped (exit ${code})`));
    });
    this.pending.clear();

    if (this.closed || this.handlers.size === 0) {
      this.logger.info({ code }, 'signal-cli stopped');

      return;
    }

    if (Date.now() - this.startedAt > HEALTHY_RUN_MS) {
      this.failures = 0;
    }

    this.restartLater(`exit ${code}`);
  }

  private restartLater(reason: string): void {
    const backoff = this.options.restartBackoffMs;
    const delay = backoff[Math.min(this.failures, backoff.length - 1)] ?? 0;

    this.failures += 1;
    this.logger.warn({ reason, restartInMs: delay }, 'signal-cli stopped, starting it again');
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.receive().catch((error: unknown) => {
        // It did not even start (removed?): try again later. If it started and then
        // failed, its exit schedules the next attempt.
        if (!this.child && !this.closed && this.handlers.size > 0) {
          this.restartLater(toError(error).message);
        }
      });
    }, delay);
  }

  private static async readLines(
    stream: ReadableStream<Uint8Array>,
    onLine: (line: string) => void
  ): Promise<void> {
    const decoder = new TextDecoder();
    let rest = '';

    for await (const chunk of stream) {
      const lines = (rest + decoder.decode(chunk, { stream: true })).split('\n');

      rest = lines.pop() ?? '';
      lines.filter((line) => line.trim() !== '').forEach(onLine);
    }
  }
}
