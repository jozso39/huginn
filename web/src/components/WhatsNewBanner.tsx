import { useState } from 'react';
import { api } from '../api';
import type { AppInfo } from '../api.types';
import { openLinkProps, releaseNotesUrl } from '../openLink';

interface WhatsNewBannerProps {
  app: AppInfo;
  /** The version just started for the first time. */
  version: string;
  onApp: (app: AppInfo) => void;
}

/**
 * A strip along the bottom on the first start of a new version, with a link to its
 * changes on GitHub. It stays until opened or dismissed, then not again for this version.
 */
export const WhatsNewBanner = ({ app, version, onApp }: WhatsNewBannerProps) => {
  const [error, setError] = useState<string | null>(null);

  const dismiss = () => {
    setError(null);
    api
      .dismissWhatsNew()
      .then(onApp)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="update-bar" role="status">
      <p className="update-bar__text">
        <strong>Huginn {version} is installed.</strong> See what changed in it on GitHub.
      </p>
      {error && <p className="update-bar__error">{error}</p>}
      <div className="update-bar__buttons">
        <button type="button" onClick={dismiss}>
          Dismiss
        </button>
        {/* Opening the changes counts as having seen them. */}
        <a
          className="button primary"
          {...openLinkProps(releaseNotesUrl(app.releasesUrl, version))}
          onClick={dismiss}
        >
          What’s new
        </a>
      </div>
    </div>
  );
};
