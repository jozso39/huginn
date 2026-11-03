/** Where updating stands, as the Mac app reports it. */
export enum UpdateState {
  /** Not checked since Huginn started (the first check runs half a minute in). */
  Idle = 'Idle',
  Checking = 'Checking',
  UpToDate = 'UpToDate',
  /** A newer version exists; automatic updates are off, so it waits for Install. */
  Available = 'Available',
  /** Downloading and installing the newer version. */
  Installing = 'Installing',
  /** Installed: it runs from the next start (Restart to update). */
  Ready = 'Ready',
  Failed = 'Failed',
}

/** The Mac app's latest word on updates. */
export interface UpdateStatus {
  readonly state: UpdateState;
  /** The newer version, for Available, Installing and Ready. */
  readonly version: string | null;
  /** Why the last check or install failed. */
  readonly error: string | null;
  /** When the Mac app reported this state; null while Idle. */
  readonly at: Date | null;
}

/** What the window shows about Huginn's own version and its updates. */
export interface AppInfo {
  /** The version running now. */
  readonly version: string;
  /** Where each version's changes are listed: `<releasesUrl>/tag/v<version>`. */
  readonly releasesUrl: string;
  /** False without the Mac app: nothing checks or installs updates then. */
  readonly updatable: boolean;
  /** Whether a newer version is downloaded and installed without asking. */
  readonly automatic: boolean;
  readonly status: UpdateStatus;
  /** The version Huginn started on for the first time and the user has not acknowledged. */
  readonly whatsNew: string | null;
}
