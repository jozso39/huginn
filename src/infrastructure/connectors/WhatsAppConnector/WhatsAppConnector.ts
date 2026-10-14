import type { Logger } from '@/lib/logger';
import type {
  IWhatsAppSession,
  WhatsAppEvent,
} from '@/core/clients/WhatsAppClient/WhatsAppClient.types';
import { WhatsAppEventType } from '@/core/clients/WhatsAppClient/WhatsAppClient.types';
import type { Connection } from '@/core/connections/Connection.types';
import { ConnectionStatus, ConnectorKind } from '@/core/connections/Connection.types';
import type {
  ActionResult,
  ConnectorCapabilities,
  ConnectorContext,
  IConnector,
} from '@/core/connectors/Connector.types';
import { emojiOf, isShortName, shortNameOf } from '@/core/emoji/emoji.utils';
import { ErrorCode, HuginnError, toError } from '@/core/errors/errors';
import type { Item } from '@/core/items/Item.types';
import type { WhatsAppItemRaw } from './WhatsAppConnector.types';
import { chatKey, incomingToItem } from './WhatsAppConnector.utils';

/**
 * The user's own WhatsApp account as a linked device: messages to them come in, what
 * they send or read on the phone closes the conversation here, and replies, reactions
 * and read receipts go out as them. The client does the protocol; this maps events.
 */
export class WhatsAppConnector implements IConnector {
  public static readonly capabilities: ConnectorCapabilities = {
    reply: true,
    draft: false,
    react: true,
    // Done sends read receipts, as reading on the phone would.
    ack: true,
  };
  public readonly kind = ConnectorKind.WhatsApp;
  public readonly capabilities = WhatsAppConnector.capabilities;
  private ctx: ConnectorContext | null = null;
  // One at a time, so "I answered on the phone" never overtakes the message it answers.
  private queue: Promise<void> = Promise.resolve();
  // Once the phone has unlinked Huginn, its old keys must never overwrite new ones.
  private unlinked = false;

  constructor(
    private readonly logger: Logger,
    private readonly connection: Connection,
    private readonly session: IWhatsAppSession,
    private readonly account: string,
    private readonly maxBodyChars: number
  ) {}

  public async start(ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx;

    try {
      await this.session.start((event) => {
        this.queue = this.queue.then(() => this.handle(event));
      });
      await ctx.markSynced();
    } catch (error) {
      if (error instanceof HuginnError && error.code === ErrorCode.Unauthorized) {
        this.unlinked = true;
        await ctx.report(ConnectionStatus.NeedsAuth, error.message);

        return;
      }

      throw error;
    }
  }

  public async stop(): Promise<void> {
    await this.session.stop();
    await this.queue;
    this.ctx = null;
  }

  public async reply(item: Item, text: string): Promise<ActionResult> {
    const raw = item.raw as WhatsAppItemRaw;

    try {
      const sent = await this.session.send(raw.chat, text, raw);

      return { ok: true, ref: sent.id };
    } catch (error) {
      return { ok: false, error: toError(error).message };
    }
  }

  public async react(item: Item, emoji: string): Promise<ActionResult> {
    const raw = item.raw as WhatsAppItemRaw;
    // WhatsApp reacts with the emoji itself; a Slack-style short name is turned into one.
    const char = isShortName(emoji) ? emojiOf(emoji) : shortNameOf(emoji) ? emoji : null;

    if (!char) {
      return { ok: false, error: `${emoji} is not an emoji Huginn can react with` };
    }

    try {
      await this.session.react(raw, char);

      return { ok: true, ref: `${raw.id}:${char}` };
    } catch (error) {
      return { ok: false, error: toError(error).message };
    }
  }

  public async ack(item: Item): Promise<ActionResult> {
    try {
      await this.session.markRead(item.raw as WhatsAppItemRaw);

      return { ok: true };
    } catch (error) {
      return { ok: false, error: toError(error).message };
    }
  }

  private async handle(event: WhatsAppEvent): Promise<void> {
    const ctx = this.ctx;

    if (!ctx) {
      return;
    }

    try {
      switch (event.type) {
        case WhatsAppEventType.Message:
          await ctx.markSynced();
          await ctx.upsert(
            incomingToItem(event.message, {
              connectionId: this.connection.id,
              maxBodyChars: this.maxBodyChars,
            })
          );
          break;
        case WhatsAppEventType.Sent:
          await ctx.closeThread(chatKey(event.chat));
          break;
        case WhatsAppEventType.Read:
          await ctx.closeItems(event.ids);
          break;
        case WhatsAppEventType.Connected:
          await ctx.markSynced();
          break;
        case WhatsAppEventType.LoggedOut:
          this.unlinked = true;
          await ctx.report(ConnectionStatus.NeedsAuth, 'Unlinked on the phone — link it again');
          break;
        case WhatsAppEventType.Auth:
          if (!this.unlinked) {
            await ctx.saveSecrets({ account: this.account, auth: event.auth });
          }

          break;
      }
    } catch (error) {
      this.logger.warn(
        { connectionId: this.connection.id, event: event.type, err: toError(error) },
        'whatsapp event dropped'
      );
    }
  }
}
