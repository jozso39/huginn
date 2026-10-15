/** The Mac app around the server; there is none when Huginn runs on its own. */
export interface IAppShell {
  /** Quits and starts Huginn again, which brings in a downloaded update. */
  restart(): void;
}
