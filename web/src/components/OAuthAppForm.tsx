import { useState } from 'react';
import { api } from '../api';
import type { OAuthAppView, RedirectMode } from '../api.types';

interface OAuthAppFormProps {
  app: OAuthAppView;
  onSaved: (app: OAuthAppView) => void;
  onCancel?: () => void;
}

const MODE_LABEL: Record<RedirectMode, string> = {
  Relay: 'Through the relay page (works with any Google project)',
  Direct: 'Straight back to Huginn (only if Google accepts this address)',
};

const CopyField = ({ value }: { value: string }) => {
  const [copied, setCopied] = useState(false);

  return (
    <span className="copy-field">
      <code>{value}</code>
      <button
        type="button"
        onClick={() =>
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
};

/**
 * The one-time setup of the Google OAuth client every Google connection signs in
 * with. The secret is write-only: the form never receives it back.
 */
export const OAuthAppForm = ({ app, onSaved, onCancel }: OAuthAppFormProps) => {
  const available = (['Relay', 'Direct'] as const).filter((mode) => app.redirectUris[mode]);
  const [clientId, setClientId] = useState(app.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [mode, setMode] = useState<RedirectMode>(app.redirectMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redirectUri = app.redirectUris[mode];

  if (available.length === 0) {
    return (
      <p className="error">
        Huginn does not know its own address yet: set HUGINN_PUBLIC_URL in its .env and restart it.
      </p>
    );
  }

  const save = async () => {
    setBusy(true);
    setError(null);

    try {
      onSaved(
        await api.saveOAuthApp(app.provider, {
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          redirectMode: mode,
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="connection-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <ol className="steps small">
        <li>
          Open{' '}
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noreferrer"
          >
            Google Cloud → Credentials
          </a>{' '}
          in the project that has the Gmail API enabled.
        </li>
        <li>
          <strong>Create credentials → OAuth client ID → Web application.</strong>
        </li>
        <li>
          Under <em>Authorised redirect URIs</em> add:
          {redirectUri && <CopyField value={redirectUri} />}
        </li>
        <li>Create, then paste the client ID and secret below.</li>
      </ol>
      {available.length > 1 && (
        <label>
          How Google returns you to Huginn
          <select value={mode} onChange={(e) => setMode(e.target.value as RedirectMode)}>
            {available.map((option) => (
              <option key={option} value={option}>
                {MODE_LABEL[option]}
              </option>
            ))}
          </select>
          <small className="muted">
            Changing this changes the redirect URI above; register the one you choose.
          </small>
        </label>
      )}
      <label>
        Client ID
        <input
          value={clientId}
          placeholder="…apps.googleusercontent.com"
          autoComplete="off"
          required
          onChange={(e) => setClientId(e.target.value)}
        />
      </label>
      <label>
        Client secret
        <input
          type="password"
          value={clientSecret}
          placeholder={app.configured ? 'unchanged — paste to replace' : 'GOCSPX-…'}
          autoComplete="off"
          required={!app.configured}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </label>
      <p className="muted small">
        Stored encrypted and never sent back to the browser. Every Gmail you connect uses this one
        client.
      </p>
      <div className="form-buttons">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
};
