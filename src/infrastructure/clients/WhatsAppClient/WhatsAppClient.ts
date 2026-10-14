import makeWASocket, {
  areJidsSameUser,
  BufferJSON,
  DisconnectReason,
  initAuthCreds,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  isPnUser,
  jidDecode,
  jidNormalizedUser,
  normalizeMessageContent,
  proto,
  toNumber,
} from 'baileys';
import type {
  AuthenticationCreds,
  BaileysEventMap,
  ConnectionState,
  SignalDataSet,
  SignalDataTypeMap,
  SignalKeyStore,
  WAMessage,
  WAMessageKey,
  WASocket,
} from 'baileys';
import type { Logger } from '@/lib/logger';
import type {
  IWhatsAppClient,
  IWhatsAppSession,
  WhatsAppEventHandler,
  WhatsAppLink,
  WhatsAppMessage,
  WhatsAppMessageRef,
} from '@/core/clients/WhatsAppClient/WhatsAppClient.types';
import { WhatsAppEventType } from '@/core/clients/WhatsAppClient/WhatsAppClient.types';
import { ErrorCode, HuginnError, toError } from '@/core/errors/errors';
import { contextOf, messageText, phoneOf, withNames } from './WhatsAppClient.utils';

// What the phone lists under Linked devices: "Huginn".
const BROWSER: [string, string, string] = ['Huginn', 'Chrome', '1.0.0'];
const FIRST_CODE_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 60_000;
// Keys change with nearly every message; they are stored at most this often.
const SAVE_DELAY_MS = 3_000;
const RECONNECT_MS = [1_000, 5_000, 15_000, 30_000, 60_000, 120_000];
// What we sent, for WhatsApp's "send it again" when a phone could not decrypt it.
const SENT_KEPT = 100;

interface DeviceData {
  readonly creds: AuthenticationCreds;
  readonly keys: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Names from the phone's address book, else what people call themselves, by id. */
  readonly names: Readonly<Record<string, string>>;
  readonly savedNames: Readonly<Record<string, true>>;
  readonly groups: Readonly<Record<string, string>>;
}

const statusOf = (update: Partial<ConnectionState>): number | undefined =>
  (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
    ?.statusCode;

/**
 * Everything that makes Huginn the same linked device after a restart: Baileys' keys,
 * plus the names it has learnt, serialized together into one secret.
 */
class DeviceState {
  private constructor(private data: DeviceData) {}

  public static fresh(): DeviceState {
    return new DeviceState({
      creds: initAuthCreds(),
      keys: {},
      names: {},
      savedNames: {},
      groups: {},
    });
  }

  public static parse(text: string): DeviceState {
    const parsed = (text ? JSON.parse(text, BufferJSON.reviver) : {}) as Partial<DeviceData>;

    if (!parsed.creds) {
      throw new HuginnError(ErrorCode.Unauthorized, 'Link your phone again');
    }

    return new DeviceState({
      creds: parsed.creds,
      keys: parsed.keys ?? {},
      names: parsed.names ?? {},
      savedNames: parsed.savedNames ?? {},
      groups: parsed.groups ?? {},
    });
  }

  /** The object Baileys updates in place; kept, never copied. */
  public get creds(): AuthenticationCreds {
    return this.data.creds;
  }

  public keyStore(onChange: () => void): SignalKeyStore {
    return {
      get: <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) =>
        Object.fromEntries(
          ids.flatMap((id) => {
            const value = this.data.keys[type]?.[id];

            if (value === undefined || value === null) {
              return [];
            }

            return [
              [
                id,
                type === 'app-state-sync-key'
                  ? proto.Message.AppStateSyncKeyData.fromObject(value)
                  : value,
              ],
            ];
          })
        ) as Record<string, SignalDataTypeMap[T]>,
      set: (data: SignalDataSet) => {
        this.data = {
          ...this.data,
          keys: Object.entries(data).reduce(
            (keys, [type, entries]) => ({
              ...keys,
              [type]: Object.fromEntries(
                Object.entries({ ...keys[type], ...entries }).filter(
                  ([, value]) => value !== null && value !== undefined
                )
              ),
            }),
            this.data.keys
          ),
        };
        onChange();
      },
    };
  }

  public name(jid: string | null | undefined): string | null {
    return jid ? (this.data.names[jidNormalizedUser(jid)] ?? null) : null;
  }

  /** `saved`: from the address book, which wins over what people call themselves. */
  public learnName(
    jids: readonly (string | null | undefined)[],
    name: string,
    saved: boolean
  ): boolean {
    const ids = jids.filter((jid): jid is string => Boolean(jid)).map(jidNormalizedUser);
    const learnt = ids.filter(
      (id) => this.data.names[id] !== name && (saved || !this.data.savedNames[id])
    );

    if (learnt.length === 0) {
      return false;
    }

    this.data = {
      ...this.data,
      names: { ...this.data.names, ...Object.fromEntries(learnt.map((id) => [id, name])) },
      savedNames: saved
        ? { ...this.data.savedNames, ...Object.fromEntries(learnt.map((id) => [id, true])) }
        : this.data.savedNames,
    };

    return true;
  }

  public groupName(jid: string): string | null {
    return this.data.groups[jid] ?? null;
  }

  public learnGroup(jid: string, subject: string): boolean {
    if (this.data.groups[jid] === subject) {
      return false;
    }

    this.data = { ...this.data, groups: { ...this.data.groups, [jid]: subject } };

    return true;
  }

  public serialize(): string {
    return JSON.stringify(this.data, BufferJSON.replacer);
  }
}

