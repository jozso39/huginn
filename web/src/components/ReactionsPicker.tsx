import { useState } from 'react';

interface ReactionsPickerProps {
  selected: string[];
  onChange: (emoji: string[]) => Promise<void>;
}

/** Mirrors MAX_QUICK_REACTIONS on the server: one row under every message. */
const MAX = 8;
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
// Whole emoji (flags, skin tones, 🧑‍💻) need the v flag; older WebKit falls back to
// pictographs, and the server checks again either way.
const IS_EMOJI = (() => {
  try {
    return new RegExp('^\\p{RGI_Emoji}$', 'v');
  } catch {
    return /^\p{Extended_Pictographic}/u;
  }
})();
// Between emoji: fine, and ignored.
const SEPARATOR = /^[\s,]+$/u;

/** "❤" and "❤️" are one emoji. */
const keyOf = (emoji: string) => emoji.replace(/[︎️]/g, '');

/** The field read as emoji, and everything wrong with it. */
const read = (text: string): { emoji: string[]; problems: string[] } => {
  const pieces = [...SEGMENTER.segment(text)]
    .map((part) => part.segment)
    .filter((piece) => !SEPARATOR.test(piece));
  const emoji = pieces.filter((piece) => IS_EMOJI.test(piece));
  const rejected = pieces.filter((piece) => !IS_EMOJI.test(piece));
  const repeated = emoji.filter(
    (one, index) => emoji.findIndex((other) => keyOf(other) === keyOf(one)) !== index
  );

  return {
    emoji,
    problems: [
      ...(rejected.length > 0
        ? [`Not emoji: ${rejected.map((piece) => `“${piece}”`).join(' ')}`]
        : []),
      ...(repeated.length > 0 ? [`More than once: ${[...new Set(repeated)].join(' ')}`] : []),
      ...(emoji.length === 0 ? ['Type at least one emoji.'] : []),
      ...(emoji.length > MAX ? [`At most ${MAX}; this is ${emoji.length}.`] : []),
    ],
  };
};

/** The emoji under every message, typed or pasted like text and checked before saving. */
export const ReactionsPicker = ({ selected, onChange }: ReactionsPickerProps) => {
  const [saved, setSaved] = useState(selected);
  const [text, setText] = useState(selected.join(' '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { emoji, problems } = read(text);
  const changed = emoji.map(keyOf).join() !== saved.map(keyOf).join();

  const save = async () => {
    setBusy(true);
    setError(null);

    try {
      await onChange(emoji);
      setSaved(emoji);
      setText(emoji.join(' '));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="reactions"
      onSubmit={(e) => {
        e.preventDefault();

        if (changed && problems.length === 0) {
          void save();
        }
      }}
    >
      <div className="reactions__field">
        <input
          value={text}
          placeholder="👍 ✅ 👀"
          aria-label="Quick reactions"
          aria-invalid={problems.length > 0}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        <button
          type="submit"
          className="primary"
          disabled={busy || !changed || problems.length > 0}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {changed && (
          <button type="button" disabled={busy} onClick={() => setText(saved.join(' '))}>
            Undo
          </button>
        )}
      </div>
      <p className="muted small">
        Type or paste emoji in the order you want them under every message, up to {MAX}.
        Control-⌘-Space opens the Mac&apos;s emoji picker.
      </p>
      {problems.length > 0 ? (
        <ul className="reactions__problems error small">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : (
        <p className="reactions__preview" aria-label="How they will look">
          {emoji.map((one) => (
            <span key={keyOf(one)}>{one}</span>
          ))}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </form>
  );
};
