import { useState } from 'react';
import type { AiKeyInfo, AiProvider } from '../api.types';

interface AiKeySectionProps {
  ai: AiKeyInfo | null;
  onSave: (provider: AiProvider, key: string) => Promise<void>;
  onRemove: () => Promise<void>;
}

const PROVIDERS: Record<
  AiProvider,
  { keysUrl: string; keysPage: string; placeholder: string; covers: string }
> = {
  OpenRouter: {
    keysUrl: 'https://openrouter.ai/settings/keys',
    keysPage: 'openrouter.ai → Keys',
    placeholder: 'sk-or-v1-…',
    covers: 'sentence rules, and rules learned from your Spam / Important reasons',
  },
  TypeSafe: {
    keysUrl: 'https://console.typesafe.ai',
    keysPage: 'console.typesafe.ai → API Keys',
    placeholder: 'your TypeSafe key',
    covers: 'sentence rules; reasons are kept, but you write those rules yourself',
  },
};

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/**
 * The key triage's models are called with. Write-only: once saved it is never shown
 * again, here or anywhere — it can only be replaced or removed.
 */
export const AiKeySection = ({ ai, onSave, onRemove }: AiKeySectionProps) => {
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [provider, setProvider] = useState<AiProvider>(ai?.provider ?? 'OpenRouter');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showForm = ai === null || replacing;
  const learning = ai?.provider === 'OpenRouter';

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);

    try {
      await action();
      setKey('');
      setReplacing(false);
      setRemoving(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-key">
      <p className="muted small">
        Condition rules sort everything on their own. A sentence rule (“an automated notification,
        not a person”) and turning your Spam / Important reasons into rules need a model, which
        Huginn calls with your own key.
      </p>
      <ul className="ai-key__status">
        <li className="ai-key__on">Condition rules — always on</li>
        <li className={ai ? 'ai-key__on' : 'ai-key__off'}>
          Sentence rules — {ai ? 'on' : 'off: their items wait in Undecided'}
        </li>
        <li className={learning ? 'ai-key__on' : 'ai-key__off'}>
          Learning from your reasons —{' '}
          {learning
            ? 'on'
            : ai
              ? 'needs an OpenRouter key; the item still moves'
              : 'off: Spam / Important still move the item'}
        </li>
      </ul>

      {ai && !replacing && (
        <div className="ai-key__current">
          {removing ? (
            <>
              <span>
                Remove the key? Sentence rules stop, and reasons are no longer turned into rules.
              </span>
              <span className="ai-key__buttons">
                <button
                  type="button"
                  className="danger-solid"
                  disabled={busy}
                  onClick={() => void run(onRemove)}
                >
                  Yes, remove
                </button>
                <button type="button" onClick={() => setRemoving(false)}>
                  Cancel
                </button>
              </span>
            </>
          ) : (
            <>
              <span>
                <strong>{ai.provider}</strong> key ending in <code>…{ai.hint}</code>, added{' '}
                {DATE.format(new Date(ai.savedAt))}
              </span>
              <span className="ai-key__buttons">
                <button type="button" onClick={() => setReplacing(true)}>
                  Replace
                </button>
                <button type="button" className="danger" onClick={() => setRemoving(true)}>
                  Remove
                </button>
              </span>
            </>
          )}
        </div>
      )}

      {showForm && (
        <form
          className="ai-key__form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => onSave(provider, key));
          }}
        >
          <div className="segmented" role="radiogroup" aria-label="Provider">
            {(Object.keys(PROVIDERS) as AiProvider[]).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={provider === option}
                className={provider === option ? 'segmented__on' : undefined}
                onClick={() => setProvider(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <p className="muted small">
            Covers {PROVIDERS[provider].covers}. Get a key at{' '}
            <a href={PROVIDERS[provider].keysUrl} target="_blank" rel="noreferrer">
              {PROVIDERS[provider].keysPage}
            </a>
            .
          </p>
          <label className="field">
            <span className="field__label">{provider} API key</span>
            <input
              type="password"
              value={key}
              placeholder={PROVIDERS[provider].placeholder}
              autoComplete="off"
              spellCheck={false}
              required
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <p className="muted small">
            Huginn checks it with {provider}, then keeps it encrypted on this Mac. It is never shown
            again — not even here.
          </p>
          <div className="form-buttons">
            <button type="submit" className="primary" disabled={busy || key.trim() === ''}>
              {busy ? `Checking with ${provider}…` : 'Check and save'}
            </button>
            {replacing && (
              <button type="button" disabled={busy} onClick={() => setReplacing(false)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
};
