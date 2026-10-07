import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Connection, ConnectorDescriptor, OAuthAppView, OAuthProvider } from '../api.types';
import { SignInGuide } from './ConnectorGuides';
import { OAuthAppForm } from './OAuthAppForm';

interface SignInConnectProps {
  descriptor: ConnectorDescriptor & { signInProvider: OAuthProvider };
  /** The sign-in finished: a new connection, or the one that account already had. */
  onConnected: (connection: Connection, created: boolean) => Promise<void>;
}

const POLL_MS = 2_000;

/**
 * Starts a sign-in. The provider's page opens in the browser (the Mac app hands it over;
 * a browser tab goes there itself). Returns the id to ask how it ended, or null.
 */
export const startSignIn = async (
  target: Parameters<typeof api.signIn>[0],
  onError: (message: string) => void
): Promise<string | null> => {
  try {
    const { url, signInId } = await api.signIn(target);

    window.location.assign(url);

    return signInId;
  } catch (e) {
    onError(e instanceof Error ? e.message : String(e));

    return null;
  }
};

type Stage =
  { step: 'idle' } | { step: 'waiting'; signInId: string } | { step: 'failed'; error: string };

/**
 * Adding a connection that is created by signing in: set the provider app up once,
 * then every account is one "Sign in with …" away. The sign-in happens in the browser,
 * so this waits for it and hands the result on, instead of looking as if nothing
 * happened.
 */
export const SignInConnect = ({ descriptor, onConnected }: SignInConnectProps) => {
  const [app, setApp] = useState<OAuthAppView | null>(null);
  const [editing, setEditing] = useState(false);
  const [stage, setStage] = useState<Stage>({ step: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const provider = descriptor.signInProvider;
  const signInId = stage.step === 'waiting' ? stage.signInId : null;
  useEffect(() => {
    void api
      .getOAuthApp(provider)
      .then(setApp)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [provider]);

  useEffect(() => {
    if (!signInId) {
      return undefined;
    }

    let settled = false;
    const timer = setInterval(() => {
      void api
        .signInStatus(signInId)
        .then(async (status) => {
          if (settled || status.state === 'Waiting') {
            return;
          }

          settled = true;

          if (status.state === 'Done' && status.connection) {
            setStage({ step: 'idle' });
            await onConnected(status.connection, status.created);
          } else {
            setStage({ step: 'failed', error: status.error ?? 'The sign-in failed' });
          }
        })
        .catch((e: unknown) => {
          settled = true;
          setStage({ step: 'failed', error: e instanceof Error ? e.message : String(e) });
        });
    }, POLL_MS);

    return () => {
      settled = true;
      clearInterval(timer);
    };
  }, [signInId, onConnected]);

  const signIn = async () => {
    setError(null);

    const id = await startSignIn({ kind: descriptor.kind }, setError);

    if (id) {
      setStage({ step: 'waiting', signInId: id });
    }
  };

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

  if (stage.step === 'waiting') {
    return (
      <div className="sign-in-connect">
        <p className="notice">
          Finish signing in to {provider} in your browser. Huginn carries on here once you are done.
        </p>
        <div className="form-buttons">
          <button type="button" onClick={() => setStage({ step: 'idle' })}>
            Stop waiting
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sign-in-connect">
      <SignInGuide kind={descriptor.kind} />
      <div className="form-buttons">
        <button type="button" className="primary" onClick={() => void signIn()}>
          Sign in with {provider}
        </button>
        <button type="button" onClick={() => setEditing(true)}>
          {provider} sign-in settings
        </button>
      </div>
      <p className="muted small">
        The connection is named after the account. Signing in with an account you already connected
        renews that connection instead.
      </p>
      {stage.step === 'failed' && <p className="error">{stage.error}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
};
