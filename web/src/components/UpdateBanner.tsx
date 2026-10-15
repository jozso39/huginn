import { useState } from 'react';
import { api } from '../api';
import type { AppUpdate } from '../api.types';

interface UpdateBannerProps {
  update: AppUpdate;
}

/**
 * A strip along the bottom once the Mac app has downloaded and installed a newer
 * Huginn: one click restarts into it. "Later" hides it for now; the new version also
 * starts by itself the next time Huginn does.
 */
export const UpdateBanner = ({ update }: UpdateBannerProps) => {
  const [hidden, setHidden] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (hidden) {
    return null;
  }

  // The window closes and opens again on the new version; nothing to do after this.
  const restart = async () => {
    setRestarting(true);
    setError(null);

    try {
      await api.restartToUpdate();
    } catch (e) {
      setRestarting(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="update-bar" role="status">
      <p className="update-bar__text">
        <strong>Huginn {update.version} is ready.</strong>{' '}
        {restarting ? 'Restarting…' : 'Restart to use it: it takes a few seconds.'}
      </p>
      {error && <p className="update-bar__error">{error}</p>}
      <div className="update-bar__buttons">
        <button type="button" onClick={() => setHidden(true)} disabled={restarting}>
          Later
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => void restart()}
          disabled={restarting}
        >
          {restarting ? 'Restarting…' : 'Restart to update'}
        </button>
      </div>
    </div>
  );
};
