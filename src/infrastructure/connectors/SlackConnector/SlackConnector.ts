import type { Logger } from '@/lib/logger';
import type {
  ISlackClient,
  SlackIdentity,
  SlackMessageEvent,
  SlackSearchMatch,
} from '@/core/clients/SlackClient/SlackClient.types';
import type { SlackTokens } from '@/core/clients/SlackOAuthClient/SlackOAuthClient.types';
import type { Connection, Secrets } from '@/core/connections/Connection.types';
import { ConnectionStatus, ConnectorKind } from '@/core/connections/Connection.types';
import type {
  ActionResult,
  ConnectorCapabilities,
  ConnectorContext,
  IConnector,
} from '@/core/connectors/Connector.types';
import { isShortName, shortNameOf } from '@/core/emoji/emoji.utils';
import { ErrorCode, HuginnError, toError } from '@/core/errors/errors';
import type { Item, NewItem } from '@/core/items/Item.types';
import { RichFormat } from '@/core/items/Item.types';
import type { SlackChannelSettings } from './SlackConnector.types';
import { SlackChannelScope, SlackReadMode } from './SlackConnector.types';
import type { RelevanceContext } from './SlackConnector.utils';
import {
  SlackRelevance,
  appLink,
  attachmentTexts,
  attachmentViews,
  blocksText,
  channelsToCheck,
  classify,
  eventFromMatch,
  itemKindFor,
  mentionsMe,
  normalizeEvent,
  permalink,
  readItemIds,
  referencedChannelIds,
  referencedUserIds,
  resolveChannels,
  replyThreadTs,
  searchSince,
  threadKeyOf,
  toPlainText,
} from './SlackConnector.utils';

/** How many of the user's own threads to remember for "replies in my threads". */
const MAX_REMEMBERED_THREADS = 500;
/** conversations.info is Tier 3 (~50/min); one sweep a minute asks about at most this many. */
const MAX_READ_CHECKS = 20;
/** Search can lag a little behind Slack: each check looks this far back again. */
const OVERLAP_S = 300;
/**
 * Pages of 100 a check reads at most. A normal minute is one page; after days away this
 * reads the newest 1,000 messages and says so, rather than eating everyone's rate limit.
 */
const MAX_PAGES = 10;
/** Who is in which channel changes rarely; re-read for "everything in my channels". */
const CHANNELS_REFRESH_MS = 30 * 60 * 1000;

interface SlackCursor {
  readonly myThreads?: readonly string[];
  /** The newest message read (seconds.micros, as Slack writes it). */
  readonly latestTs?: string;
  /** Where Socket Mode left off, for connections from before polling: reading resumes there. */
  readonly lastEventTs?: string;
}

export interface SlackPolling {
  readonly intervalMs: number;
  /** How far back the very first check reads. */
  readonly lookbackMs: number;
}

const clearTimers = (timers: readonly (ReturnType<typeof setInterval> | null)[]) =>
  timers.forEach((timer) => {
    if (timer) {
      clearInterval(timer);
    }
  });

/**
 * Checks Slack every interval with the user's own token: one search for everything new,
 * then the same rules as always decide what is theirs — DMs, mentions (personal and
 * group), replies in threads they wrote in, channels they watch. Their own messages
 * close the conversation, so answering in Slack clears it here too.
 */
