import { useEffect, useMemo, useState } from 'react';
import { renderSVG } from 'uqr';
import { api } from '../api';
import type { Connection, ConnectorKind } from '../api.types';
import { PairingGuide } from './ConnectorGuides';

interface PairConnectProps {
  kind: ConnectorKind;
  /** The phone can link by typing a code instead of scanning (WhatsApp). */
  byPhone: boolean;
  /** Linked by logging in on the service's page in the Mac app's window (Messenger). */
  inWindow: boolean;
  target: { kind: ConnectorKind } | { connectionId: string };
  /** The phone confirmed: a new connection, or one linked again. */
  onLinked: (connection: Connection, created: boolean) => Promise<void>;
}

const POLL_MS = 2_000;

type Stage =
  | { step: 'idle' }
  | { step: 'waiting'; pairingId: string; code: string }
  | { step: 'failed'; error: string };

/** Where the phone keeps its linked devices. */
const SIGNAL_STEPS = { path: 'Signal → Settings → Linked devices', action: '+ (Link new device)' };
const LINK_STEPS: Partial<Record<ConnectorKind, typeof SIGNAL_STEPS>> = {
  Signal: SIGNAL_STEPS,
  WhatsApp: { path: 'WhatsApp → Settings → Linked devices', action: 'Link a device' },
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "Link with phone number instead": the phone types a code rather than scanning one. */
const PhoneLink = ({ pairingId }: { pairingId: string }) => {
  const [asked, setAsked] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!asked) {
    return (
      <button type="button" className="linklike" onClick={() => setAsked(true)}>
        Link with phone number instead
      </button>
    );
  }

  if (code) {
    return (
      <div className="pairing__phone">
        <p className="small">
          On your phone: <strong>Link a device → Link with phone number instead</strong>, and type:
        </p>
        <p className="pairing__code">{code}</p>
      </div>
    );
  }

  return (
    <form
      className="pairing__phone"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        void api
          .pairingPhoneCode(pairingId, phone)
          .then(setCode)
          .catch((err: unknown) => setError(errorText(err)))
          .finally(() => setBusy(false));
      }}
    >
      <label className="field">
        Your phone number, with the country code
        <input
          type="tel"
          value={phone}
          placeholder="+420 600 123 456"
          autoFocus
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      <div className="form-buttons">
        <button type="submit" className="primary" disabled={busy || !phone.trim()}>
          {busy ? 'Asking WhatsApp…' : 'Get the code'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
};

/**
 * Linking a phone: show the code as a QR, the phone scans it (Settings → Linked
 * devices), and the connection appears once the phone confirms. WhatsApp replaces its
 * code every 20 seconds or so; the status poll brings the new one. Messenger instead
 * opens Facebook's login page in a window, and the connection appears once logged in.
 */
export const PairConnect = ({ kind, byPhone, inWindow, target, onLinked }: PairConnectProps) => {
  const [stage, setStage] = useState<Stage>({ step: 'idle' });
  const pairingId = stage.step === 'waiting' ? stage.pairingId : null;
  const code = stage.step === 'waiting' ? stage.code : null;
  // A data: URL keeps the SVG an image — never markup in the page.
  const qr = useMemo(
    () =>
      code && !inWindow
        ? `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(code, { border: 2 }))}`
        : null,
    [code, inWindow]
  );
  const steps = LINK_STEPS[kind] ?? SIGNAL_STEPS;

  useEffect(() => {
    if (!pairingId) {
      return undefined;
    }

    const timer = setInterval(() => {
      void api
        .pairingStatus(pairingId)
        .then(async (status) => {
          if (status.state === 'Linked' && status.connection) {
            setStage({ step: 'idle' });
            await onLinked(status.connection, status.created);
          } else if (status.state === 'Failed') {
            setStage({ step: 'failed', error: status.error ?? 'Linking failed' });
          } else if (status.code) {
            const next = status.code;

            setStage((current) =>
              current.step === 'waiting' && current.code !== next
                ? { ...current, code: next }
                : current
            );
          }
        })
        .catch((e: unknown) => setStage({ step: 'failed', error: errorText(e) }));
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [pairingId, onLinked]);

  const start = async () => {
    try {
      const started = await api.startPairing(target);

      setStage({ step: 'waiting', pairingId: started.pairingId, code: started.code });
    } catch (e) {
      setStage({ step: 'failed', error: errorText(e) });
    }
  };

  if (stage.step === 'waiting' && inWindow) {
    return (
      <div className="pairing">
        <p>Log in to Facebook in the window that opened.</p>
        <p className="muted small">
          Huginn takes over once you are in and the window closes by itself. Closed it too early?
          Wait a moment and try again.
        </p>
      </div>
    );
  }

  if (stage.step === 'waiting' && qr) {
    return (
      <div className="pairing">
        <img className="pairing__qr" src={qr} alt="QR code to link your phone" />
        <ol className="small">
          <li>
            On your phone open <strong>{steps.path}</strong>.
          </li>
          <li>
            Tap <strong>{steps.action}</strong> and scan this code.
          </li>
          <li>Keep this page open; the connection appears when the phone confirms.</li>
        </ol>
        {byPhone && <PhoneLink pairingId={stage.pairingId} />}
        <p className="muted small">
          Anyone who scans the code sees your messages — do not share it.
        </p>
      </div>
    );
  }

  return (
    <div className="pairing">
      <PairingGuide kind={kind} />
      {stage.step === 'failed' && <p className="error">{stage.error}</p>}
      <button type="button" className="primary" onClick={() => void start()}>
        {stage.step === 'failed' ? 'Try again' : inWindow ? 'Log in to Facebook' : 'Link my phone'}
      </button>
    </div>
  );
};
