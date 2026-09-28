import type { ISecretBox } from '@/core/secrets/SecretBox.types';

const IV_BYTES = 12;

/**
 * AES-256-GCM through WebCrypto. Ciphertext is `v1.<iv>.<data>` in base64 so a
 * future key rotation or algorithm change can tell old rows apart.
 */
export class AesSecretBox implements ISecretBox {
  private readonly key: Promise<CryptoKey>;

  constructor(base64Key: string) {
    const raw = Buffer.from(base64Key, 'base64');

    if (raw.byteLength !== 32) {
      throw new Error('HUGINN_SECRET_KEY must decode to exactly 32 bytes');
    }

    this.key = crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
  }

  public async seal(plaintext: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await this.key,
      new TextEncoder().encode(plaintext)
    );

    return `v1.${Buffer.from(iv).toString('base64')}.${Buffer.from(data).toString('base64')}`;
  }

  public async open(ciphertext: string): Promise<string> {
    const [version, ivPart, dataPart] = ciphertext.split('.');

    if (version !== 'v1' || !ivPart || !dataPart) {
      throw new Error('unrecognised secret format');
    }

    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Buffer.from(ivPart, 'base64') },
      await this.key,
      Buffer.from(dataPart, 'base64')
    );

    return new TextDecoder().decode(plain);
  }
}
