import { afterEach, describe, expect, test } from 'bun:test';
import type { HuginnEvent } from '@/core/events/EventBus.types';
import { HuginnEventType } from '@/core/events/EventBus.types';
import { MockAppShell } from '@/core/updates/AppShell.mock';
import type { Container } from '@/dependency/container/container.types';
import { createTestContainer } from '@/dependency/container/testContainer';

describe('An update waiting for a restart', () => {
  let container: Container;

  afterEach(() => container.close());

  const start = (shell: MockAppShell | null) => {
    container = createTestContainer(shell ? { appShell: shell } : {});

    const events: HuginnEvent[] = [];

    container.eventBus.subscribe((event) => events.push(event));

    return events;
  };

  test('none until the Mac app has installed one', () => {
    start(new MockAppShell());

    expect(container.appUpdateService.waiting()).toBeNull();
  });

  test('once installed it is offered to the window, once per version', () => {
    const events = start(new MockAppShell());

    container.appUpdateService.ready('0.5.0');
    // The shell says it again after restarting a crashed server.
    container.appUpdateService.ready('0.5.0');

    expect(container.appUpdateService.waiting()).toEqual({ version: '0.5.0' });
    expect(events).toEqual([
      { type: HuginnEventType.AppUpdateReady, update: { version: '0.5.0' } },
    ]);
  });

  test('restarting asks the Mac app to restart', () => {
    const shell = new MockAppShell();

    start(shell);
    container.appUpdateService.ready('0.5.0');
    container.appUpdateService.restart();

    expect(shell.restarts).toBe(1);
  });

  test('without an update there is nothing to restart into', () => {
    const shell = new MockAppShell();

    start(shell);

    expect(() => container.appUpdateService.restart()).toThrow('no update is waiting');
    expect(shell.restarts).toBe(0);
  });

  test('without the Mac app there is nothing to restart', () => {
    start(null);
    container.appUpdateService.ready('0.5.0');

    expect(() => container.appUpdateService.restart()).toThrow('no update is waiting');
  });
});
