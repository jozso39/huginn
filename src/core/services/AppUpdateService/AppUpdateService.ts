import type { Logger } from '@/lib/logger';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import type { IEventBus } from '@/core/events/EventBus.types';
import { HuginnEventType } from '@/core/events/EventBus.types';
import type { IAppShell } from '@/core/updates/AppShell.types';
import type { AppUpdate } from '@/core/updates/AppUpdate.types';
import type { IAppUpdateService } from './AppUpdateService.types';

export class AppUpdateService implements IAppUpdateService {
  private update: AppUpdate | null = null;

  constructor(
    private readonly logger: Logger,
    /** Null without the Mac app: nothing to update or restart then. */
    private readonly shell: IAppShell | null,
    private readonly eventBus: IEventBus
  ) {}

  public waiting(): AppUpdate | null {
    return this.update;
  }

  public ready(version: string): void {
    if (this.update?.version === version) {
      return;
    }

    this.update = { version };
    this.logger.info({ version }, 'an update is ready');
    this.eventBus.publish({ type: HuginnEventType.AppUpdateReady, update: this.update });
  }

  public restart(): void {
    if (!this.update || !this.shell) {
      throw new HuginnError(ErrorCode.Unsupported, 'no update is waiting');
    }

    this.logger.info({ version: this.update.version }, 'restarting to update');
    this.shell.restart();
  }
}
