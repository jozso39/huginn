import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ConnectorKind } from '@/core/connections/Connection.types';
import { CONNECTION_COLORS } from '@/core/connections/Connection.utils';
import { ErrorCode } from '@/core/errors/errors';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';

const GITLAB = {
  kind: ConnectorKind.GitLab,
  config: { baseUrl: 'https://gitlab.example.com' },
  secrets: { token: 'glpat-test' },
};

describe('Categories and colours of connections', () => {
  let container: Container;

  beforeAll(() => {
    container = createTestContainer();
  });

  afterAll(async () => {
    await container.connectorHost.stopAll();
    container.close();
  });

  test('a category is created once; the same name in other case gives the same one', async () => {
    const work = await container.connectionGroupService.create('  Work ');
    const again = await container.connectionGroupService.create('work');

    expect(work.name).toBe('Work');
    expect(again.id).toBe(work.id);
    await expect(container.connectionGroupService.create('   ')).rejects.toMatchObject({
      code: ErrorCode.Validation,
    });
  });

  test('categories are listed alphabetically, used or not', async () => {
    await container.connectionGroupService.create('Personal');
    await container.connectionGroupService.create('family');

    expect((await container.connectionGroupService.list()).map((g) => g.name)).toEqual([
      'family',
      'Personal',
      'Work',
    ]);
  });

  test('renaming to a name another category has is refused; a new case is fine', async () => {
    const [family, personal] = await container.connectionGroupService.list();

    await expect(
      container.connectionGroupService.rename(family?.id ?? '', 'PERSONAL')
    ).rejects.toMatchObject({ code: ErrorCode.Validation });
    expect(
      (await container.connectionGroupService.rename(personal?.id ?? '', 'personal')).name
    ).toBe('personal');
  });

  test('new connections get distinct colours from the palette', async () => {
    const work = await container.connectionGroupService.create('Work');
    const first = await container.connectionService.create({
      ...GITLAB,
      name: 'GitLab one',
      groupId: work.id,
    });
    const second = await container.connectionService.create({ ...GITLAB, name: 'GitLab two' });

    expect(first.groupId).toBe(work.id);
    expect(first.color).toBe(CONNECTION_COLORS[0] ?? '');
    expect(second.color).toBe(CONNECTION_COLORS[1] ?? '');
    expect(second.groupId).toBeNull();
  });

  test('a category that does not exist is refused', async () => {
    await expect(
      container.connectionService.create({
        ...GITLAB,
        name: 'GitLab three',
        groupId: crypto.randomUUID(),
      })
    ).rejects.toMatchObject({ code: ErrorCode.Validation });
  });

  test('changing category or colour keeps the connector running; new settings restart it', async () => {
    const connection = (await container.connectionService.list()).find(
      (c) => c.name === 'GitLab two'
    );
    const id = connection?.id ?? '';
    const running = container.connectorHost.getConnector(id);
    const personal = await container.connectionGroupService.create('Personal');
    const moved = await container.connectionService.update(id, {
      name: 'GitLab two',
      config: GITLAB.config,
      groupId: personal.id,
      color: '#ABCDEF',
    });

    expect(moved.groupId).toBe(personal.id);
    expect(moved.color).toBe('#abcdef');
    expect(container.connectorHost.getConnector(id)).toBe(running);

    await container.connectionService.update(id, {
      name: 'GitLab two',
      config: { ...GITLAB.config, baseUrl: 'https://gitlab.example.org' },
    });

    expect(container.connectorHost.getConnector(id)).not.toBe(running);
  });

  test('deleting a category leaves its connections without one', async () => {
    const work = await container.connectionGroupService.create('Work');

    await container.connectionGroupService.remove(work.id);

    const first = (await container.connectionService.list()).find((c) => c.name === 'GitLab one');

    expect(first?.groupId).toBeNull();
    expect((await container.connectionGroupService.list()).map((g) => g.name)).not.toContain(
      'Work'
    );
  });
});
