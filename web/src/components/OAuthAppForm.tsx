import { useState } from 'react';
import { api } from '../api';
import type { OAuthAppView, RedirectMode } from '../api.types';
import { SetupGuide } from './SetupGuide';

interface OAuthAppFormProps {
  app: OAuthAppView;
  onSaved: (app: OAuthAppView) => void;
  onCancel?: () => void;
}

const MODE_LABEL: Record<RedirectMode, string> = {
  Relay: 'Through the relay page (works with any Google project)',
  Direct: 'Straight back to Huginn (only if Google accepts this address)',
};

const SLACK_GUIDE = 'https://github.com/jozso39/huginn/blob/main/docs/slack-app.md';

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
 * Slack: the company's own Huginn app, signed in to with PKCE. Only its client ID is
 * needed, and it is no secret: everyone in the company enters the same one.
 */
const SlackAppForm = ({ app, onSaved, onCancel }: OAuthAppFormProps) => {
  const [clientId, setClientId] = useState(app.clientId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!app.redirectUris.Direct) {
    return <p className="error">Slack sign-in works only in the Huginn app on a Mac.</p>;
  }

  const save = async () => {
    setBusy(true);
    setError(null);

    try {
      onSaved(
        await api.saveOAuthApp(app.provider, {
          clientId: clientId.trim(),
          clientSecret: '',
          redirectMode: 'Direct',
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
      <SetupGuide title="Setting up Slack sign-in (once per Mac)">
        <ol>
          <li>
            A Slack admin creates your company&apos;s Huginn app once, from the{' '}
            <a href={SLACK_GUIDE} target="_blank" rel="noreferrer">
              manifest in the setup guide
            </a>
            . Its redirect URLs must list:
            {app.registerUris.map((uri) => (
              <CopyField key={uri} value={uri} />
            ))}
          </li>
          <li>
            Paste the app&apos;s <strong>Client ID</strong> below (at api.slack.com/apps → Huginn →{' '}
            <strong>Basic Information → App Credentials</strong>). It is not a secret: colleagues
            use the same one, then each signs in as themselves.
          </li>
        </ol>
      </SetupGuide>
      <label>
        Client ID
        <input
          value={clientId}
          placeholder="1234567890.1234567890123"
          autoComplete="off"
          required
          onChange={(e) => setClientId(e.target.value)}
        />
      </label>
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

/**
 * The one-time setup of the OAuth client every connection of a provider signs in with.
 * Google's secret is write-only: the form never receives it back.
 */
export const OAuthAppForm = ({ app, onSaved, onCancel }: OAuthAppFormProps) => {
  if (!app.needsSecret) {
    return <SlackAppForm app={app} onSaved={onSaved} onCancel={onCancel} />;
  }

  return <GoogleAppForm app={app} onSaved={onSaved} onCancel={onCancel} />;
};

const GoogleAppForm = ({ app, onSaved, onCancel }: OAuthAppFormProps) => {
  const available = (['Relay', 'Direct'] as const).filter((mode) => app.redirectUris[mode]);
  const [clientId, setClientId] = useState(app.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [mode, setMode] = useState<RedirectMode>(app.redirectMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redirectUri = app.redirectUris[mode];
  // The server lists every address for the mode it reports (one per port on a Mac).
  const toRegister =
    mode === app.redirectMode ? app.registerUris : redirectUri ? [redirectUri] : [];

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
      <SetupGuide title="Setting up Google sign-in (once per Mac)">
        <p>
          Did a colleague or your admin already make Huginn&apos;s Google client? Ask them for its
          client ID and secret and skip to the fields below.
        </p>
        <ol>
          <li>
            In{' '}
            <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">
              Google Cloud
            </a>
            , pick the project (top left). For work mail, one in your company&apos;s organisation.
          </li>
          <li>
            Turn on the{' '}
            <a
              href="https://console.cloud.google.com/apis/library/gmail.googleapis.com"
              target="_blank"
              rel="noreferrer"
            >
              Gmail API
            </a>
            : <strong>Enable</strong>.
          </li>
          <li>
            In{' '}
            <a
              href="https://console.cloud.google.com/auth/overview"
              target="_blank"
              rel="noreferrer"
            >
              Google Auth Platform
            </a>
            , <strong>Get started</strong> if it asks: app name <em>Huginn</em>, your e-mail.
            Audience <strong>Internal</strong> lets in only your company&apos;s accounts;{' '}
            <strong>External</strong> also personal Gmail, then <strong>Publish app</strong> under
            Audience (while testing, sign-ins expire after 7 days).
          </li>
          <li>
            <strong>Clients → Create client → Web application</strong>, name <em>Huginn</em>. Under{' '}
            <strong>Authorised redirect URIs</strong> add
            {toRegister.length > 1 ? ' all of these (Huginn takes the first free port)' : ''}:
            {toRegister.map((uri) => (
              <CopyField key={uri} value={uri} />
            ))}
          </li>
          <li>
            <strong>Create</strong>, then copy the client ID and secret into the fields below. Copy
            the secret right away: Google does not show it again.
          </li>
        </ol>
      </SetupGuide>
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
