import type { AppInfo, UpdateState } from '@/core/updates/AppUpdate.types';

/** What the Mac app reports; the service stamps the time. */
export interface ReportedStatus {
  readonly state: UpdateState;
  readonly version: string | null;
  readonly error: string | null;
}

/**
 * Huginn's version and its updates, for the window. The Mac app checks, downloads and
 * installs; this keeps what it reported, the user's choice of automatic updates, and
 * which version's news the user has seen.
 */
export interface IAppUpdateService {
  /** At boot: loads the stored choices and tells the Mac app whether to install by itself. */
  start(): Promise<void>;
  info(): AppInfo;
  setAutomatic(automatic: boolean): Promise<AppInfo>;
  /** Asks the Mac app to check now; the result arrives as a status. */
  check(): void;
  /** Installs the version a check found; fails unless one is Available. */
  install(): void;
  /** Restarts into the installed update; fails unless one is Ready. */
  restart(): void;
  /** The Mac app's report. */
  statusChanged(status: ReportedStatus): void;
  /** The user has seen what is new in this version: the banner goes. */
  dismissWhatsNew(): Promise<AppInfo>;
}
