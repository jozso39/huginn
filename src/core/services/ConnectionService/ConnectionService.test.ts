import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ConnectionStatus, ConnectorKind } from '@/core/connections/Connection.types';
import { ErrorCode } from '@/core/errors/errors';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';

describe('ConnectionService', () => {
  let container: Container;

  beforeAll(() => {
    container = createTestContainer();
  });

  afterAll(async () => {
    await container.connectorHost.stopAll();
    container.close();
  });

  test('describes the connector kinds with a JSON schema and secret fields', () => {
    const gitlab = container.connectionService
      .describeConnectors()
      .find((descriptor) => descriptor.kind === ConnectorKind.GitLab);

    expect(gitlab?.secretFields.map((field) => field.key)).toEqual(['token']);
    expect(gitlab?.configSchema).toMatchObject({ type: 'object' });
  });

  test('fields with a default are optional in the form', () => {
    const slack = container.connectionService
      .describeConnectors()
      .find((descriptor) => descriptor.kind === ConnectorKind.Slack);
    const schema = slack?.configSchema as { required?: string[]; properties: object };

    expect(schema.required ?? []).not.toContain('watchChannels');
    expect(Object.keys(schema.properties)).toContain('channelScope');
  });

  test('rejects a connection with invalid config or missing secrets', async () => {
    await expect(
      container.connectionService.create({
        kind: ConnectorKind.GitLab,
        name: 'bad url',
        config: { baseUrl: 'not a url' },
        secrets: { token: 'x' },
      })
    ).rejects.toMatchObject({ code: ErrorCode.Validation });

    await expect(
      container.connectionService.create({
        kind: ConnectorKind.GitLab,
        name: 'no token',
        config: { baseUrl: 'https://gitlab.example.com' },
        secrets: {},
      })
    ).rejects.toMatchObject({ code: ErrorCode.Validation });
  });

  test('stores secrets sealed, starts the connector, and can disable it', async () => {
    const created = await container.connectionService.create({
      kind: ConnectorKind.GitLab,
      name: 'Work GitLab',
      config: { baseUrl: 'https://gitlab.example.com' },
      secrets: { token: 'glpat-secret' },
    });

    expect(created.status).toBe(ConnectionStatus.Running);

    const ciphertext = await container.connectionStore.getSecretsCiphertext(created.id);

    expect(ciphertext).not.toContain('glpat-secret');
    expect(JSON.parse(await container.secretBox.open(ciphertext ?? ''))).toEqual({
      token: 'glpat-secret',
    });

    const disabled = await container.connectionService.setEnabled(created.id, false);

    expect(disabled.status).toBe(ConnectionStatus.Disabled);
    expect(container.connectorHost.getConnector(created.id)).toBeNull();
  });

  test('updating secrets keeps the keys that were left blank', async () => {
    const [connection] = await container.connectionService.list();

    await container.connectionService.updateSecrets(connection?.id ?? '', { token: '' });

    const ciphertext = await container.connectionStore.getSecretsCiphertext(connection?.id ?? '');

    expect(JSON.parse(await container.secretBox.open(ciphertext ?? ''))).toEqual({
      token: 'glpat-secret',
    });
  });
});
