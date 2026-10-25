import type { Subprocess } from 'bun';
import { accessSync, constants } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import { readLines } from '@/lib/readLines';
import type {
  IMessengerClient,
  IMessengerSession,
  MessengerAccount,
  MessengerEvent,
  MessengerEventHandler,
} from '@/core/clients/MessengerClient/MessengerClient.types';
import { MessengerEventType } from '@/core/clients/MessengerClient/MessengerClient.types';
import { ErrorCode, HuginnError, toError } from '@/core/errors/errors';
import type { SessionCookies } from '@/core/login/LoginWindow.types';

const CALL_TIMEOUT_MS = 20_000;
// Signing in registers a new device of the account, and connecting syncs the inbox; the
// helper gives up on either after 2 minutes and says why, so Huginn waits a bit longer.
const LOGIN_TIMEOUT_MS = 150_000;
const CONNECT_TIMEOUT_MS = 150_000;
// The helper exits as soon as its stdin closes; one that hangs is killed after this.
const STOP_GRACE_MS = 3_000;
// A run this long was healthy: the next crash restarts it with the shortest wait again.
const HEALTHY_RUN_MS = 60_000;

type HelperProcess = Subprocess<'pipe', 'pipe', 'pipe'>;

export interface MessengerHelperOptions {
  /** The huginn-messenger program. */
  readonly helper: string;
  /** Its own data: the device keys that let it read encrypted chats. */
  readonly dataDir: string;
  /** Waits before starting it again after it stopped on its own, one per failure in a row. */
  readonly restartBackoffMs: readonly number[];
}

const account = z.object({ userId: z.string().min(1), name: z.string().nullish() });
const cookies = z.record(z.string(), z.string());

const helperEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message'),
    id: z.string().min(1),
    threadId: z.string().min(1),
    encrypted: z.boolean(),
    isGroup: z.boolean(),
    threadName: z.string().nullish(),
    senderId: z.string(),
    senderName: z.string().nullish(),
    fromMe: z.boolean(),
    text: z.string(),
    timestamp: z.number(),
    replyToId: z.string().nullish(),
    url: z.string(),
    initial: z.boolean().default(false),
  }),
  z.object({ type: z.literal('read'), threadId: z.string().min(1), timestamp: z.number() }),
  z.object({ type: z.literal('cookies'), cookies }),
  z.object({ type: z.literal('connected') }),
  z.object({ type: z.literal('disconnected'), reason: z.string().default('') }),
  z.object({ type: z.literal('loggedOut'), reason: z.string().default('') }),
]);

const helperLine = z.object({
  id: z.number().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
  event: z.unknown().optional(),
});

/** The helper's words → Huginn's events. */
const toEvent = (raw: unknown): MessengerEvent | null => {
  const parsed = helperEvent.safeParse(raw);

  if (!parsed.success) {
    return null;
  }

  const event = parsed.data;

  switch (event.type) {
    case 'message':
      return {
        type: MessengerEventType.Message,
        message: {
          id: event.id,
          threadId: event.threadId,
          encrypted: event.encrypted,
          isGroup: event.isGroup,
          threadName: event.threadName ?? null,
          senderId: event.senderId,
          senderName: event.senderName ?? null,
          fromMe: event.fromMe,
          text: event.text,
          sentAt: new Date(event.timestamp),
          replyToId: event.replyToId ?? null,
          url: event.url,
          initial: event.initial,
        },
      };
    case 'read':
      return {
        type: MessengerEventType.Read,
        threadId: event.threadId,
        readAt: new Date(event.timestamp),
      };
    case 'cookies':
      return { type: MessengerEventType.Cookies, cookies: event.cookies };
    case 'connected':
      return { type: MessengerEventType.Connected };
    case 'disconnected':
      return { type: MessengerEventType.Disconnected, reason: event.reason };
    case 'loggedOut':
      return { type: MessengerEventType.LoggedOut, reason: event.reason };
  }
};

interface PendingCall {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * One run of the helper: requests matched to answers by id, events handed on. It talks
 * over its stdin and stdout only, so nothing else on the Mac can reach the account.
 */
class HelperRun {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  public readonly exited: Promise<number | null>;

