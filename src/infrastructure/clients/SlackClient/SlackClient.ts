import { SocketModeClient } from '@slack/socket-mode';
import { LogLevel, WebClient } from '@slack/web-api';
import type { Logger } from '@/lib/logger';
import type {
  ISlackClient,
  SlackChannelInfo,
  SlackIdentity,
  SlackMessageEvent,
  SlackMessageHandler,
  SlackPostedMessage,
  SlackUserGroup,
} from '@/core/clients/SlackClient/SlackClient.types';
import { ErrorCode, HuginnError, toError } from '@/core/errors/errors';

export interface SlackClientConfig {
  /** xoxp- user token: reads and writes as the user. */
  readonly userToken: string;
  /** xapp- app-level token with connections:write: opens the Socket Mode websocket. */
  readonly appToken: string;
}

interface SocketEnvelope {
  readonly ack: () => Promise<void>;
  readonly event: SlackMessageEvent;
}

export class SlackClient implements ISlackClient {
  private readonly web: WebClient;
  private socket: SocketModeClient | null = null;
  // Names change rarely and every message references a few; one lookup per id
  // per process keeps us far below Slack's tier-4 limit on users.info.
  private readonly userNames = new Map<string, Promise<string>>();
  private readonly channels = new Map<string, Promise<SlackChannelInfo>>();

  constructor(
    private readonly logger: Logger,
    private readonly config: SlackClientConfig
  ) {
    this.web = new WebClient(config.userToken, { logLevel: LogLevel.ERROR });
  }

  public async identify(): Promise<SlackIdentity> {
    const auth = await this.call(() => this.web.auth.test());

    if (!auth.user_id || !auth.team_id || !auth.url) {
      throw new HuginnError(ErrorCode.Upstream, 'auth.test returned no identity');
    }

    return { userId: auth.user_id, teamId: auth.team_id, teamUrl: auth.url };
  }

  public async myUserGroups(userId: string): Promise<readonly SlackUserGroup[]> {
    try {
      const groups = await this.web.usergroups.list({ include_users: true });

      return (groups.usergroups ?? [])
        .filter((group) => group.users?.includes(userId) && group.id)
        .map((group) => ({ id: group.id ?? '', handle: group.handle ?? group.name ?? 'group' }));
    } catch (error) {
      // usergroups:read is optional; without it, group mentions are just not detected.
      this.logger.info({ err: toError(error) }, 'slack user groups unavailable');

      return [];
    }
  }

  public userName(userId: string): Promise<string> {
    const cached = this.userNames.get(userId);

    if (cached) {
      return cached;
    }

    const lookup = this.web.users
      .info({ user: userId })
      // display_name is "" for anyone who never set one, so the first non-empty wins.
      .then(
        (response) =>
          [
            response.user?.profile?.display_name,
            response.user?.real_name,
            response.user?.name,
          ].find((name) => name !== undefined && name !== '') ?? userId
      )
      .catch(() => userId);

    this.userNames.set(userId, lookup);

    return lookup;
  }

  public channelInfo(channelId: string): Promise<SlackChannelInfo> {
    const cached = this.channels.get(channelId);

    if (cached) {
      return cached;
    }

    const lookup = this.web.conversations
      .info({ channel: channelId })
      .then((response) => ({
        id: channelId,
        name: response.channel?.name ?? channelId,
        isIm: response.channel?.is_im ?? false,
        isMpim: response.channel?.is_mpim ?? false,
      }))
      .catch(() => ({ id: channelId, name: channelId, isIm: false, isMpim: false }));

    this.channels.set(channelId, lookup);

    return lookup;
  }

  public async postMessage(
    channel: string,
    text: string,
    threadTs?: string
  ): Promise<SlackPostedMessage> {
    const response = await this.call(() =>
      this.web.chat.postMessage({ channel, text, thread_ts: threadTs })
    );

    return { channel: response.channel ?? channel, ts: response.ts ?? '' };
  }

  public async addReaction(channel: string, ts: string, emoji: string): Promise<void> {
    await this.call(() => this.web.reactions.add({ channel, timestamp: ts, name: emoji }));
  }

  public async listen(onMessage: SlackMessageHandler): Promise<void> {
    const socket = new SocketModeClient({
      appToken: this.config.appToken,
      logLevel: LogLevel.ERROR,
    });

    socket.on('message', ({ ack, event }: SocketEnvelope) => {
      // Ack first: Slack redelivers anything not acked within 3 s, and handling can
      // take longer than that (name lookups). Upserts are idempotent anyway.
      void ack();
      onMessage(event);
    });

    this.socket = socket;
    await socket.start();
  }

  public async close(): Promise<void> {
    const socket = this.socket;

    this.socket = null;

    if (socket) {
      await socket.disconnect();
    }
  }

  private async call<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      const err = toError(error);

      throw new HuginnError(ErrorCode.Upstream, `Slack: ${err.message}`);
    }
  }
}
