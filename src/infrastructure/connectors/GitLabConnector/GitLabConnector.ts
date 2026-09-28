import type { Logger } from '@/lib/logger';
import type { GitLabTodo, IGitLabClient } from '@/core/clients/GitLabClient/GitLabClient.types';
import type { Connection } from '@/core/connections/Connection.types';
import { ConnectionStatus, ConnectorKind } from '@/core/connections/Connection.types';
import type {
  ActionResult,
  ConnectorCapabilities,
  ConnectorContext,
  IConnector,
} from '@/core/connectors/Connector.types';
import { toError } from '@/core/errors/errors';
import type { Item } from '@/core/items/Item.types';
import { todoExternalId, todoToItem } from './GitLabConnector.utils';

/**
 * Polls GitLab's todo list — the closest thing GitLab has to a notification
 * feed — and mirrors it: a todo that disappears there is closed here.
 */
export class GitLabConnector implements IConnector {
  public readonly kind = ConnectorKind.GitLab;
  public static readonly capabilities: ConnectorCapabilities = {
    reply: true,
    draft: false,
    react: false,
    ack: true,
  };
  public readonly capabilities = GitLabConnector.capabilities;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ctx: ConnectorContext | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly connection: Connection,
    private readonly client: IGitLabClient,
    private readonly pollMs: number,
    private readonly maxBodyChars: number
  ) {}

  public async start(ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx;
    // The first poll runs inline so a bad token fails start() and gets the
    // host's backoff instead of failing quietly every minute.
    await this.poll();
    this.timer = setInterval(() => void this.safePoll(), this.pollMs);
  }

  public stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.ctx = null;

    return Promise.resolve();
  }

  public async reply(item: Item, text: string): Promise<ActionResult> {
    const todo = item.raw as GitLabTodo;

    if (!todo.project) {
      return { ok: false, error: 'todo has no project to comment in' };
    }

    try {
      const note = await this.client.createNote(
        todo.project.id,
        todo.target_type,
        todo.target.iid,
        text
      );

      return { ok: true, ref: String(note.id), url: note.url };
    } catch (error) {
      return { ok: false, error: toError(error).message };
    }
  }

  public async ack(item: Item): Promise<ActionResult> {
    const todo = item.raw as GitLabTodo;

    try {
      await this.client.markTodoDone(todo.id);

      return { ok: true, ref: String(todo.id) };
    } catch (error) {
      return { ok: false, error: toError(error).message };
    }
  }

  private async safePoll(): Promise<void> {
    try {
      await this.poll();
      await this.ctx?.report(ConnectionStatus.Running, null);
    } catch (error) {
      // Transient: keep the interval, surface the message on the connection.
      const err = toError(error);

      this.logger.warn({ connectionId: this.connection.id, err }, 'gitlab poll failed');
      await this.ctx?.report(ConnectionStatus.Error, err.message);
    }
  }

  private async poll(): Promise<void> {
    const ctx = this.ctx;

    if (!ctx) {
      return;
    }

    const todos = await this.client.listPendingTodos();

    await Promise.all(
      todos.map((todo) => ctx.upsert(todoToItem(this.connection.id, todo, this.maxBodyChars)))
    );
    await ctx.closeOpenExcept(todos.map(todoExternalId));
    await ctx.setCursor({ lastPollAt: new Date().toISOString(), pending: todos.length });
  }
}