  private constructor(
    private readonly logger: Logger,
    private readonly child: HelperProcess,
    onEvent: (event: MessengerEvent) => void
  ) {
    // However Huginn exits, the helper goes too.
    const stopWithHuginn = () => child.kill('SIGTERM');

    process.on('exit', stopWithHuginn);
    readLines(child.stdout, (line) => this.dispatch(line, onEvent)).catch((error: unknown) =>
      logger.warn({ err: toError(error) }, 'messenger helper output lost')
    );
    readLines(child.stderr, (line) => this.log(line)).catch(() => undefined);
    this.exited = child.exited.then((code) => {
      process.off('exit', stopWithHuginn);
      [...this.pending.values()].forEach((call) => {
        clearTimeout(call.timer);
        call.reject(
          new HuginnError(ErrorCode.Upstream, `the Messenger helper stopped (exit ${code})`)
        );
      });
      this.pending.clear();

      return code;
    });
  }

  public static async start(
    logger: Logger,
    options: MessengerHelperOptions,
    onEvent: (event: MessengerEvent) => void = () => undefined
  ): Promise<HelperRun> {
    await mkdir(options.dataDir, { recursive: true, mode: 0o700 });

    const child = Bun.spawn([options.helper, '--data', options.dataDir], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    return new HelperRun(logger, child, onEvent);
  }

  public call(method: string, params: object, timeoutMs = CALL_TIMEOUT_MS): Promise<unknown> {
    const id = this.nextId++;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new HuginnError(ErrorCode.Upstream, `the Messenger helper did not answer ${method}`)
        );
      }, timeoutMs);

