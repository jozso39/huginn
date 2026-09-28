/**
 * Symmetric encryption for connector tokens at rest. The key lives only in the
 * environment, so a copied database (or a restic backup) is useless on its own.
 */
export interface ISecretBox {
  seal(plaintext: string): Promise<string>;
  open(ciphertext: string): Promise<string>;
}
