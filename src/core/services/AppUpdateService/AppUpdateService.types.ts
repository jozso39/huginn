import type { AppUpdate } from '@/core/updates/AppUpdate.types';

/**
 * The update waiting for a restart, so the window can offer it. The Mac app downloads
 * and installs updates by itself; a restart is all that is left.
 */
export interface IAppUpdateService {
  /** The update waiting for a restart, if any. */
  waiting(): AppUpdate | null;
  /** The Mac app has installed one. */
  ready(version: string): void;
  /** Restarts into it; fails when none is waiting. */
  restart(): void;
}
