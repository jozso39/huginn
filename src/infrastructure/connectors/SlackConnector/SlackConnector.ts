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
import type { Item } from '@/core/items/Item.types';
import type { SlackChannelSettings } from './SlackConnector.types';
import { SlackChannelScope } from './SlackConnector.types';
import type { RelevanceContext } from './SlackConnector.utils';
import {
  SlackRelevance,
  classify,
  itemKindFor,
  mentionsMe,
  normalizeEvent,
  permalink,
  referencedUserIds,
  resolveChannels,
  replyThreadTs,
  threadKeyOf,
  toPlainText,
} from './SlackConnector.utils';

/** How many of the user's own threads to remember for "replies in my threads". */
const MAX_REMEMBERED_THREADS = 500;

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
  public readonly capabilities: ConnectorCapabilities = { reply: true, react: true, ack: false };
  private ctx: ConnectorContext | null = null;
  private identity: SlackIdentity | null = null;
  private relevance: RelevanceContext | null = null;
  private myThreads: readonly string[] = [];
  private groupHandles: ReadonlyMap<string, string> = new Map();
  // Events are handled one at a time so "my reply" can never overtake the
  // message it answers and leave it open.
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly logger: Logger,
    private readonly connection: Connection,
    private readonly client: ISlackClient,
    private readonly channels: SlackChannelSettings,
    private readonly maxBodyChars: number
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

    if (unknown.length > 0) {
      await ctx.report(ConnectionStatus.Running, `Not a channel you are in: ${unknown.join(', ')}`);
    }
  }

  public async stop(): Promise<void> {
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
      await this.rememberThread(`${event.channel}:${threadTs ?? posted.ts}`);

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

  private async handle(raw: SlackMessageEvent): Promise<void> {
    const ctx = this.ctx;
    const relevance = this.relevance;
    const identity = this.identity;
    const event = normalizeEvent(raw);

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
  ) {
    const text = event.text ?? '';
    const [author, channel, names] = await Promise.all([
      event.user ? this.client.userName(event.user) : Promise.resolve(event.username ?? 'bot'),
      this.client.channelInfo(event.channel),
      Promise.all(
        referencedUserIds(text).map(async (id) => [id, await this.client.userName(id)] as const)
      ),
    ]);
    const isDm = event.channel_type === 'im' || event.channel_type === 'mpim';
    const where = isDm ? 'direct message' : `#${channel.name}`;
    const files = (event.files ?? []).map((file) => file.name ?? 'file').join(', ');
    const body = [toPlainText(text, new Map(names), this.groupHandles), files ? `📎 ${files}` : '']
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
