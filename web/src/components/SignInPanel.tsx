import { useState } from 'react';
import { api } from '../api';
import type { Connection } from '../api.types';

interface SignInPanelProps {
  connection: Connection;
  onSignedIn: () => Promise<void>;
}

/**
 * Starts an OAuth sign-in. With a Desktop-type client the provider lands the user on
 * a localhost page that does not load; they paste that page's address back here.
 */
export const SignInPanel = ({ connection, onSignedIn }: SignInPanelProps) => {
  const [waitingForPaste, setWaitingForPaste] = useState(false);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needed = connection.status === 'NeedsAuth';

  const start = async () => {
    setError(null);

    try {
      const { url, mode } = await api.beginSignIn(connection.id);

      if (mode === 'Redirect') {
        window.location.assign(url);

        return;
      }

      window.open(url, '_blank', 'noopener');
      setWaitingForPaste(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);

    try {
      await api.completeSignIn(pasted);
      setWaitingForPaste(false);
      setPasted('');
      await onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={needed ? 'sign-in sign-in--needed' : 'sign-in'}>
      <button type="button" className={needed ? 'primary' : ''} onClick={() => void start()}>
        {needed ? 'Sign in with Google' : 'Sign in again'}
      </button>
      {waitingForPaste && (
        <form
          className="sign-in__paste"
          onSubmit={(e) => {
            e.preventDefault();
            void finish();
          }}
        >
          <p className="small">
            Approve access in the tab that opened. Google then sends you to a
            <code> localhost </code> page that does not load — that is expected. Copy that
            page&apos;s whole address from the address bar and paste it here.
          </p>
          <input
            value={pasted}
            placeholder="http://localhost/?state=…&code=…"
            autoComplete="off"
            onChange={(e) => setPasted(e.target.value)}
          />
          <div className="form-buttons">
            <button type="submit" className="primary" disabled={busy || !pasted.trim()}>
              {busy ? 'Signing in…' : 'Finish sign-in'}
            </button>
            <button type="button" onClick={() => setWaitingForPaste(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
};
