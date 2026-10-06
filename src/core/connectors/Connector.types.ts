import type { z } from 'zod';
import type {
  Connection,
  ConnectionCursor,
  ConnectionStatus,
  ConnectorKind,
  Secrets,
} from '@/core/connections/Connection.types';
import type { Item, NewItem, RichContent } from '@/core/items/Item.types';
import type { OAuthAppCredentials, OAuthProvider, SignInApp } from '@/core/oauth/OAuthApp.types';
import type { RuleDraft } from '@/core/triage/Rule.types';
import type { UpsertResult } from '@/core/items/ItemStore.types';

export interface ConnectorCapabilities {
  readonly reply: boolean;
  /** Can save a reply as a draft at the provider instead of sending it. */
  readonly draft: boolean;
  readonly react: boolean;
  /** Can close the thing at the provider (mark todo done, mark mail read). */
  readonly ack: boolean;
}

/**
 * What a running connector may do to the hub. It never touches stores or the
 * event bus directly; the host owns persistence and fan-out.
 */
export interface ConnectorContext {
  readonly connection: Connection;
  readonly secrets: Secrets;
  upsert(item: NewItem): Promise<UpsertResult>;
  closeOpenExcept(keepExternalIds: readonly string[]): Promise<void>;
  /** The user answered this conversation at the source; nothing in it is waiting anymore. */
  closeThread(threadKey: string): Promise<void>;
  /** These were dealt with at the source (read, archived, resolved). */
  closeItems(externalIds: readonly string[]): Promise<void>;
  /** What of this connection is still waiting, for connectors that check the source's state. */
  openItems(): Promise<readonly Pick<Item, 'externalId' | 'threadKey'>[]>;
  /**
   * The source was heard from just now. Push connectors (Slack, Signal) call it per
   * event; pollers get it with `setCursor`. Cheap to call often.
   */
  markSynced(): Promise<void>;
  getCursor(): ConnectionCursor;
  setCursor(cursor: ConnectionCursor): Promise<void>;
  report(status: ConnectionStatus, message?: string | null): Promise<void>;
}

export interface ActionResult {
  readonly ok: boolean;
  /** Provider-side reference of what happened (message ts, note id, …). */
  readonly ref?: string;
  readonly url?: string;
  readonly error?: string;
}

/** One instance per enabled connection, created by its factory. */
export interface IConnector {
  readonly kind: ConnectorKind;
  readonly capabilities: ConnectorCapabilities;
  start(ctx: ConnectorContext): Promise<void>;
  stop(): Promise<void>;
  reply?(item: Item, text: string): Promise<ActionResult>;
  draft?(item: Item, text: string): Promise<ActionResult>;
  react?(item: Item, emoji: string): Promise<ActionResult>;
  ack?(item: Item): Promise<ActionResult>;
  /** The full message for display, fetched when the user opens it (e-mail HTML). */
  content?(item: Item): Promise<RichContent>;
}

/** A secret the settings page asks for when adding a connection of this kind. */
export interface SecretField {
  readonly key: string;
  readonly label: string;
  readonly hint?: string;
}

export interface SignInResult {
  /** Secrets to store on the connection, e.g. a refresh token. */
  readonly secrets: Secrets;
  /** Who signed in (an email address): names a new connection, finds an existing one. */
  readonly account: string;
}

/**
 * An interactive sign-in (OAuth) through the provider app the user set up once.
 * The app's credentials are handed in; the connector never stores them.
 */
export interface IConnectorAuthorization {
  readonly provider: OAuthProvider;
  isAuthorized(secrets: Secrets): boolean;
  authorizationUrl(app: SignInApp, state: string): string;
  complete(app: SignInApp, code: string): Promise<SignInResult>;
}

/**
 * Linking as a device (Signal): the user scans a code with their phone. There is no
 * provider app; the connector's own service does the handshake.
 */
export interface IConnectorPairing {
  isPaired(secrets: Secrets): boolean;
  /** Starts a link; `code` is what the phone scans, shown as a QR code. */
  start(): Promise<{ readonly code: string }>;
  /** Resolves once the phone accepted `code`, which can take minutes. */
  finish(code: string): Promise<SignInResult>;
}

export interface IConnectorFactory {
  readonly kind: ConnectorKind;
  readonly label: string;
  readonly capabilities: ConnectorCapabilities;
  /** Validates and documents `Connection.config`; the settings page renders it. */
  readonly configSchema: z.ZodType;
  readonly secretFields: readonly SecretField[];
  /** Present when the connection needs a sign-in before it can run. */
  readonly authorization?: IConnectorAuthorization;
  /** Present when the connection is linked by scanning a code instead. */
  readonly pairing?: IConnectorPairing;
  /**
   * Origin triage: the rules a new connection of this kind starts with, in
   * priority order. What the connector knows is important (a DM, a review
   * request) goes here; everything else starts Undecided.
   */
  readonly defaultRules?: readonly RuleDraft[];
  /** `app` is the provider app's credentials for connectors with `authorization`, else null. */
  create(connection: Connection, secrets: Secrets, app: OAuthAppCredentials | null): IConnector;
}
