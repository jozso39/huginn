import { ErrorCode as SlackErrorCode, LogLevel, WebClient } from '@slack/web-api';
import type { Logger } from '@/lib/logger';
import type {
  ISlackClient,
  SlackChannelInfo,
  SlackIdentity,
  SlackMessageEvent,
  SlackPostedMessage,
  SlackSearchPage,
  SlackUserGroup,
} from '@/core/clients/SlackClient/SlackClient.types';
import type { SlackTokens } from '@/core/clients/SlackOAuthClient/SlackOAuthClient.types';
import { ErrorCode, HuginnError, toError } from '@/core/errors/errors';

export interface SlackClientConfig {
  readonly tokens: SlackTokens;
  /** New tokens from the refresh token; null when the tokens never expire. */
  readonly refresh: ((refreshToken: string) => Promise<SlackTokens>) | null;
}

// Refreshed this long before they expire, so no call goes out with a dying token.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
// What Slack says when only signing in again helps.
const SIGN_IN_AGAIN = new Set([
  'invalid_auth',
  'not_authed',
  'token_revoked',
  'token_expired',
  'account_inactive',
]);

const slackErrorOf = (error: unknown): string | null => {
  const coded = error as { code?: string; data?: { error?: string } };

  return coded.code === SlackErrorCode.PlatformError ? (coded.data?.error ?? null) : null;
};

/**
 * Slack as the signed-in person, with their own user token. Rotating tokens (PKCE
 * sign-ins) are refreshed before they expire and handed to `onTokens` to be kept.
 */
export class SlackClient implements ISlackClient {
  private tokens: SlackTokens;
  private web: WebClient;
  private refreshing: Promise<WebClient> | null = null;
  private tokensHandler: ((tokens: SlackTokens) => Promise<void>) | null = null;
  // Names change rarely and every message references a few; one lookup per id
  // per process keeps us far below Slack's limit on users.info.
  private readonly userNames = new Map<string, Promise<string>>();
  private readonly channels = new Map<string, Promise<SlackChannelInfo>>();

  constructor(
    private readonly logger: Logger,
    private readonly config: SlackClientConfig
  ) {
    this.tokens = config.tokens;
    this.web = SlackClient.webClient(config.tokens.accessToken);
  }

  public onTokens(handler: (tokens: SlackTokens) => Promise<void>): void {
    this.tokensHandler = handler;
  }

  public async identify(): Promise<SlackIdentity> {
    const auth = await this.call((web) => web.auth.test());

    if (!auth.user_id || !auth.team_id || !auth.url) {
      throw new HuginnError(ErrorCode.Upstream, 'auth.test returned no identity');
    }

    return { userId: auth.user_id, teamId: auth.team_id, teamUrl: auth.url };
  }