/** Baileys talks a lot; only its warnings reach Huginn's log. */
const quiet = (logger: Logger) => logger.child({ module: 'whatsapp' }, { level: 'warn' });

const socketFor = (
  logger: Logger,
  state: DeviceState,
  onKeys: () => void,
  sent?: Map<string, proto.IMessage>
) =>
  makeWASocket({
    auth: { creds: state.creds, keys: state.keyStore(onKeys) },
    logger: quiet(logger),
    browser: BROWSER,
    // Online, the phone would stop showing its own notifications.
    markOnlineOnConnect: false,
    // No full history: Huginn takes only what arrives from now on. The small initial sync
    // stays on — Baileys learns from it who is behind WhatsApp's hidden ids.
    syncFullHistory: false,
    // Statuses and channels never become items; not decrypting them saves the work.
    shouldIgnoreJid: (jid: string) => isJidStatusBroadcast(jid) || Boolean(isJidNewsletter(jid)),
    getMessage: (key: WAMessageKey) => Promise.resolve(sent?.get(key.id ?? '')),
  });

/** A linked account, kept connected until stopped or unlinked on the phone. */
class BaileysSession implements IWhatsAppSession {
  private state: DeviceState | null = null;
  private socket: WASocket | null = null;
  private handler: WhatsAppEventHandler = () => undefined;
  private stopped = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private readonly sent = new Map<string, proto.IMessage>();

  constructor(
    private readonly logger: Logger,
    private readonly auth: string
  ) {}

  public start(handler: WhatsAppEventHandler): Promise<void> {
    this.handler = handler;
    this.stopped = false;

    try {
      this.state = DeviceState.parse(this.auth);
    } catch (error) {
      return Promise.reject(toError(error));
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new HuginnError(ErrorCode.Upstream, 'WhatsApp did not answer')),
        CONNECT_TIMEOUT_MS
      );

