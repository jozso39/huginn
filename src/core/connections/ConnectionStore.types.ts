import type { Connection, ConnectionPatch, ConnectorKind } from './Connection.types';

export interface StoredConnectionInput {
  readonly kind: ConnectorKind;
  readonly name: string;
  readonly config: Connection['config'];
  /** Already sealed by the SecretBox; the store never sees plaintext. */
  readonly secretsCiphertext: string;
}

export interface IConnectionStore {
  create(input: StoredConnectionInput): Promise<Connection>;
  get(id: string): Promise<Connection | null>;
  list(): Promise<readonly Connection[]>;
  update(id: string, patch: ConnectionPatch): Promise<Connection | null>;
  updateSecrets(id: string, secretsCiphertext: string): Promise<void>;
  getSecretsCiphertext(id: string): Promise<string | null>;
  remove(id: string): Promise<void>;
}
