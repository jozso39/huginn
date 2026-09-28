import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ItemState } from '@/core/items/Item.types';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';
import { createApp } from './app';

describe('HTTP API', () => {
  let container: Container;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    container = createTestContainer();
    app = createApp(container, '/nonexistent');
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

  test('ingest needs the key, then creates an item on an auto-made Ingest connection', async () => {
    const payload = { externalId: 'alert-1', author: 'cron', title: 'Disk 90%' };
    const denied = await json('/api/items', payload);

    expect(denied.status).toBe(401);

    const created = await json('/api/items', payload, {
      'x-huginn-key': container.config.ingestKey,
    });
    const body = (await created.json()) as { item: { state: string; threadKey: string } };

    expect(created.status).toBe(201);
    expect(body.item.state).toBe(ItemState.Open);
    expect(body.item.threadKey).toBe('alert-1');

    const listed = await app.request('/api/items?state=Open');
    const { items } = (await listed.json()) as { items: unknown[] };

    expect(items).toHaveLength(1);
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