      const fail = (error: unknown) => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new HuginnError(ErrorCode.Upstream, `Messenger helper: ${toError(error).message}`));
      };

      this.pending.set(id, { resolve, reject, timer });

      try {
        Promise.resolve(this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`))
          .then(() => this.child.stdin.flush())
          .catch(fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  /** Closing its stdin is the helper's cue to disconnect and exit. */
  public async stop(): Promise<void> {
    try {
      await this.child.stdin.end();
    } catch {
      // Already gone.
    }

    const stopped = await Promise.race([
      this.exited.then(() => true),
      Bun.sleep(STOP_GRACE_MS).then(() => false),
    ]);

    if (!stopped) {
      this.child.kill('SIGKILL');
      await this.exited;
    }
  }

  private dispatch(text: string, onEvent: (event: MessengerEvent) => void): void {
    const line = helperLine.safeParse(parseJson(text));

    if (!line.success) {
      return;
    }

    const { id, result, error, event } = line.data;

    if (id !== undefined) {
      const call = this.pending.get(id);

      this.pending.delete(id);
      clearTimeout(call?.timer);

      if (error) {
        call?.reject(
          new HuginnError(
            error.code === 'Unauthorized' ? ErrorCode.Unauthorized : ErrorCode.Upstream,
            error.message ?? 'Messenger failed'
          )
        );
      } else {
        call?.resolve(result);
      }

      return;
    }

    const parsed = event === undefined ? null : toEvent(event);

    if (!parsed) {
      return;
    }

    try {
      onEvent(parsed);
    } catch (handlerError) {
      // One bad event must not stop the reading of everything after it.
      this.logger.warn({ err: toError(handlerError) }, 'messenger event dropped');
    }
  }

  /** The helper's own log (it never logs cookies or message text). */
  private log(line: string): void {
    const parsed = parseJson(line) as { level?: string; message?: string } | null;
    const entry = { line: (parsed?.message ?? line).slice(0, 500) };

    if (parsed?.level === 'warn' || parsed?.level === 'error' || parsed?.level === 'fatal') {
      this.logger.warn(entry, 'messenger helper');
    } else {
      this.logger.debug(entry, 'messenger helper');
    }
  }
}

/** One account connected through its own helper run, started again when it dies. */
class HelperSession implements IMessengerSession {
  private run: HelperRun | null = null;
  private handler: MessengerEventHandler | null = null;
  private stopped = false;
  private loggedOut = false;
  private failures = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly options: MessengerHelperOptions,
    private cookies: SessionCookies,
    private readonly sessions: Set<HelperSession>
  ) {}

  public async start(handler: MessengerEventHandler): Promise<MessengerAccount> {
    this.handler = handler;
    this.stopped = false;
    this.sessions.add(this);

    try {
      return await this.connect();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    this.sessions.delete(this);

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    const run = this.run;

    this.run = null;
    await run?.stop();
  }

  private async connect(): Promise<MessengerAccount> {
    const run = await HelperRun.start(this.logger, this.options, (event) => this.onEvent(event));
    const startedAt = Date.now();

    this.run = run;
    void run.exited.then((code) => this.exited(run, code, startedAt));

    const result = account.parse(
      await run.call('connect', { cookies: this.cookies }, CONNECT_TIMEOUT_MS)
    );

    return { userId: result.userId, name: result.name ?? null };
  }

  private onEvent(event: MessengerEvent): void {
    if (event.type === MessengerEventType.Cookies) {
      // A restart signs in with the newest ones.
      this.cookies = event.cookies;
    }

    if (event.type === MessengerEventType.LoggedOut) {
      this.loggedOut = true;
    }

    this.handler?.(event);
  }

  private exited(run: HelperRun, code: number | null, startedAt: number): void {
    if (this.run !== run || this.stopped) {
      return;
    }

    this.run = null;

    if (this.loggedOut) {
      this.logger.info({ code }, 'messenger helper stopped after a logout');

      return;
    }

    if (Date.now() - startedAt > HEALTHY_RUN_MS) {
      this.failures = 0;
    }

    const backoff = this.options.restartBackoffMs;
    const delay = backoff[Math.min(this.failures, backoff.length - 1)] ?? 0;

    this.failures += 1;
    this.logger.warn({ code, delayMs: delay }, 'messenger helper stopped; starting it again');
    this.handler?.({
      type: MessengerEventType.Disconnected,
      reason: `the helper stopped (exit ${code})`,
    });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;

      if (this.stopped) {
        return;
      }

      this.connect().catch((error: unknown) => {
        const failure = toError(error);

        if (failure instanceof HuginnError && failure.code === ErrorCode.Unauthorized) {
          this.loggedOut = true;
          this.handler?.({ type: MessengerEventType.LoggedOut, reason: failure.message });
        }

        this.logger.warn({ err: failure }, 'messenger helper restart failed');
      });
    }, delay);
  }
}

/**
 * Messenger through huginn-messenger, a helper built on mautrix-meta's messagix: one
 * run per connected account, and a short one to check a fresh sign-in.
 */
export class HelperMessengerClient implements IMessengerClient {
  private readonly sessions = new Set<HelperSession>();
  private agent: Promise<string> | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly options: MessengerHelperOptions
  ) {}

  public isAvailable(): boolean {
    try {
      accessSync(this.options.helper, constants.X_OK);

      return true;
    } catch {
      return false;
    }
  }

  public userAgent(): Promise<string> {
    this.agent ??= this.once(async (run) => {
      const result = z.object({ userAgent: z.string().min(1) }).parse(await run.call('info', {}));

      return result.userAgent;
    }).catch((error: unknown) => {
      this.agent = null;
      throw error;
    });

    return this.agent;
  }

  public login(
    fresh: SessionCookies
  ): Promise<MessengerAccount & { readonly cookies: SessionCookies }> {
    return this.once(async (run) => {
      const result = account
        .extend({ cookies })
        .parse(await run.call('login', { cookies: fresh }, LOGIN_TIMEOUT_MS));

      return { userId: result.userId, name: result.name ?? null, cookies: result.cookies };
    });
  }

  public session(stored: SessionCookies): IMessengerSession {
    return new HelperSession(this.logger, this.options, stored, this.sessions);
  }

  public async close(): Promise<void> {
    await Promise.all([...this.sessions].map((session) => session.stop()));
  }

  /** A run for one job, stopped after it. */
  private async once<T>(job: (run: HelperRun) => Promise<T>): Promise<T> {
    if (!this.isAvailable()) {
      throw new HuginnError(
        ErrorCode.Unsupported,
        'The Messenger helper is missing from this build'
      );
    }

    const run = await HelperRun.start(this.logger, this.options);

    try {
      return await job(run);
    } finally {
      await run.stop();
    }
  }
}

const parseJson = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};
