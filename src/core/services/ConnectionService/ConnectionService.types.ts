import type { Connection, ConnectorKind, NewConnection } from '@/core/connections/Connection.types';
import type { SecretField } from '@/core/connectors/Connector.types';

/** What the "add connection" form needs to render one connector kind. */
export interface ConnectorDescriptor {
  readonly kind: ConnectorKind;
  readonly label: string;
  /** JSON Schema of the config, for a generic form. */
  readonly configSchema: unknown;
  readonly secretFields: readonly SecretField[];
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
}
