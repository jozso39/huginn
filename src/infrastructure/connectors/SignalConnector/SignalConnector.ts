import type { Logger } from '@/lib/logger';
import type {
  ISignalClient,
  SignalDataMessage,
  SignalEnvelope,
} from '@/core/clients/SignalClient/SignalClient.types';
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
import type { SignalItemRaw } from './SignalConnector.types';
import {
  EMOJI_BY_NAME,
  conversationKey,
  incomingToItem,
  messageText,
  readMessageIds,
  sentTarget,
} from './SignalConnector.utils';

/**
 * The user's own Signal account as a linked device: messages to them come in, what
 * they send or read on the phone closes the conversation here, and replies and
 * reactions go out as them. signal-cli does the protocol; this maps envelopes.
 */
export class SignalConnector implements IConnector {
  public static readonly capabilities: ConnectorCapabilities = {
    reply: true,
    draft: false,
    react: true,
    ack: false,
  };
  public readonly kind = ConnectorKind.Signal;
  public readonly capabilities = SignalConnector.capabilities;
  private ctx: ConnectorContext | null = null;
  // One at a time, so "I answered on the phone" never overtakes the message it answers.
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly logger: Logger,
    private readonly connection: Connection,
    private readonly client: ISignalClient,
    private readonly account: string,
    private readonly maxBodyChars: number
  ) {}

  public async start(ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx;

    try {
      await this.client.subscribe(this.account, (envelope) => {
        this.queue = this.queue.then(() => this.handle(envelope));
      });
    } catch (error) {
      if (error instanceof HuginnError && error.code === ErrorCode.Unauthorized) {
        await ctx.report(ConnectionStatus.NeedsAuth, error.message);

        return;
      }

      throw error;
    }
  }

  public async stop(): Promise<void> {
    this.client.unsubscribe(this.account);
    await this.queue;
    this.ctx = null;
  }

  public async reply(item: Item, text: string): Promise<ActionResult> {
    const raw = item.raw as SignalItemRaw;

    try {
      const sent = await this.client.send(this.account, raw.target, text, {
        timestamp: raw.timestamp,
        author: raw.author,
        text: raw.text,
      });

      return { ok: true, ref: String(sent.timestamp) };
    } catch (error) {
      return { ok: false, error: toError(error).message };
    }
  }

  public async react(item: Item, emoji: string): Promise<ActionResult> {
    const raw = item.raw as SignalItemRaw;
    const char = EMOJI_BY_NAME[emoji];

    if (!char) {
      return { ok: false, error: `Signal needs a real emoji; ${emoji} is not one Huginn knows` };
    }

    try {
      await this.client.react(this.account, raw.target, char, raw.author, raw.timestamp);

      return { ok: true, ref: `${raw.timestamp}:${char}` };
    } catch (error) {
      return { ok: false, error: toError(error).message };
    }
  }

  private async handle(envelope: SignalEnvelope): Promise<void> {
    const ctx = this.ctx;

    if (!ctx) {
      return;
    }

    try {
      const sent = envelope.syncMessage?.sentMessage;
      const reads = envelope.syncMessage?.readMessages;

      if (sent) {
        const target = sentTarget(sent);

        if (target) {
          await ctx.closeThread(conversationKey(target));
        }

        return;
      }

      if (reads && reads.length > 0) {
        await ctx.closeItems(readMessageIds(reads));

        return;
      }

      const edit = envelope.editMessage;

      if (edit) {
        // Same id as the original, so the item's text is replaced, not duplicated.
        await this.ingest(envelope, { ...edit.dataMessage, timestamp: edit.targetSentTimestamp });

        return;
      }

      if (envelope.dataMessage) {
        await this.ingest(envelope, envelope.dataMessage);
      }
    } catch (error) {
      this.logger.warn(
        { connectionId: this.connection.id, err: toError(error) },
        'signal envelope dropped'
      );
    }
  }

  private async ingest(envelope: SignalEnvelope, message: SignalDataMessage): Promise<void> {
    const ctx = this.ctx;
    const text = messageText(message);

    if (!ctx || text === null || envelope.sourceNumber === this.account) {
      return;
    }

    const group = message.groupInfo;
    const groupName =
      group && !group.groupName ? await this.client.groupName(this.account, group.groupId) : null;

    await ctx.upsert(
      incomingToItem(envelope, message, text, {
        connectionId: this.connection.id,
        account: this.account,
        accountUuid: null,
        groupName,
        maxBodyChars: this.maxBodyChars,
      })
    );
  }
}
