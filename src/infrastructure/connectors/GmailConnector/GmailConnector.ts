import type { Logger } from '@/lib/logger';
import type {
  GmailHistoryRecord,
  IGmailClient,
} from '@/core/clients/GmailClient/GmailClient.types';
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
import type { GmailItemRaw } from './GmailConnector.types';
import type { GmailInboxScope } from './GmailConnector.types';
import { backfillQuery, buildReply, isWanted, messageToItem } from './GmailConnector.utils';

/** How far back the first sync (and a resync after a long outage) reaches. */
const BACKFILL_DAYS = 7;
const BACKFILL_MAX = 50;

interface GmailCursor {
  readonly historyId?: string;
  readonly mailbox?: string;
}

interface HistoryChanges {
  readonly toFetch: ReadonlySet<string>;
  readonly toClose: ReadonlySet<string>;
  readonly answeredThreads: ReadonlySet<string>;
}

/**
 * Follows one mailbox through Gmail's history API: new unread inbox mail comes in;
 * mail read, archived or answered anywhere else leaves. Because history is kept
 * for about a week, mail that arrived while Huginn was down is caught up on start.
 */
export class GmailConnector implements IConnector {
  public static readonly capabilities: ConnectorCapabilities = {
    reply: true,
    draft: true,
    react: false,
    ack: true,
  };
  public readonly kind = ConnectorKind.Gmail;
  public readonly capabilities = GmailConnector.capabilities;
  private ctx: ConnectorContext | null = null;
  private mailbox = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling: Promise<void> = Promise.resolve();

  constructor(
    private readonly logger: Logger,
    private readonly connection: Connection,
    private readonly client: IGmailClient,
    private readonly scope: GmailInboxScope,
    private readonly pollMs: number,
    private readonly maxBodyChars: number
  ) {}

  public async start(ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx;

    try {
      const profile = await this.client.profile();
      const cursor = ctx.getCursor() as GmailCursor;

      this.mailbox = profile.emailAddress;

      // A cursor from another mailbox (the connection was re-signed with a different
      // account) is meaningless here; start over like a first sync.
      if (cursor.historyId && cursor.mailbox === profile.emailAddress) {
        await this.poll();
      } else {
        await this.resync(profile.historyId);
      }
    } catch (error) {
      if (await this.handleAuthFailure(error)) {
        return;
      }

      throw error;
    }

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

  public reply(item: Item, text: string): Promise<ActionResult> {
    const raw = item.raw as GmailItemRaw;

    return this.act(async () => {
      const sent = await this.client.send(buildReply(raw, text), raw.threadId);

      return { ok: true, ref: sent.id, url: item.url ?? undefined };
    });
  }

  public draft(item: Item, text: string): Promise<ActionResult> {
    const raw = item.raw as GmailItemRaw;

    return this.act(async () => {
      const draft = await this.client.createDraft(buildReply(raw, text), raw.threadId);

      return { ok: true, ref: draft.id, url: item.url ?? undefined };
    });
  }

  public ack(item: Item): Promise<ActionResult> {
    const raw = item.raw as GmailItemRaw;

    return this.act(async () => {
      await this.client.markRead(raw.id);

      return { ok: true, ref: raw.id };
    });
  }

  private async act(action: () => Promise<ActionResult>): Promise<ActionResult> {
    try {
      return await action();
    } catch (error) {
      return { ok: false, error: toError(error).message };
    }
  }

  private async safePoll(): Promise<void> {
    try {
      await this.poll();
      await this.ctx?.report(ConnectionStatus.Running, null);
    } catch (error) {
      if (await this.handleAuthFailure(error)) {
        return;
      }

      const err = toError(error);

      this.logger.warn({ connectionId: this.connection.id, err }, 'gmail poll failed');
      await this.ctx?.report(ConnectionStatus.Error, err.message);
    }
  }

  /** A revoked or expired grant is not something a retry fixes: stop and ask for sign-in. */
  private async handleAuthFailure(error: unknown): Promise<boolean> {
    if (!(error instanceof HuginnError) || error.code !== ErrorCode.Unauthorized) {
      return false;
    }

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await this.ctx?.report(ConnectionStatus.NeedsAuth, `${error.message} — sign in again`);

    return true;
  }

  private async poll(): Promise<void> {
    const ctx = this.ctx;
    const cursor = ctx?.getCursor() as GmailCursor | undefined;

    if (!ctx || !cursor?.historyId) {
      return;
    }

    const history = await this.client.history(cursor.historyId);

    if (!history) {
      // Older than Gmail keeps: fall back to a fresh first sync.
      const profile = await this.client.profile();

      await this.resync(profile.historyId);

      return;
    }

    const changes = GmailConnector.collect(history.records);

    await Promise.all([...changes.answeredThreads].map((threadId) => ctx.closeThread(threadId)));
    await this.fetchAndUpsert([...changes.toFetch]);
    await ctx.closeItems([...changes.toClose]);
    await ctx.setCursor({ historyId: history.historyId, mailbox: this.mailbox });
  }

  private async resync(historyId: string): Promise<void> {
    const ctx = this.ctx;

    if (!ctx) {
      return;
    }

    // Take the history id before searching, so nothing arriving in between is lost.
    const ids = await this.client.searchMessageIds(
      backfillQuery(this.scope, BACKFILL_DAYS),
      BACKFILL_MAX
    );

    await this.fetchAndUpsert([...ids]);
    await ctx.setCursor({ historyId, mailbox: this.mailbox });
  }

  private async fetchAndUpsert(ids: readonly string[]): Promise<void> {
    const ctx = this.ctx;

    if (!ctx) {
      return;
    }

    const messages = await Promise.all(
      ids.map((id) =>
        // A message deleted between the history entry and now is simply gone.
        this.client.getMessage(id).catch(() => null)
      )
    );

    await Promise.all(
      messages
        .filter((message) => message !== null)
        // Re-check the current labels: it may have been read or archived meanwhile.
        .filter((message) => {
          const labels = message.labelIds ?? [];

          return labels.includes('UNREAD') && isWanted(labels, this.scope);
        })
        .map((message) =>
          ctx.upsert(messageToItem(this.connection.id, message, this.mailbox, this.maxBodyChars))
        )
    );
  }

  private static collect(records: readonly GmailHistoryRecord[]): HistoryChanges {
    const added = records.flatMap((record) => record.messagesAdded ?? []);
    const labelled = records.flatMap((record) => record.labelsAdded ?? []);
    const unlabelled = records.flatMap((record) => record.labelsRemoved ?? []);

    return {
      // Mail I sent in a thread means I answered it, wherever I did that.
      answeredThreads: new Set(
        added
          .filter(({ message }) => message.labelIds?.includes('SENT'))
          .map(({ message }) => message.threadId)
      ),
      toFetch: new Set([
        ...added
          .filter(({ message }) => !message.labelIds?.includes('SENT'))
          .map(({ message }) => message.id),
        // Moved back into the inbox, or marked unread again.
        ...labelled
          .filter(({ labelIds }) => labelIds.includes('INBOX') || labelIds.includes('UNREAD'))
          .map(({ message }) => message.id),
      ]),
      // Read or archived somewhere else: dealt with.
      toClose: new Set(
        unlabelled
          .filter(({ labelIds }) => labelIds.includes('UNREAD') || labelIds.includes('INBOX'))
          .map(({ message }) => message.id)
      ),
    };
  }
}