      this.pending = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.connect();
    });
  }

  public stop(): Promise<void> {
    this.stopped = true;

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }

    void this.socket?.end(undefined);
    this.socket = null;
    // Whatever changed since the last save, so the next start is the same device.
    this.saveNow();

    return Promise.resolve();
  }

  public async send(
    to: string,
    text: string,
    quote?: WhatsAppMessageRef
  ): Promise<{ readonly id: string }> {
    const message = await this.connected().sendMessage(
      to,
      { text },
      quote ? { quoted: { key: keyOf(quote), message: { conversation: quote.text } } } : undefined
    );
    const id = message?.key.id ?? '';

    if (message?.message) {
      this.sent.set(id, message.message);
      [...this.sent.keys()].slice(0, -SENT_KEPT).forEach((old) => this.sent.delete(old));
    }

    return { id };
  }

  public async react(target: WhatsAppMessageRef, emoji: string): Promise<void> {
    await this.connected().sendMessage(target.chat, { react: { text: emoji, key: keyOf(target) } });
  }

  public async markRead(target: WhatsAppMessageRef): Promise<void> {
    await this.connected().readMessages([keyOf(target)]);
  }

  private connected(): WASocket {
    if (!this.socket?.user) {
      throw new HuginnError(ErrorCode.Upstream, 'WhatsApp is not connected right now');
    }

    return this.socket;
  }

  private connect(): void {
    const state = this.state;

    if (!state || this.stopped) {
      return;
    }

    const socket = socketFor(this.logger, state, () => this.saveSoon(), this.sent);

    this.socket = socket;
    socket.ev.process((events) => {
      // A socket replaced by a reconnect may still deliver; only the current one counts.
      if (socket === this.socket) {
        void this.onEvents(socket, events).catch((error: unknown) =>
          this.logger.warn({ err: toError(error) }, 'whatsapp event dropped')
        );
      }
    });
  }

  private async onEvents(socket: WASocket, events: Partial<BaileysEventMap>): Promise<void> {
    if (events['creds.update']) {
      this.saveSoon();
    }

    if (events['connection.update']) {
      this.onConnection(events['connection.update']);
    }

    this.learnNames(events);

    const upsert = events['messages.upsert'];

    if (upsert) {
      for (const message of upsert.messages) {
        await this.onMessage(socket, message);
      }
    }

    const reads = [
      ...(events['messages.update'] ?? [])
        .filter(
          ({ key, update }) =>
            !key.fromMe &&
            (update.status === proto.WebMessageInfo.Status.READ ||
              update.status === proto.WebMessageInfo.Status.PLAYED)
        )
        .map(({ key }) => key.id),
      ...(events['message-receipt.update'] ?? [])
        .filter(({ receipt }) => receipt.readTimestamp && this.isMe(receipt.userJid))
        .map(({ key }) => key.id),
    ].filter((id): id is string => Boolean(id));

    if (reads.length > 0) {
      this.handler({ type: WhatsAppEventType.Read, ids: reads });
    }
  }

  private onConnection(update: Partial<ConnectionState>): void {
    if (update.qr) {
      // Asked to scan a code: the phone no longer knows this device.
      this.loggedOut();

      return;
    }

    if (update.connection === 'open') {
      this.failures = 0;
      this.pending?.resolve();
      this.pending = null;
      this.handler({ type: WhatsAppEventType.Connected });

      return;
    }

    if (update.connection !== 'close' || this.stopped) {
      return;
    }

    const status = statusOf(update);

    if (status === DisconnectReason.loggedOut || status === DisconnectReason.forbidden) {
      this.loggedOut();

      return;
    }

    // WhatsApp asks for a fresh connection after linking and now and then: no waiting.
    const delay =
      status === DisconnectReason.restartRequired
        ? 0
        : (RECONNECT_MS[Math.min(this.failures, RECONNECT_MS.length - 1)] ?? 120_000);

    this.failures += 1;
    this.logger.info({ status, delay }, 'whatsapp disconnected, reconnecting');
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private loggedOut(): void {
    void this.socket?.end(undefined);
    this.socket = null;
    this.stopped = true;
    // The keys are dead: nothing to store any more, and nothing to overwrite new ones with.
    this.state = null;
    this.fail(new HuginnError(ErrorCode.Unauthorized, 'Unlinked on the phone — link it again'));
    this.handler({ type: WhatsAppEventType.LoggedOut });
  }

  private fail(error: Error): void {
    if (this.pending) {
      this.pending.reject(error);
      this.pending = null;
      void this.stop();
    }
  }

  private async onMessage(socket: WASocket, message: WAMessage): Promise<void> {
    const chatJid = message.key.remoteJid;

    if (!chatJid || !message.message || isJidBroadcast(chatJid) || isJidNewsletter(chatJid)) {
      return;
    }

    const content = normalizeMessageContent(message.message);
    const isGroup = Boolean(isJidGroup(chatJid));
    // A person's chat by their number when WhatsApp gives it, so it stays one thread.
    const chat = isGroup
      ? chatJid
      : jidNormalizedUser(preferPhone(chatJid, message.key.remoteJidAlt));

    if (message.key.fromMe) {
      if (!content?.protocolMessage) {
        this.handler({ type: WhatsAppEventType.Sent, chat });
      }

      return;
    }

    const protocol = content?.protocolMessage;
    const edited =
      protocol?.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT ? protocol : null;
    const body = edited ? normalizeMessageContent(edited.editedMessage) : content;
    const shown = messageText(body);
    const id = edited?.key?.id ?? message.key.id;

    if (!shown || !id) {
      return;
    }

    const senderJid = isGroup
      ? preferPhone(message.key.participant, message.key.participantAlt)
      : chat;
    const senderName =
      this.state?.name(senderJid) ?? message.pushName ?? phoneOf(senderJid) ?? 'Someone';
    const context = contextOf(body);
    const mentioned = context?.mentionedJid ?? [];

    if (
      message.pushName &&
      this.state?.learnName([senderJid, message.key.participant], message.pushName, false)
    ) {
      this.saveSoon();
    }

    const incoming: WhatsAppMessage = {
      id,
      chat,
      isGroup,
      groupName: isGroup ? await this.groupName(socket, chatJid) : null,
      sender: senderJid ?? chat,
      senderName,
      senderPhone: phoneOf(senderJid),
      text: withNames(
        shown.text,
        mentioned.map((jid) => ({
          user: jidDecode(jid)?.user ?? jid,
          name:
            (this.isMe(jid) ? socket.user?.name : null) ??
            this.state?.name(jid) ??
            jidDecode(jid)?.user ??
            jid,
        }))
      ),
      hasMedia: shown.hasMedia,
      mentionsMe: mentioned.some((jid) => this.isMe(jid)),
      repliesToMe: Boolean(context?.stanzaId) && this.isMe(context?.participant),
      sentAt: new Date(toNumber(message.messageTimestamp) * 1000 || Date.now()),
    };

    this.handler({ type: WhatsAppEventType.Message, message: incoming });
  }

  private async groupName(socket: WASocket, jid: string): Promise<string | null> {
    const known = this.state?.groupName(jid);

    if (known) {
      return known;
    }

    try {
      const { subject } = await socket.groupMetadata(jid);

      if (subject && this.state?.learnGroup(jid, subject)) {
        this.saveSoon();
      }

      return subject || null;
    } catch {
      return null;
    }
  }

  /** Names from the address book (synced from the phone) and the groups' subjects. */
  private learnNames(events: Partial<BaileysEventMap>): void {
    const state = this.state;

    if (!state) {
      return;
    }

    const contacts = [
      ...(events['contacts.upsert'] ?? []),
      ...(events['contacts.update'] ?? []),
      // The first sync after linking carries what people call themselves.
      ...(events['messaging-history.set']?.contacts ?? []),
    ];
    const groups = [...(events['groups.upsert'] ?? []), ...(events['groups.update'] ?? [])];
    const changed = [
      ...contacts.map((contact) => {
        const ids = [contact.id, contact.lid, contact.phoneNumber];

        return contact.name
          ? state.learnName(ids, contact.name, true)
          : contact.notify
            ? state.learnName(ids, contact.notify, false)
            : false;
      }),
      ...groups.map((group) =>
        group.id && group.subject ? state.learnGroup(group.id, group.subject) : false
      ),
    ];

    if (changed.some(Boolean)) {
      this.saveSoon();
    }
  }

  private isMe(jid: string | null | undefined): boolean {
    const user = this.socket?.user;

    return (
      Boolean(jid) &&
      (areJidsSameUser(jid ?? '', user?.id) || areJidsSameUser(jid ?? '', user?.lid))
    );
  }

  private saveSoon(): void {
    this.saveTimer ??= setTimeout(() => this.saveNow(), SAVE_DELAY_MS);
  }

  private saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    if (this.state) {
      this.handler({ type: WhatsAppEventType.Auth, auth: this.state.serialize() });
    }
  }
}

