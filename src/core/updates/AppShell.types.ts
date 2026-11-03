/** The Mac app around the server; there is none when Huginn runs on its own. */
export interface IAppShell {
  /** Quits and starts Huginn again, which brings in a downloaded update. */
  restart(): void;
  /** Whether newer versions install without asking; the hourly checks follow it. */
  setAutomaticUpdates(automatic: boolean): void;
  /** Checks for a newer version now, installing it when updates are automatic. */
  checkForUpdate(): void;
  /** Downloads and installs the newer version a check found. */
  installUpdate(): void;
}
