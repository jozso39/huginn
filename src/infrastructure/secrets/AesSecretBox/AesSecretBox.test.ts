import { describe, expect, test } from 'bun:test';
import { AesSecretBox } from './AesSecretBox';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('AesSecretBox', () => {
  test('round-trips and never repeats ciphertext', async () => {
    const box = new AesSecretBox(KEY);
    const first = await box.seal('glpat-abc');
    const second = await box.seal('glpat-abc');

    expect(first).not.toBe(second);
    expect(first.startsWith('v1.')).toBe(true);
    expect(await box.open(first)).toBe('glpat-abc');
  });

  test('refuses a wrong key and a wrong format', async () => {
    const box = new AesSecretBox(KEY);
    const other = new AesSecretBox(Buffer.alloc(32, 9).toString('base64'));
    const sealed = await box.seal('secret');

    await expect(other.open(sealed)).rejects.toBeDefined();
    await expect(box.open('nope')).rejects.toThrow('unrecognised secret format');
    expect(() => new AesSecretBox('short')).toThrow('32 bytes');
  });
});
