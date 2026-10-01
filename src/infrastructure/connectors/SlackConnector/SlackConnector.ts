import type { Logger } from '@/lib/logger';
import type {
  ISlackClient,
  SlackIdentity,
  SlackMessageEvent,
} from '@/core/clients/SlackClient/SlackClient.types';
import type { Connection } from '@/core/connections/Connection.types';
import { ConnectionStatus, ConnectorKind } from '@/core/connections/Connection.types';
import type {
  ActionResult,
  ConnectorCapabilities,
  ConnectorContext,
  IConnector,
} from '@/core/connectors/Connector.types';
import { toError } from '@/core/errors/errors';
import type { Item, NewItem } from '@/core/items/Item.types';
import { RichFormat } from '@/core/items/Item.types';
import type { SlackChannelSettings } from './SlackConnector.types';
import { SlackChannelScope, SlackReadMode } from './SlackConnector.types';
import type { RelevanceContext } from './SlackConnector.utils';
import {
  SlackRelevance,
  attachmentTexts,
  attachmentViews,
  blocksText,
  channelsToCheck,
  classify,
  itemKindFor,
  mentionsMe,
  normalizeEvent,
  permalink,
  readItemIds,
  referencedChannelIds,
  referencedUserIds,
  resolveChannels,
  replyThreadTs,
  threadKeyOf,
  toPlainText,
} from './SlackConnector.utils';

/** How many of the user's own threads to remember for "replies in my threads". */
const MAX_REMEMBERED_THREADS = 500;
/** conversations.info is Tier 3 (~50/min); one sweep a minute asks about at most this many. */
const MAX_READ_CHECKS = 20;

interface SlackCursor {
  readonly myThreads?: readonly string[];
  readonly lastEventTs?: string;
}

/**
 * Listens to every message the user can see over Socket Mode and keeps the ones
 * addressed to them: DMs, mentions (personal and group), replies in threads they
 * wrote in, and channels they chose to watch. Their own messages close the
 * conversation, so answering in Slack clears it here too.
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
  private identity: SlackIdentity | null = null;
  private relevance: RelevanceContext | null = null;
  private myThreads: readonly string[] = [];
  private groupHandles: ReadonlyMap<string, string> = new Map();
  // Events are handled one at a time so "my reply" can never overtake the
  // message it answers and leave it open.
  private queue: Promise<void> = Promise.resolve();
  private readTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly connection: Connection,
    private readonly client: ISlackClient,
    private readonly channels: SlackChannelSettings,
    private readonly maxBodyChars: number,
    private readonly readCheckMs: number
  ) {}

  public async start(ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx;
    this.identity = await this.client.identify();

    const cursor = ctx.getCursor() as SlackCursor;

    const [groups, myChannels] = await Promise.all([
      this.client.myUserGroups(this.identity.userId),
      // Only needed to turn "#name" into an ID; skipped when nothing is listed.
      this.channels.watch.length + this.channels.ignore.length > 0
        ? this.client.myChannels()
        : Promise.resolve([]),
    ]);
    const watched = resolveChannels(this.channels.watch, myChannels);
    const ignored = resolveChannels(this.channels.ignore, myChannels);
    const unknown = [...watched.unknown, ...ignored.unknown];

    this.myThreads = cursor.myThreads ?? [];
    this.groupHandles = new Map(groups.map((group) => [group.id, group.handle]));
    this.relevance = {
      me: this.identity.userId,
      myGroupIds: new Set(groups.map((group) => group.id)),
      channelScope: this.channels.scope,
      watchedChannels: watched.ids,
      ignoredChannels: ignored.ids,
      myThreads: new Set(this.myThreads),
    };

    await this.client.listen((event) => {
      this.queue = this.queue.then(() => this.handle(event));
    });

    if (this.channels.whenRead === SlackReadMode.Clear) {
      // Through the event queue, so a sweep never races a message being stored.
      this.readTimer = setInterval(() => {
        this.queue = this.queue.then(() => this.clearRead());
      }, this.readCheckMs);
    }

    if (unknown.length > 0) {
      await ctx.report(ConnectionStatus.Running, `Not a channel you are in: ${unknown.join(', ')}`);
    }
  }

  public async stop(): Promise<void> {
    if (this.readTimer) {
      clearInterval(this.readTimer);
      this.readTimer = null;
    }

    await this.client.close();
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

    try {
      await this.client.addReaction(event.channel, event.ts, emoji);

      return { ok: true, ref: `${event.ts}:${emoji}` };
    } catch (error) {
      return { ok: false, error: toError(error).message };
    }
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

  private async handle(raw: SlackMessageEvent): Promise<void> {
    const ctx = this.ctx;
    const relevance = this.relevance;
    const identity = this.identity;
    const event = normalizeEvent(raw);

    // Any event, kept or not, shows the connection is alive.
    await ctx?.markSynced();

    if (!ctx || !relevance || !identity || !event) {
      return;
    }

    try {
      const verdict = classify(event, relevance);

      if (verdict === SlackRelevance.Own) {
        await ctx.closeThread(threadKeyOf(event));
        await this.rememberThread(`${event.channel}:${event.thread_ts ?? event.ts}`);

        return;
      }

      if (verdict === SlackRelevance.Ignore) {
        return;
      }

      await ctx.upsert(await this.toItem(event, verdict, relevance, identity));
    } catch (error) {
      this.logger.warn(
        { connectionId: this.connection.id, err: toError(error) },
        'slack event dropped'
      );
    }
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
