import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import type { IEventBus } from '@/core/events/EventBus.types';
import { HuginnEventType } from '@/core/events/EventBus.types';
import type { ISettingsStore } from '@/core/settings/Settings.types';
import type { IAppShell } from '@/core/updates/AppShell.types';
import type { AppInfo, UpdateStatus } from '@/core/updates/AppUpdate.types';
import { UpdateState } from '@/core/updates/AppUpdate.types';
import type { IAppUpdateService, ReportedStatus } from './AppUpdateService.types';

const KEY = 'updates';

// Automatic updates stay on unless switched off; a version never seen shows its news.
const storedSchema = z
  .object({
    automatic: z.boolean().catch(true),
    seenVersion: z.string().nullable().catch(null),
  })
  .catch({ automatic: true, seenVersion: null });

type Stored = z.infer<typeof storedSchema>;

/** Hourly checks would fill the log; what changes something is worth a line. */
const QUIET_STATES = new Set([UpdateState.Checking, UpdateState.UpToDate]);

export interface AppVersion {
  readonly version: string;
  readonly releasesUrl: string;
}

export class AppUpdateService implements IAppUpdateService {
  private stored: Stored = { automatic: true, seenVersion: null };
  private status: UpdateStatus = { state: UpdateState.Idle, version: null, error: null, at: null };

  constructor(
    private readonly logger: Logger,
    /** Null without the Mac app: nothing to check, install or restart then. */
    private readonly shell: IAppShell | null,
    private readonly store: ISettingsStore,
    private readonly eventBus: IEventBus,
    private readonly app: AppVersion
  ) {}

  public async start(): Promise<void> {
    this.stored = storedSchema.parse((await this.store.get(KEY)) ?? {});
    this.shell?.setAutomaticUpdates(this.stored.automatic);
  }

  public info(): AppInfo {
    return {
      version: this.app.version,
      releasesUrl: this.app.releasesUrl,
      updatable: this.shell !== null,
      automatic: this.stored.automatic,
      status: this.status,
      whatsNew: this.stored.seenVersion === this.app.version ? null : this.app.version,
    };
  }

  public async setAutomatic(automatic: boolean): Promise<AppInfo> {
    const shell = this.requireShell();

    await this.save({ ...this.stored, automatic });
    this.logger.info({ automatic }, 'automatic updates changed');
    shell.setAutomaticUpdates(automatic);

    return this.changed();
  }

  public check(): void {
    this.requireShell().checkForUpdate();
  }

  public install(): void {
    const shell = this.requireShell();

    if (this.status.state !== UpdateState.Available) {
      throw new HuginnError(ErrorCode.Unsupported, 'no newer version is waiting to be installed');
    }

    shell.installUpdate();
  }

  public restart(): void {
    const shell = this.requireShell();

    if (this.status.state !== UpdateState.Ready) {
      throw new HuginnError(ErrorCode.Unsupported, 'no update is waiting');
    }

    this.logger.info({ version: this.status.version }, 'restarting to update');
    shell.restart();
  }

  public statusChanged(status: ReportedStatus): void {
    this.status = { ...status, at: new Date() };

    if (!QUIET_STATES.has(status.state)) {
      this.logger.info({ ...status }, 'update status');
    }

    this.changed();
  }

  public async dismissWhatsNew(): Promise<AppInfo> {
    await this.save({ ...this.stored, seenVersion: this.app.version });

    return this.changed();
  }

  private requireShell(): IAppShell {
    if (!this.shell) {
      throw new HuginnError(ErrorCode.Unsupported, 'updates come with the Mac app');
    }

    return this.shell;
  }

  private async save(next: Stored): Promise<void> {
    await this.store.set(KEY, next);
    this.stored = next;
  }

  private changed(): AppInfo {
    const app = this.info();

    this.eventBus.publish({ type: HuginnEventType.AppChanged, app });

    return app;
  }
}
