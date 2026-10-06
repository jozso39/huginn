import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';
import { createApp } from './app';

describe('HTTP API', () => {
  let container: Container;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    container = createTestContainer();
    app = createApp(container, '/nonexistent', () => 3000);
  });

  afterAll(async () => {
    await container.connectorHost.stopAll();
    container.close();
  });

  const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  test('validation errors come back as 400 with issues', async () => {
    const response = await json('/api/connections', { kind: 'Nope', name: '' });
    const body = (await response.json()) as { error: string; details: unknown[] };

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation');
    expect(body.details.length).toBeGreaterThan(0);
  });

  test('unknown item is 404', async () => {
    const response = await app.request('/api/items/00000000-0000-0000-0000-000000000000');

    expect(response.status).toBe(404);
  });

  test('lists connector kinds', async () => {
    const response = await app.request('/api/connections/kinds');
    const { kinds } = (await response.json()) as { kinds: { kind: string }[] };

    expect(kinds.map((kind) => kind.kind)).toContain('GitLab');
  });
});
