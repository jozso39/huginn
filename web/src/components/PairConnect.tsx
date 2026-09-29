import { useEffect, useState } from 'react';
import { renderSVG } from 'uqr';
import { api } from '../api';
import type { ConnectorKind } from '../api.types';

interface PairConnectProps {
  target: { kind: ConnectorKind } | { connectionId: string };
  onLinked: () => Promise<void>;
}

const POLL_MS = 2_000;

type Stage =
  | { step: 'idle' }
  | { step: 'waiting'; pairingId: string; qr: string }
  | { step: 'failed'; error: string };

/**
 * Linking a phone: show the code as a QR, the phone scans it (Signal → Settings →
 * Linked devices → +), and the connection appears once the phone confirms.
 */
export const PairConnect = ({ target, onLinked }: PairConnectProps) => {
  const [stage, setStage] = useState<Stage>({ step: 'idle' });
  const pairingId = stage.step === 'waiting' ? stage.pairingId : null;

  useEffect(() => {
    if (!pairingId) {
      return undefined;
    }

    const timer = setInterval(() => {
      void api
        .pairingStatus(pairingId)
        .then(async (status) => {
          if (status.state === 'Linked') {
            setStage({ step: 'idle' });
            await onLinked();
          } else if (status.state === 'Failed') {
            setStage({ step: 'failed', error: status.error ?? 'Linking failed' });
          }
        })
        .catch((e: unknown) =>
          setStage({ step: 'failed', error: e instanceof Error ? e.message : String(e) })
        );
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [pairingId, onLinked]);

  const start = async () => {
    try {
      const { pairingId: id, code } = await api.startPairing(target);
      // A data: URL keeps the SVG an image — never markup in the page.
      const qr = `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(code, { border: 2 }))}`;

      setStage({ step: 'waiting', pairingId: id, qr });
    } catch (e) {
      setStage({ step: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  };

  if (stage.step === 'waiting') {
    return (
      <div className="pairing">
        <img className="pairing__qr" src={stage.qr} alt="QR code to link your phone" />
        <ol className="small">
          <li>
            On your phone open <strong>Signal → Settings → Linked devices</strong>.
          </li>
          <li>
            Tap <strong>+</strong> (Link new device) and scan this code.
          </li>
          <li>Keep this page open; the connection appears when the phone confirms.</li>
        </ol>
        <p className="muted small">
          The code works for a few minutes. Anyone who scans it sees your messages — do not share
          it.
        </p>
      </div>
    );
  }

  return (
    <div className="pairing">
      {stage.step === 'failed' && <p className="error">{stage.error}</p>}
      <button type="button" className="primary" onClick={() => void start()}>
        {stage.step === 'failed' ? 'Try again' : 'Link my phone'}
      </button>
    </div>
  );
};
