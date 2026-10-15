import type { IAppShell } from './AppShell.types';

/** Counts the restarts the Mac app was asked for. */
export class MockAppShell implements IAppShell {
  public restarts = 0;

  public restart(): void {
    this.restarts += 1;
  }
}
