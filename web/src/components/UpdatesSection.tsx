import type { ReactNode } from 'react';
import { useState } from 'react';
import { api } from '../api';
import type { AppInfo } from '../api.types';
import { relativeTime } from '../connectorMeta';
import { openLinkProps, releaseNotesUrl } from '../openLink';

interface UpdatesSectionProps {
  app: AppInfo;
  onApp: (app: AppInfo) => void;
}

type Action = 'check' | 'install' | 'restart';

const ACTION_LABEL: Record<Action, string> = {
  check: 'Check for updates',
  install: 'Install',
  restart: 'Restart to update',
};

/** The line under the version, and the one button that moves it on. */
const describe = (
  app: AppInfo,
  notes: (version: string) => ReactNode
): { text: ReactNode; action: Action | null; failed?: boolean } => {
  const { state, version, error, at } = app.status;
  const when = at ? ` · ${relativeTime(at)}` : '';

  switch (state) {
    case 'Idle':
      return {
        text: 'Not checked yet: Huginn checks half a minute after it starts.',
        action: 'check',
      };
    case 'Checking':
      return { text: 'Checking for a newer version…', action: null };
    case 'UpToDate':
      return { text: `Up to date${when}.`, action: 'check' };
    case 'Available':
      return {
        text: (
          <>
            Huginn {version} is available. {version && notes(version)}
          </>
        ),
        action: 'install',
      };
    case 'Installing':
      return { text: `Downloading and installing Huginn ${version ?? ''}…`, action: null };
    case 'Ready':
      return {
        text: (
          <>
            Huginn {version} is installed and runs from the next start. {version && notes(version)}
          </>
        ),
        action: 'restart',
      };
    case 'Failed':
      return {
        text: `Could not update: ${error ?? 'unknown error'}${when}.`,
        action: 'check',
        failed: true,
      };
  }
};

/**
 * Settings → Updates: the version running, what is new in it, where updating stands,
 * a check on demand, and whether newer versions install without asking.
 */
export const UpdatesSection = ({ app, onApp }: UpdatesSectionProps) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notes = (version: string) => (
    <a {...openLinkProps(releaseNotesUrl(app.releasesUrl, version))}>What’s new</a>
  );

  // The outcome arrives as an event; the request only has to be accepted.
  const run = async (call: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);

    try {
      await call();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const act = (action: Action) =>
    run(
      {
        check: api.checkForUpdate,
        install: api.installUpdate,
        restart: api.restartToUpdate,
      }[action]
    );

  const setAutomatic = (automatic: boolean) =>
    run(() => api.setAutomaticUpdates(automatic).then(onApp));

  const status = describe(app, notes);

  return (
    <div className="updates">
      <p className="updates__version">
        <strong>Huginn {app.version}</strong> · {notes(app.version)}
      </p>

      {!app.updatable && (
        <p className="muted">Updates come with the Mac app; this Huginn runs on its own.</p>
      )}

      {app.updatable && (
        <>
          <div className="updates__status">
            <p className={status.failed ? 'error' : undefined} role="status">
              {status.text}
            </p>
            <button
              type="button"
              className={
                status.action === 'check' || status.action === null ? undefined : 'primary'
              }
              disabled={busy || status.action === null}
              onClick={() => status.action && void act(status.action)}
            >
              {status.action ? ACTION_LABEL[status.action] : 'Working…'}
            </button>
          </div>
          {error && <p className="error">{error}</p>}

          <label className="switch-field">
            <input
              type="checkbox"
              checked={app.automatic}
              disabled={busy}
              onChange={(e) => void setAutomatic(e.target.checked)}
            />
            <span className="switch-field__text">
              Install updates automatically
              <small className="muted">
                Huginn checks every hour and installs a newer version in the background; it runs
                from the next start. Off: Huginn still checks, tells you here, and installs only
                when you click Install.
              </small>
            </span>
          </label>
        </>
      )}
    </div>
  );
};
