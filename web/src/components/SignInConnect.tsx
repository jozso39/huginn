import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ConnectorDescriptor, OAuthAppView, OAuthProvider } from '../api.types';
import { OAuthAppForm } from './OAuthAppForm';

interface SignInConnectProps {
  descriptor: ConnectorDescriptor & { signInProvider: OAuthProvider };
}

/** Starts a sign-in; the browser leaves Huginn and comes back to the connection list. */
export const startSignIn = async (
  target: Parameters<typeof api.signIn>[0],
  onError: (message: string) => void
) => {
  try {
    window.location.assign(await api.signIn(target));
  } catch (e) {
    onError(e instanceof Error ? e.message : String(e));
  }
};

/**
 * Adding a connection that is created by signing in: set the provider app up once,
 * then every account is one "Sign in with …" away.
 */
export const SignInConnect = ({ descriptor }: SignInConnectProps) => {
  const [app, setApp] = useState<OAuthAppView | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = descriptor.signInProvider;

  useEffect(() => {
    void api
      .getOAuthApp(provider)
      .then(setApp)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [provider]);

  if (!app) {
    return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;
  }

  if (!app.configured || editing) {
    return (
      <div className="sign-in-setup">
        <h3>
          {app.configured ? `${provider} sign-in settings` : `Set up ${provider} sign-in once`}
        </h3>
        <OAuthAppForm
          app={app}
          onSaved={(saved) => {
            setApp(saved);
            setEditing(false);
          }}
          onCancel={app.configured ? () => setEditing(false) : undefined}
        />
      </div>
    );
  }

  return (
    <div className="sign-in-connect">
      <p className="muted small">
        Pick the account at {provider}; the connection is created and named after it. Signing in
        with an account you already connected refreshes that connection.
      </p>
      <div className="form-buttons">
        <button
          type="button"
          className="primary"
          onClick={() => void startSignIn({ kind: descriptor.kind }, setError)}
        >
          Sign in with {provider}
        </button>
        <button type="button" onClick={() => setEditing(true)}>
          {provider} sign-in settings
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
};
