import type { Logger } from '@/lib/logger';
import type {
  IMessengerSession,
  MessengerEvent,
} from '@/core/clients/MessengerClient/MessengerClient.types';
import { MessengerEventType } from '@/core/clients/MessengerClient/MessengerClient.types';
import type { Connection } from '@/core/connections/Connection.types';
import { ConnectionStatus, ConnectorKind } from '@/core/connections/Connection.types';
import type {
  ConnectorCapabilities,
  ConnectorContext,
  IConnector,
} from '@/core/connectors/Connector.types';
import { ErrorCode, HuginnError, toError } from '@/core/errors/errors';
import { incomingToItem, threadKeyOf } from './MessengerConnector.utils';

const LOGGED_OUT = 'Facebook ended the session — log in again';

/**
 * The user's own Messenger, signed in on Facebook's page in Huginn's login window and
 * registered as a device of the account, so encrypted chats come in too. For now it only
 * reads: what the user writes or reads elsewhere closes the conversation here, and Done
 * closes it in Huginn only.
 */
export class MessengerConnector implements IConnector {
  public static readonly capabilities: ConnectorCapabilities = {
    reply: false,
    draft: false,
    react: false,
    ack: false,
    trash: false,
  };
  public readonly kind = ConnectorKind.Messenger;
  public readonly capabilities = MessengerConnector.capabilities;
  private ctx: ConnectorContext | null = null;
  // One at a time, so "I answered on the phone" never overtakes the message it answers.
  private queue: Promise<void> = Promise.resolve();
  // Once Facebook has ended the session, its last cookies must not overwrite new ones.
  private loggedOut = false;

  constructor(
    private readonly logger: Logger,
    private readonly connection: Connection,
    private readonly session: IMessengerSession,
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
        this.loggedOut = true;
        await ctx.report(ConnectionStatus.NeedsAuth, LOGGED_OUT);

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

  private async handle(event: MessengerEvent): Promise<void> {
    const ctx = this.ctx;

    if (!ctx) {
      return;
    }

    try {
      switch (event.type) {
        case MessengerEventType.Message:
          await ctx.markSynced();

          if (event.message.fromMe) {
            await ctx.closeThread(threadKeyOf(event.message.threadId));
          } else {
            await ctx.upsert(
              incomingToItem(event.message, {
                connectionId: this.connection.id,
                maxBodyChars: this.maxBodyChars,
              })
            );
          }

          break;
        case MessengerEventType.Read:
          await ctx.closeThread(threadKeyOf(event.threadId));
          break;
        case MessengerEventType.Connected:
          await ctx.markSynced();
          break;
        case MessengerEventType.Disconnected:
          break;
        case MessengerEventType.LoggedOut:
          this.loggedOut = true;
          await ctx.report(ConnectionStatus.NeedsAuth, LOGGED_OUT);
          break;
        case MessengerEventType.Cookies:
          if (!this.loggedOut) {
            await ctx.saveSecrets({
              account: this.account,
              cookies: JSON.stringify(event.cookies),
            });
          }

          break;
      }
    } catch (error) {
      this.logger.warn(
        { connectionId: this.connection.id, event: event.type, err: toError(error) },
        'messenger event dropped'
      );
    }
  }
}
