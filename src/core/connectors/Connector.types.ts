import type { z } from 'zod';
import type {
  Connection,
  ConnectionCursor,
  ConnectionStatus,
  ConnectorKind,
  Secrets,
} from '@/core/connections/Connection.types';
import type { Item, NewItem } from '@/core/items/Item.types';
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
}

/** A secret the settings page asks for when adding a connection of this kind. */
export interface SecretField {
  readonly key: string;
  readonly label: string;
  readonly hint?: string;
}

export enum AuthorizationMode {
  /** The provider redirects back to Huginn itself; needs HUGINN_PUBLIC_URL. */
  Redirect = 'Redirect',
  /** The provider lands on a dead localhost page; the user pastes its address back. */
  PasteBack = 'PasteBack',
}

export interface AuthorizationStart {
  readonly url: string;
  readonly redirectUri: string;
  readonly mode: AuthorizationMode;
}

/**
 * An interactive sign-in (OAuth) that turns the secrets the user typed — a client
 * id and secret — into the secrets the connector runs on, such as a refresh token.
 */
export interface IConnectorAuthorization {
  isAuthorized(secrets: Secrets): boolean;
  start(connection: Connection, secrets: Secrets, state: string): AuthorizationStart;
  /** Exchanges the code; returns only the secrets to add or replace. */
  complete(
    connection: Connection,
    secrets: Secrets,
    code: string,
    redirectUri: string
  ): Promise<Secrets>;
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
  create(connection: Connection, secrets: Secrets): IConnector;
}