  public async myUserGroups(userId: string): Promise<readonly SlackUserGroup[]> {
    try {
      const groups = await this.call((web) => web.usergroups.list({ include_users: true }));

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

    const lookup = this.call((web) => web.users.info({ user: userId }))
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

    const lookup = this.call((web) => web.conversations.info({ channel: channelId }))
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

  public async lastRead(channelId: string): Promise<string | null> {
    // Not cached: it moves whenever the user reads, on any device.
    const response = await this.call((web) => web.conversations.info({ channel: channelId }));

    return response.channel?.last_read ?? null;
  }

  public async myChannels(): Promise<readonly SlackChannelInfo[]> {
    const collect = async (
      cursor: string | undefined,
      acc: readonly SlackChannelInfo[]
    ): Promise<readonly SlackChannelInfo[]> => {
      const page = await this.call((web) =>
        web.users.conversations({
          types: 'public_channel,private_channel',
          exclude_archived: true,
          limit: 1000,
          cursor,
        })
      );
      const channels = [
        ...acc,
        ...(page.channels ?? []).map((channel) => ({
          id: channel.id ?? '',
          name: channel.name ?? channel.id ?? '',
          isIm: false,
          isMpim: false,
        })),
      ];
      const next = page.response_metadata?.next_cursor;

      return next ? collect(next, channels) : channels;
    };

    return collect(undefined, []);
  }

  public async search(query: string, page: number): Promise<SlackSearchPage> {
    const response = await this.call((web) =>
      web.search.messages({
        query,
        sort: 'timestamp',
        sort_dir: 'desc',
        count: 100,
        page,
        highlight: false,
      })
    );
    const messages = response.messages;

    return {
      matches: (messages?.matches ?? [])
        .filter((match) => match.ts && match.channel?.id)
        .map((match) => ({
          // Search carries the message's own blocks, attachments and files too.
          ...(match as object),
          ts: match.ts ?? '',
          channel: {
            id: match.channel?.id ?? '',
            name: match.channel?.name,
            is_im: match.channel?.is_im,
            is_mpim: match.channel?.is_mpim ?? match.is_mpim,
            is_private: match.channel?.is_private,
          },
          user: match.user,
          username: match.username,
          text: match.text,
          permalink: match.permalink,
        })),
      pages: messages?.paging?.pages ?? messages?.pagination?.page_count ?? 1,
    };
  }

  public async message(
    channel: string,
    ts: string,
    threadTs: string | null
  ): Promise<SlackMessageEvent | null> {
    const response =
      threadTs && threadTs !== ts
        ? await this.call((web) =>
            web.conversations.replies({
              channel,
              ts: threadTs,
              latest: ts,
              oldest: ts,
              inclusive: true,
              limit: 2,
            })
          )
        : await this.call((web) =>
            web.conversations.history({
              channel,
              latest: ts,
              oldest: ts,
              inclusive: true,
              limit: 1,
            })
          );
    const found = (response.messages ?? []).find((message) => message.ts === ts);

    return found ? { ...(found as object), type: 'message', channel, ts } : null;
  }

  public async postMessage(
    channel: string,
    text: string,
    threadTs?: string
  ): Promise<SlackPostedMessage> {
    const response = await this.call((web) =>
      web.chat.postMessage({ channel, text, thread_ts: threadTs })
    );

    return { channel: response.channel ?? channel, ts: response.ts ?? '' };
  }

  public async addReaction(channel: string, ts: string, emoji: string): Promise<void> {
    await this.call((web) => web.reactions.add({ channel, timestamp: ts, name: emoji }));
  }

  private async call<T>(request: (web: WebClient) => Promise<T>): Promise<T> {
    const web = await this.ready();

    try {
      return await request(web);
    } catch (error) {
      // Expired a moment early (clock skew): one refresh and a second try.
      if (slackErrorOf(error) === 'token_expired' && this.canRefresh()) {
        return request(await this.refreshNow());
      }

      throw SlackClient.translate(error);
    }
  }

  private canRefresh(): boolean {
    return this.config.refresh !== null && this.tokens.refreshToken !== null;
  }

  private ready(): Promise<WebClient> {
    const { expiresAt } = this.tokens;

    if (expiresAt === null || expiresAt - Date.now() > REFRESH_MARGIN_MS || !this.canRefresh()) {
      return Promise.resolve(this.web);
    }

    return this.refreshNow();
  }

  /** One refresh at a time: the old refresh token dies the moment a new pair exists. */
  private refreshNow(): Promise<WebClient> {
    const refresh = this.config.refresh;
    const refreshToken = this.tokens.refreshToken;

    if (!refresh || !refreshToken) {
      return Promise.resolve(this.web);
    }

    this.refreshing ??= refresh(refreshToken)
      .then(async (tokens) => {
        this.tokens = tokens;
        this.web = SlackClient.webClient(tokens.accessToken);
        await this.tokensHandler?.(tokens);
        this.logger.debug('slack tokens refreshed');

        return this.web;
      })
      .finally(() => {
        this.refreshing = null;
      });

    return this.refreshing;
  }

  private static webClient(token: string): WebClient {
    // A busy Slack answers 429 with a wait; polling skips that round instead of
    // holding everything up, and tries again at the next check.
    return new WebClient(token, {
      logLevel: LogLevel.ERROR,
      rejectRateLimitedCalls: true,
      retryConfig: { retries: 2 },
    });
  }

  private static translate(error: unknown): HuginnError {
    if (error instanceof HuginnError) {
      return error;
    }

    const slackError = slackErrorOf(error);

    if (slackError === 'missing_scope') {
      return new HuginnError(
        ErrorCode.Unauthorized,
        'Sign in with Slack again: Huginn needs a permission it does not have yet'
      );
    }

    if (slackError && SIGN_IN_AGAIN.has(slackError)) {
      return new HuginnError(ErrorCode.Unauthorized, 'Sign in with Slack again');
    }

    if ((error as { code?: string }).code === SlackErrorCode.RateLimitedError) {
      return new HuginnError(ErrorCode.Upstream, 'Slack is busy right now; trying again shortly');
    }

    return new HuginnError(ErrorCode.Upstream, `Slack: ${toError(error).message}`);
  }
}
