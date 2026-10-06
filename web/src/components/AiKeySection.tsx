import { useState } from 'react';
import type { AiKeyInfo, AiProvider } from '../api.types';

interface AiKeySectionProps {
  ai: AiKeyInfo | null;
  onSave: (provider: AiProvider, key: string) => Promise<void>;
  onRemove: () => Promise<void>;
}

interface Feature {
  name: string;
  what: string;
  state: 'Always on' | 'On' | 'Off';
  /** Said only while it is off: what is missing, and what happens meanwhile. */
  whenOff: string;
}

const PROVIDERS: Record<
  AiProvider,
  {
    keysUrl: string;
    keysPage: string;
    /** Where on that page, when the link cannot go straight there. */
    keysWhere: string;
    placeholder: string;
    enables: string;
  }
> = {
  OpenRouter: {
    keysUrl: 'https://openrouter.ai/settings/keys',
    keysPage: 'openrouter.ai/settings/keys',
    keysWhere: '',
    placeholder: 'sk-or-v1-…',
    enables: 'An OpenRouter key turns on sentence rules and learning from your reasons.',
  },
  TypeSafe: {
    keysUrl: 'https://console.typesafe.ai',
    keysPage: 'console.typesafe.ai',
    keysWhere: ', under API Keys',
    placeholder: 'your TypeSafe key',
    enables: 'A TypeSafe key turns on sentence rules. Learning from your reasons needs OpenRouter.',
  },
};

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

const featuresFor = (ai: AiKeyInfo | null): Feature[] => [
  {
    name: 'Condition rules',
    what: 'Exact checks, such as who sent it, the channel, or whether it mentions you.',
    state: 'Always on',
    whenOff: '',
  },
  {
    name: 'Sentence rules',
    what: 'A description in your own words, like “an automated notification, not a person”. AI judges whether a message fits it.',
    state: ai ? 'On' : 'Off',
    whenOff:
      'Needs an AI key. Until then, messages only these rules would catch stay in Undecided.',
  },
  {
    name: 'Learning from your reasons',
    what: 'When you move a message to Spam or Important and say why, Huginn adjusts the rules so similar messages land there too.',
    state: ai?.provider === 'OpenRouter' ? 'On' : 'Off',
    whenOff: ai
      ? 'Needs an OpenRouter key: TypeSafe only judges sentence rules. The message still moves.'
      : 'Needs an OpenRouter key. The message still moves.',
  },
];

/**
 * What triage is, what of it runs right now, and the key its AI parts are called with.
 * The key is write-only: once saved it is never shown again, here or anywhere — it can
 * only be replaced or removed.
 */
export const AiKeySection = ({ ai, onSave, onRemove }: AiKeySectionProps) => {
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [provider, setProvider] = useState<AiProvider>(ai?.provider ?? 'OpenRouter');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showForm = ai === null || replacing;

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
    <div className="triage">
      <div className="triage__intro">
        <p>Huginn sorts every new message into one of these categories:</p>
        <ul>
          <li>Important</li>
          <li>Undecided</li>
          <li>Spam</li>
        </ul>
        <p>
          Important comes first and can notify you, Spam stays out of your inbox, and Undecided
          waits for you to sort it.
        </p>
        <p>
          When sorting a message, you can input a rule for sorting that will afterwards be applied
          to other messages in the same connection.
        </p>
        <p>Example:</p>
        <ol>
          <li>you get a message in Slack: “Anyone wants to go for lunch?”</li>
          <li>
            you can click Spam and write “I am working remotely, lunch invitations don’t apply for
            me in channel #lunch”
          </li>
          <li>Huginn will mark any other message like that as Spam</li>
        </ol>
      </div>

      {/* Statuses, not settings: pills on the right, so nothing here looks clickable. */}
      <ul className="triage-features">
        {featuresFor(ai).map((feature) => (
          <li key={feature.name}>
            <div className="triage-features__text">
              <strong>{feature.name}</strong>
              <span className="triage-features__what">{feature.what}</span>
              {feature.state === 'Off' && (
                <span className="triage-features__off">{feature.whenOff}</span>
              )}
            </div>
            <span
              className={`status-pill status-pill--${feature.state === 'Off' ? 'Neutral' : 'Success'}`}
            >
              {feature.state}
            </span>
          </li>
        ))}
      </ul>

      <div className="ai-key">
        <h3>AI key</h3>

        {ai && !replacing && (
          <>
            <div className="ai-key__current">
              {removing ? (
                <>
                  <span>
                    Remove the key? Sentence rules turn off, and Huginn stops learning from your
                    reasons.
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
            <p className="muted small">The key cannot be shown again, only replaced or removed.</p>
            {error && <p className="error">{error}</p>}
          </>
        )}

        {showForm && (
          <form
            className="ai-key__form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => onSave(provider, key));
            }}
          >
            <p className="muted small">
              Sentence rules and learning use an AI service, paid with your own key. Pick the
              service your key is from:
            </p>
            <div className="tabbed">
              <div className="tabs" role="tablist" aria-label="AI service">
                {(Object.keys(PROVIDERS) as AiProvider[]).map((option) => (
                  <button
                    key={option}
                    id={`ai-key-tab-${option}`}
                    type="button"
                    role="tab"
                    aria-selected={provider === option}
                    aria-controls="ai-key-panel"
                    onClick={() => setProvider(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div
                id="ai-key-panel"
                className="tab-panel"
                role="tabpanel"
                aria-labelledby={`ai-key-tab-${provider}`}
              >
                {/* Keyed by provider: it fades in afresh, so the change is seen. */}
                <div key={provider} className="tab-panel__body">
                  <p>
                    {PROVIDERS[provider].enables} Get one at{' '}
                    <a href={PROVIDERS[provider].keysUrl} target="_blank" rel="noreferrer">
                      {PROVIDERS[provider].keysPage}
                    </a>
                    {PROVIDERS[provider].keysWhere}.
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
                    Huginn checks the key with {provider}, then stores it encrypted on this Mac.
                    After that nobody can see it, not even here: it can only be replaced or removed.
                  </p>
                  <div className="form-buttons">
                    <button type="submit" className="primary" disabled={busy || key.trim() === ''}>
                      {busy ? `Checking with ${provider}…` : 'Check and save'}
                    </button>
                    {replacing && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setReplacing(false);
                          setKey('');
                          setError(null);
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                  {error && <p className="error">{error}</p>}
                </div>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
