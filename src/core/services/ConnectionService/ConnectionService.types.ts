import type {
  Connection,
  ConnectionChanges,
  ConnectorKind,
  NewConnection,
} from '@/core/connections/Connection.types';
import type { ConnectorCapabilities, SecretField } from '@/core/connectors/Connector.types';
import type { OAuthProvider } from '@/core/oauth/OAuthApp.types';

/** What the "add connection" form needs to render one connector kind. */
export interface ConnectorDescriptor {
  readonly kind: ConnectorKind;
  readonly label: string;
  /** JSON Schema of the config, for a generic form. */
  readonly configSchema: unknown;
  readonly secretFields: readonly SecretField[];
  readonly capabilities: ConnectorCapabilities;
  /** Set when connections of this kind are created by signing in, not by a form. */
  readonly signInProvider: OAuthProvider | null;
  /** Set when connections of this kind are created by linking a phone (a QR code). */
  readonly pairing: boolean;
  /** Why this kind cannot be added here (e.g. signal-cli is not installed); null when it can. */
  readonly unavailable: string | null;
}

export enum PairingState {
  Waiting = 'Waiting',
  Linked = 'Linked',
  Failed = 'Failed',
}

export interface PairingStart {
  readonly pairingId: string;
  /** Shown as a QR code for the phone to scan. */
  readonly code: string;
}

export interface PairingStatus {
  readonly state: PairingState;
  readonly connection: Connection | null;
  readonly error: string | null;
}

export interface SignInStart {
  /** The provider page to send the browser to. */
  readonly url: string;
}

/** Sign in a new account of a kind, or an existing connection again. */
export type SignInTarget = { readonly kind: ConnectorKind } | { readonly connectionId: string };

export interface IConnectionService {
  describeConnectors(): readonly ConnectorDescriptor[];
  list(): Promise<readonly Connection[]>;
  get(id: string): Promise<Connection | null>;
  create(input: NewConnection): Promise<Connection>;
  /** Restarts the connector only when its settings changed, not its name, category or colour. */
  update(id: string, changes: ConnectionChanges): Promise<Connection>;
  /** Replaces only the keys given; untouched secrets stay as they were. */
  updateSecrets(id: string, secrets: Readonly<Record<string, string>>): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<Connection>;
  remove(id: string): Promise<void>;
  beginSignIn(target: SignInTarget): Promise<SignInStart>;
  /**
   * Finishes a sign-in from the provider's redirect. Creates the connection, or
   * refreshes the one that account already has. Returns it.
   */
  completeSignIn(callbackUrl: string): Promise<Connection>;
  /** Starts linking a phone; the result finishes in the background. */
  beginPairing(target: SignInTarget): Promise<PairingStart>;
  pairingStatus(pairingId: string): PairingStatus;
}
