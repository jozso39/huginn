import type { Logger } from '@/lib/logger';
import type {
  ClickUpTask,
  ClickUpUser,
  IClickUpClient,
} from '@/core/clients/ClickUpClient/ClickUpClient.types';
import type { Connection } from '@/core/connections/Connection.types';
import { ConnectionStatus, ConnectorKind } from '@/core/connections/Connection.types';
import type {
  ActionResult,
  ConnectorCapabilities,
  ConnectorContext,
  IConnector,
} from '@/core/connectors/Connector.types';
import { ErrorCode, HuginnError, toError } from '@/core/errors/errors';
import type { Item } from '@/core/items/Item.types';
import type { ClickUpCursor, ClickUpItemRaw } from './ClickUpConnector.types';
import {
  assignmentToItem,
  commentToItem,
  decideComments,
  isNewAssignment,
  taskThreadKey,
} from './ClickUpConnector.utils';

/** The first sync shows comments from this far back. */
const FIRST_SYNC_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
/**
 * ClickUp allows 100 requests a minute per token. One poll is one task query plus
 * one comment fetch per changed task; capping the tasks keeps a busy minute far
 * below the limit, and the rest simply waits for the next poll.
 */
const MAX_TASKS_PER_POLL = 25;
const COMMENT_FETCH_CONCURRENCY = 5;
/** Below this many requests left in the window, skip a poll rather than hit a 429. */
const MIN_RATE_REMAINING = 15;
const MAX_KNOWN_TASKS = 3000;

/**
 * ClickUp has no notifications API (not on its roadmap), so this polls the tasks
 * assigned to the user: a newly assigned task and new comments on those tasks come
 * in; the user's own comment closes the task's conversation.
 */
export class ClickUpConnector implements IConnector {
  public static readonly capabilities: ConnectorCapabilities = {
    reply: true,
    draft: false,
    react: false,
    ack: false,
  };
  public readonly kind = ConnectorKind.ClickUp;
  public readonly capabilities = ClickUpConnector.capabilities;
  private ctx: ConnectorContext | null = null;
  private me: ClickUpUser | null = null;
  private workspaceId = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling: Promise<void> = Promise.resolve();

  constructor(
    private readonly logger: Logger,
    private readonly connection: Connection,
    private readonly client: IClickUpClient,
    private readonly configuredWorkspaceId: string | null,
    private readonly pollMs: number,
    private readonly maxBodyChars: number
  ) {}

  public async start(ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx;
    this.me = await this.client.me();
    this.workspaceId = await this.resolveWorkspace();

    const cursor = ctx.getCursor() as ClickUpCursor;

    if (!cursor.updatedSince || cursor.workspaceId !== this.workspaceId) {
      // Everything already assigned is backlog, not news: remember it so only
      // assignments from now on become items.
      const known = await this.client.myOpenTaskIds(this.workspaceId, this.me.id);

      await ctx.setCursor({
        updatedSince: Date.now() - FIRST_SYNC_LOOKBACK_MS,
        knownTasks: known,
        workspaceId: this.workspaceId,
      });
    }

    await this.poll();
    this.timer = setInterval(() => {
      this.polling = this.polling.then(() => this.safePoll());
    }, this.pollMs);
  }

  public async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await this.polling;
    this.ctx = null;
  }

  public async reply(item: Item, text: string): Promise<ActionResult> {
    const raw = item.raw as ClickUpItemRaw;

    try {
      // A comment gets a threaded reply; an assignment gets a comment on the task.
      const posted = raw.commentId
        ? await this.client.replyToComment(raw.commentId, text)
        : await this.client.commentOnTask(raw.taskId, text);

      return { ok: true, ref: posted.id, url: item.url ?? undefined };
    } catch (error) {
      return { ok: false, error: toError(error).message };
    }
  }

  private async resolveWorkspace(): Promise<string> {
    if (this.configuredWorkspaceId) {
      return this.configuredWorkspaceId;
    }

    const workspaces = await this.client.workspaces();

    if (workspaces.length === 1 && workspaces[0]) {
      return workspaces[0].id;
    }

    throw new HuginnError(
      ErrorCode.Validation,
      `This token sees ${workspaces.length} workspaces — set Workspace ID to one of: ${workspaces
        .map((workspace) => `${workspace.name} (${workspace.id})`)
        .join(', ')}`
    );
  }

  private async safePoll(): Promise<void> {
    try {
      await this.poll();
    } catch (error) {
      const err = toError(error);

      this.logger.warn({ connectionId: this.connection.id, err }, 'clickup poll failed');
      await this.ctx?.report(ConnectionStatus.Error, err.message);
    }
  }

  private async poll(): Promise<void> {
    const ctx = this.ctx;
    const me = this.me;

    if (!ctx || !me) {
      return;
    }

    const remaining = this.client.rateLimitRemaining();

    if (remaining !== null && remaining < MIN_RATE_REMAINING) {
      await ctx.report(
        ConnectionStatus.Running,
        `ClickUp rate limit nearly used (${remaining} left this minute) — skipped a check`
      );

      return;
    }

    const cursor = ctx.getCursor() as ClickUpCursor;
    const since = cursor.updatedSince ?? Date.now() - FIRST_SYNC_LOOKBACK_MS;
    const known = new Set(cursor.knownTasks ?? []);
    const changed = await this.client.myTasksUpdatedSince(this.workspaceId, me.id, since);
    // Oldest first, so when the cap cuts the list the cursor stops where work stopped.
    const batch = [...changed]
      .sort((a, b) => Number(a.date_updated ?? 0) - Number(b.date_updated ?? 0))
      .slice(0, MAX_TASKS_PER_POLL);

    await ClickUpConnector.inChunks(batch, COMMENT_FETCH_CONCURRENCY, (task) =>
      this.processTask(ctx, me, task, known, since)
    );

    const newest = Math.max(since, ...batch.map((task) => Number(task.date_updated ?? 0)));

    await ctx.setCursor({
      updatedSince: newest,
      knownTasks: [...new Set([...batch.map((task) => task.id), ...known])].slice(
        0,
        MAX_KNOWN_TASKS
      ),
      workspaceId: this.workspaceId,
    });
    await ctx.report(ConnectionStatus.Running, null);
  }

  private async processTask(
    ctx: ConnectorContext,
    me: ClickUpUser,
    task: ClickUpTask,
    known: ReadonlySet<string>,
    since: number
  ): Promise<void> {
    if (isNewAssignment(task, known)) {
      await ctx.upsert(assignmentToItem(this.connection.id, task, this.maxBodyChars));
    }

    const decision = decideComments(await this.client.taskComments(task.id), me, since);

    if (decision.answered) {
      await ctx.closeThread(taskThreadKey(task.id));
    }

    await Promise.all(
      decision.incoming.map((comment) =>
        ctx.upsert(commentToItem(this.connection.id, task, comment, me, this.maxBodyChars))
      )
    );
  }

  /** Runs `work` over `items` a few at a time, to stay gentle on the rate limit. */
  private static async inChunks<T>(
    items: readonly T[],
    size: number,
    work: (item: T) => Promise<void>
  ): Promise<void> {
    const chunks = Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
      items.slice(index * size, index * size + size)
    );

    await chunks.reduce<Promise<void>>(
      (previous, chunk) => previous.then(() => Promise.all(chunk.map(work)).then(() => undefined)),
      Promise.resolve()
    );
  }
}
