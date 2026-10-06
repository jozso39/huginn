import { useEffect, useState } from 'react';

interface ConfirmButtonProps {
  label: string;
  /** Shown on the second step, e.g. "Remove it and its 40 items?". */
  question: string;
  onConfirm: () => void;
}

const DISARM_AFTER_MS = 5_000;

/**
 * A destructive button that asks first, inside the page. The browser's confirm()
 * cannot be used: the Mac app's web view answers it with "no" without showing it.
 */
export const ConfirmButton = ({ label, question, onConfirm }: ConfirmButtonProps) => {
  const [armed, setArmed] = useState(false);

  // Left alone, the question goes away again.
  useEffect(() => {
    if (!armed) {
      return undefined;
    }

    const timer = setTimeout(() => setArmed(false), DISARM_AFTER_MS);

    return () => clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <button type="button" className="danger" onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }

  return (
    <span className="confirm">
      <span className="confirm__question">{question}</span>
      <button
        type="button"
        className="danger-solid"
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        Yes, {label.toLowerCase()}
      </button>
      <button type="button" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
};