/** The person's number-based id when WhatsApp sends both it and the hidden one. */
const preferPhone = (
  jid: string | null | undefined,
  alternative: string | null | undefined
): string | undefined => (alternative && isPnUser(alternative) ? alternative : jid) ?? undefined;

const keyOf = (ref: WhatsAppMessageRef): WAMessageKey => ({
  remoteJid: ref.chat,
  id: ref.id,
  fromMe: false,
  ...(isJidGroup(ref.chat) ? { participant: ref.sender } : {}),
});

interface Link {
  readonly socket: WASocket;
  readonly done: Promise<WhatsAppLink>;
}

/**
 * WhatsApp through Baileys: the user's own account as a linked device, as WhatsApp Web
 * is. Unofficial — WhatsApp does not offer this — so the settings say so before linking.
 */
export class BaileysWhatsAppClient implements IWhatsAppClient {
  // Keyed by the first code, which is how the pairing refers to a link throughout.
  private readonly links = new Map<string, Link>();
  private readonly codes = new Map<string, string>();

  constructor(private readonly logger: Logger) {}

  public session(auth: string): IWhatsAppSession {
    return new BaileysSession(this.logger, auth);
  }

  public startLink(): Promise<string> {
    const state = DeviceState.fresh();

    return new Promise<string>((resolve, reject) => {
      let first: string | null = null;
      let settle: { resolve: (link: WhatsAppLink) => void; reject: (error: Error) => void } | null =
        null;
      const done = new Promise<WhatsAppLink>((resolveLink, rejectLink) => {
        settle = { resolve: resolveLink, reject: rejectLink };
      });
      const timer = setTimeout(
        () => reject(new HuginnError(ErrorCode.Upstream, 'WhatsApp did not send a code')),
        FIRST_CODE_TIMEOUT_MS
      );

      // Linking takes two connections: the one the phone scans, then a fresh one as
      // the new device (WhatsApp closes the first with "restart required").
      const open = (): WASocket => {
        const socket = socketFor(this.logger, state, () => undefined);

        socket.ev.process((events) => {
          const update = events['connection.update'];

          if (!update) {
            return;
          }

          if (update.qr) {
            if (first === null) {
              first = update.qr;
              clearTimeout(timer);
              this.links.set(first, { socket, done });
              resolve(update.qr);
            }

            this.codes.set(first, update.qr);
          }

          if (update.connection === 'open' && socket.user) {
            settle?.resolve({
              account: phoneOf(jidNormalizedUser(socket.user.id)) ?? socket.user.id,
              name: socket.user.name ?? null,
              auth: state.serialize(),
            });
            void socket.end(undefined);
          }

          if (update.connection === 'close') {
            if (statusOf(update) === DisconnectReason.restartRequired) {
              const next = open();
              const link = first ? this.links.get(first) : undefined;

              if (link && first) {
                this.links.set(first, { ...link, socket: next });
              }
            } else {
              clearTimeout(timer);
              reject(new HuginnError(ErrorCode.Upstream, 'WhatsApp closed the connection'));
              settle?.reject(
                new HuginnError(ErrorCode.Upstream, 'The code expired — start linking again')
              );
            }
          }
        });

        return socket;
      };

      open();
    });
  }

  public currentLinkCode(code: string): string | null {
    return this.codes.get(code) ?? null;
  }

  public async linkWithPhone(code: string, phoneNumber: string): Promise<string> {
    const link = this.links.get(code);

    if (!link) {
      throw new HuginnError(ErrorCode.NotFound, 'This link attempt expired — start it again');
    }

    const digits = phoneNumber.replace(/\D/g, '');
    const pairing = await link.socket.requestPairingCode(digits);

    // Shown like WhatsApp does: ABCD-EFGH.
    return pairing.length === 8 ? `${pairing.slice(0, 4)}-${pairing.slice(4)}` : pairing;
  }

  public async finishLink(code: string): Promise<WhatsAppLink> {
    const link = this.links.get(code);

    if (!link) {
      throw new HuginnError(ErrorCode.NotFound, 'This link attempt expired — start it again');
    }

    try {
      return await link.done;
    } finally {
      this.links.delete(code);
      this.codes.delete(code);
    }
  }

  public close(): Promise<void> {
    [...this.links.values()].forEach((link) => void link.socket.end(undefined));
    this.links.clear();
    this.codes.clear();

    return Promise.resolve();
  }
}