export class SlackConnector implements IConnector {
  public readonly kind = ConnectorKind.Slack;
  public static readonly capabilities: ConnectorCapabilities = {
    reply: true,
    draft: false,
    react: true,
    ack: false,
  };
  public readonly capabilities = SlackConnector.capabilities;
  private ctx: ConnectorContext | null = null;
  private secrets: Secrets = {};
  private identity: SlackIdentity | null = null;
  private relevance: RelevanceContext | null = null;
  private myThreads: readonly string[] = [];
  private groupHandles: ReadonlyMap<string, string> = new Map();
  private channelsReadAt = 0;
  // Own messages already acted on, so the overlap does not close a thread twice.
  private handledOwn = new Set<string>();
  // Checks run one at a time, and the read sweep waits its turn too.
  private queue: Promise<void> = Promise.resolve();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readTimer: ReturnType<typeof setInterval> | null = null;
  // The last problem reported, so a recovery clears it once rather than every minute.
  private problem: string | null = null;
  // Watch / ignore entries that are no channel of the user's: shown until fixed.
  private channelWarning: string | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly connection: Connection,
    private readonly client: ISlackClient,
    private readonly channels: SlackChannelSettings,
    private readonly maxBodyChars: number,
    private readonly readCheckMs: number,
    private readonly polling: SlackPolling
  ) {}

  public async start(ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx;
    this.secrets = ctx.secrets;
    // Rotating tokens are refreshed inside the client; keep each new pair.
    this.client.onTokens((tokens) => this.keepTokens(tokens));

    try {
      this.identity = await this.client.identify();
    } catch (error) {
      if (await this.needsSignIn(error)) {
        return;
      }

      throw error;
    }

    const cursor = ctx.getCursor() as SlackCursor;
    const groups = await this.client.myUserGroups(this.identity.userId);

    this.myThreads = cursor.myThreads ?? [];
    this.groupHandles = new Map(groups.map((group) => [group.id, group.handle]));
    this.relevance = {
      me: this.identity.userId,
      myGroupIds: new Set(groups.map((group) => group.id)),
      channelScope: this.channels.scope,
      watchedChannels: new Set(),
      ignoredChannels: new Set(),
      myChannels: new Set(),
      myThreads: new Set(this.myThreads),
    };
    await this.check();

    // A check that found the token wanting has asked to sign in; nothing to repeat.
    if (!this.ctx) {
      return;
    }

    this.pollTimer = setInterval(() => {
      this.queue = this.queue.then(() => this.check());
    }, this.polling.intervalMs);

    if (this.channels.whenRead === SlackReadMode.Clear) {
      this.readTimer = setInterval(() => {
        this.queue = this.queue.then(() => this.clearRead());
      }, this.readCheckMs);
    }
  }

  public async stop(): Promise<void> {
    clearTimers([this.pollTimer, this.readTimer]);
    this.pollTimer = null;
    this.readTimer = null;
    await this.queue;
    this.ctx = null;
  }

  public async reply(item: Item, text: string): Promise<ActionResult> {
    const event = item.raw as SlackMessageEvent;
    const threadTs = replyThreadTs(event);

    try {
      const posted = await this.client.postMessage(event.channel, text, threadTs);

      // Remember the thread so the other side's answer comes back in.
      await this.rememberThread(`${event.channel}:${threadTs}`);

      return {
        ok: true,
        ref: posted.ts,
        url: this.identity
          ? permalink(this.identity.teamUrl, { ...event, ts: posted.ts, thread_ts: threadTs })
          : undefined,
      };
    } catch (error) {
      return { ok: false, error: toError(error).message };
    }
  }

  public async react(item: Item, emoji: string): Promise<ActionResult> {
    const event = item.raw as SlackMessageEvent;
    // Slack reacts by short name; the dashboard sends the emoji itself.
    const name = isShortName(emoji) ? emoji : shortNameOf(emoji);

    if (!name) {
      return { ok: false, error: `Slack has no name for ${emoji}` };
    }

    try {
      await this.client.addReaction(event.channel, event.ts, name);

      return { ok: true, ref: `${event.ts}:${name}` };
    } catch (error) {
      return { ok: false, error: toError(error).message };
    }
  }

  /** One check: everything newer than last time, oldest first, through the usual rules. */
  private async check(): Promise<void> {
    const ctx = this.ctx;

    if (!ctx || !this.relevance) {
      return;
    }

    try {
      if (Date.now() - this.channelsReadAt > CHANNELS_REFRESH_MS) {
        await this.readChannels();
      }

      const cursor = ctx.getCursor() as SlackCursor;
      const since = Number(
        cursor.latestTs ?? cursor.lastEventTs ?? (Date.now() - this.polling.lookbackMs) / 1000
      );
      const floor = since - OVERLAP_S;
      const { matches, complete } = await this.readSince(floor);
      const newest = matches.reduce((max, match) => Math.max(max, Number(match.ts)), since);

      await [...matches]
        .sort((a, b) => Number(a.ts) - Number(b.ts))
        .reduce((done, match) => done.then(() => this.handle(match)), Promise.resolve());
      // Own messages older than the overlap can no longer come round again.
      this.handledOwn = new Set(
        [...this.handledOwn].filter((key) => Number(key.split(':')[1]) > floor)
      );
      await ctx.setCursor({ ...ctx.getCursor(), latestTs: newest.toFixed(6) });
      await this.settle(
        complete
          ? this.channelWarning
          : 'More new Slack messages than one check reads; the oldest were skipped'
      );
    } catch (error) {
      if (await this.needsSignIn(error)) {
        return;
      }

      this.logger.warn(
        { connectionId: this.connection.id, err: toError(error) },
        'slack check failed'
      );
      await this.settle(toError(error).message);
    }
  }

  /** Search pages, newest first, until they reach `floor` (or the page limit). */
  private async readSince(
    floor: number
  ): Promise<{ matches: readonly SlackSearchMatch[]; complete: boolean }> {
    const read = async (
      page: number,
      acc: readonly SlackSearchMatch[]
    ): Promise<{ matches: readonly SlackSearchMatch[]; complete: boolean }> => {
      const result = await this.client.search(searchSince(floor), page);
      const fresh = result.matches.filter((match) => Number(match.ts) > floor);
      const matches = [...acc, ...fresh];

      if (fresh.length < result.matches.length || page >= result.pages) {
        return { matches, complete: true };
      }

      return page >= MAX_PAGES ? { matches, complete: false } : read(page + 1, matches);
    };

    return read(1, []);
  }

  private async handle(match: SlackSearchMatch): Promise<void> {
    const ctx = this.ctx;
    const relevance = this.relevance;
    const identity = this.identity;
    const found = normalizeEvent(eventFromMatch(match));

    if (!ctx || !relevance || !identity || !found) {
      return;
    }

    try {
      const verdict = classify(found, relevance);

      if (verdict === SlackRelevance.Own) {
        const key = `${found.channel}:${found.ts}`;

        if (!this.handledOwn.has(key)) {
          this.handledOwn.add(key);
          await ctx.closeThread(threadKeyOf(found));
          await this.rememberThread(`${found.channel}:${found.thread_ts ?? found.ts}`);
        }

        return;
      }

      if (verdict === SlackRelevance.Ignore) {
        return;
      }

      // Search carries the whole message; a bare result (only a file, say) is fetched.
      const event =
        found.text || found.blocks || found.attachments ? found : await this.fullMessage(found);

      await ctx.upsert(await this.toItem(event, verdict, relevance, identity));
    } catch (error) {
      this.logger.warn(
        { connectionId: this.connection.id, err: toError(error) },
        'slack message dropped'
      );
    }
  }

  private async fullMessage(event: SlackMessageEvent): Promise<SlackMessageEvent> {
    const full = await this.client.message(event.channel, event.ts, event.thread_ts ?? null);

    return full ? { ...full, channel: event.channel, channel_type: event.channel_type } : event;
  }

  /** Closes what the user has read in Slack since it came in (main timelines only). */
  private async clearRead(): Promise<void> {
    const ctx = this.ctx;

    if (!ctx) {
      return;
    }

    try {
      const open = await ctx.openItems();
      const channels = channelsToCheck(open, MAX_READ_CHECKS);
      const markers = await Promise.all(
        channels.map(async (channel) => [channel, await this.client.lastRead(channel)] as const)
      );
      const read = readItemIds(open, new Map(markers));

      if (read.length > 0) {
        await ctx.closeItems(read);
      }
    } catch (error) {
      this.logger.warn(
        { connectionId: this.connection.id, err: toError(error) },
        'slack read check failed'
      );
    }
  }

  /** Channel names for the watch and ignore lists, and what "my channels" means. */
  private async readChannels(): Promise<void> {
    const relevance = this.relevance;

    if (!relevance) {
      return;
    }

    const needed =
      this.channels.scope === SlackChannelScope.AllMyChannels ||
      this.channels.watch.length + this.channels.ignore.length > 0;
    const mine = needed ? await this.client.myChannels() : [];
    const watched = resolveChannels(this.channels.watch, mine);
    const ignored = resolveChannels(this.channels.ignore, mine);
    const unknown = [...watched.unknown, ...ignored.unknown];

    this.channelsReadAt = Date.now();
    this.channelWarning =
      unknown.length > 0 ? `Not a channel you are in: ${unknown.join(', ')}` : null;
    this.relevance = {
      ...relevance,
      watchedChannels: watched.ids,
      ignoredChannels: ignored.ids,
      myChannels: new Set(mine.map((channel) => channel.id)),
    };
  }

  private async keepTokens(tokens: SlackTokens): Promise<void> {
    this.secrets = {
      ...this.secrets,
      userToken: tokens.accessToken,
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      ...(tokens.expiresAt ? { expiresAt: String(tokens.expiresAt) } : {}),
    };
    await this.ctx?.saveSecrets(this.secrets);
  }

  /** A token Slack no longer takes (or one missing a permission): ask to sign in again. */
  private async needsSignIn(error: unknown): Promise<boolean> {
    if (!(error instanceof HuginnError) || error.code !== ErrorCode.Unauthorized) {
      return false;
    }

    clearTimers([this.pollTimer, this.readTimer]);
    this.pollTimer = null;
    this.readTimer = null;
    await this.ctx?.report(ConnectionStatus.NeedsAuth, error.message);
    this.ctx = null;

    return true;
  }

  /** Says what is wrong once, and clears it once it is fine again. */
  private async settle(problem: string | null): Promise<void> {
    if (problem === this.problem) {
      return;
    }

    this.problem = problem;
    await this.ctx?.report(ConnectionStatus.Running, problem);
  }

  private async toItem(
    event: SlackMessageEvent,
    verdict: SlackRelevance,
    relevance: RelevanceContext,
    identity: SlackIdentity
  ): Promise<NewItem> {
    // What Slack shows: app blocks over the fallback text, then the attachments.
    const text = blocksText(event.blocks) ?? event.text ?? '';
    const attachments = attachmentViews(event);
    const allText = [text, ...attachments.flatMap(attachmentTexts)].join('\n');
    const [author, channel, names, channelRefs] = await Promise.all([
      event.user ? this.client.userName(event.user) : Promise.resolve(event.username ?? 'bot'),
      this.client.channelInfo(event.channel),
      Promise.all(
        referencedUserIds(allText).map(async (id) => [id, await this.client.userName(id)] as const)
      ),
      Promise.all(
        referencedChannelIds(allText).map(
          async (id) => [id, (await this.client.channelInfo(id)).name] as const
        )
      ),
    ]);
    const isDm = event.channel_type === 'im' || event.channel_type === 'mpim';
    const where = isDm ? 'direct message' : `#${channel.name}`;
    const files = (event.files ?? []).map((file) => file.name ?? 'file').join(', ');
    const plain = (mrkdwn: string) =>
      toPlainText(mrkdwn, new Map(names), this.groupHandles, new Map(channelRefs));
    const body = [
      plain(text),
      ...attachments.map((attachment) => attachmentTexts(attachment).map(plain).join('\n')),
      files ? `📎 ${files}` : '',
    ]
      .filter((part) => part !== '')
      .join('\n');

    return {
      connectionId: this.connection.id,
      externalId: `${event.channel}:${event.ts}`,
      threadKey: threadKeyOf(event),
      kind: itemKindFor(verdict),
      author,
      title: SlackConnector.titleFor(verdict, author, where),
      body: body.slice(0, this.maxBodyChars),
      url: permalink(identity.teamUrl, event),
      appUrl: appLink(identity.teamId, event),
      // The dashboard renders this like Slack does; the names are what it needs.
      rich: {
        format: RichFormat.SlackMrkdwn,
        text: files ? `${text}\n📎 ${files}` : text,
        attachments,
        users: Object.fromEntries(names),
        channels: Object.fromEntries(channelRefs),
        groups: Object.fromEntries(this.groupHandles),
      },
      receivedAt: new Date(Number(event.ts) * 1000),
      features: {
        channel: event.channel,
        channelName: isDm ? null : channel.name,
        channelType: event.channel_type ?? null,
        authorId: event.user ?? null,
        isBot: Boolean(event.bot_id),
        isDm,
        isMention: mentionsMe(text, relevance),
        isPersonalMention: text.includes(`<@${relevance.me}>`),
        isThreadReply: Boolean(event.thread_ts && event.thread_ts !== event.ts),
        isWatchedChannel: relevance.watchedChannels.has(event.channel),
        inMyThread: verdict === SlackRelevance.ThreadReply,
        allChannelsScope: relevance.channelScope === SlackChannelScope.AllMyChannels,
        mentionsEveryone: /<!(here|channel|everyone)/.test(text),
        hasFiles: files !== '',
      },
      raw: event,
    };
  }

  private static titleFor(verdict: SlackRelevance, author: string, where: string): string {
    switch (verdict) {
      case SlackRelevance.DirectMessage:
        return `${author} in a direct message`;
      case SlackRelevance.Mention:
        return `${author} mentioned you in ${where}`;
      case SlackRelevance.ThreadReply:
        return `${author} replied in a thread in ${where}`;
      default:
        return `${author} in ${where}`;
    }
  }

  private async rememberThread(key: string): Promise<void> {
    if (!this.ctx || !this.relevance || this.myThreads.includes(key)) {
      return;
    }

    this.myThreads = [key, ...this.myThreads].slice(0, MAX_REMEMBERED_THREADS);
    this.relevance = { ...this.relevance, myThreads: new Set(this.myThreads) };
    await this.ctx.setCursor({ ...this.ctx.getCursor(), myThreads: this.myThreads });
  }
}
