import type { IAppShell } from './AppShell.types';

/** Records what the Mac app was asked to do. */
export class MockAppShell implements IAppShell {
  public restarts = 0;
  public checks = 0;
  public installs = 0;
  /** Every automatic-updates value it was told, in order. */
  public readonly automatic: boolean[] = [];

  public restart(): void {
    this.restarts += 1;
  }

  public setAutomaticUpdates(automatic: boolean): void {
    this.automatic.push(automatic);
  }

  public checkForUpdate(): void {
    this.checks += 1;
  }

  public installUpdate(): void {
    this.installs += 1;
  }
}
