import type { Connection, ConnectorKind, NewConnection } from '@/core/connections/Connection.types';
import type {
  AuthorizationMode,
  ConnectorCapabilities,
  SecretField,
} from '@/core/connectors/Connector.types';

/** What the "add connection" form needs to render one connector kind. */
export interface ConnectorDescriptor {
  readonly kind: ConnectorKind;
  readonly label: string;
  /** JSON Schema of the config, for a generic form. */
  readonly configSchema: unknown;
  readonly secretFields: readonly SecretField[];
  readonly capabilities: ConnectorCapabilities;
  /** True when connections of this kind need an interactive sign-in. */
  readonly signIn: boolean;
}

export interface SignInStart {
  readonly url: string;
  readonly mode: AuthorizationMode;
}

export interface IConnectionService {
  describeConnectors(): readonly ConnectorDescriptor[];
  list(): Promise<readonly Connection[]>;
  get(id: string): Promise<Connection | null>;
  create(input: NewConnection): Promise<Connection>;
  updateConfig(id: string, name: string, config: Connection['config']): Promise<Connection>;
  /** Replaces only the keys given; untouched secrets stay as they were. */
  updateSecrets(id: string, secrets: Readonly<Record<string, string>>): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<Connection>;
  remove(id: string): Promise<void>;
  /** The provider URL to send the user to. */
  beginSignIn(id: string): Promise<SignInStart>;
  /**
   * Finishes a sign-in from the provider's redirect — either the callback request
   * itself or the address the user pasted back. Returns the connection it was for.
   */
  completeSignIn(redirectedTo: string): Promise<Connection>;
}
