import type { KeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ConnectionGroup } from '../api.types';

interface CategoryPickerProps {
  groups: ConnectionGroup[];
  value: string | null;
  onChange: (groupId: string | null) => void;
  /** Makes a category with this name (or finds the one that has it) and returns it. */
  onCreate: (name: string) => Promise<ConnectionGroup>;
}

type Option = { type: 'group'; group: ConnectionGroup } | { type: 'create'; name: string };

/** Typing "prace" finds "Práce". */
const fold = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .trim();

const Chevron = ({ up }: { up: boolean }) => (
  <svg className="picker__chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden>
    <path
      d={up ? 'M3.5 10 8 5.5 12.5 10' : 'M3.5 6 8 10.5 12.5 6'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * Choose a category, or type to filter and create one on the spot. Categories are
 * kept on their own, so a new one is offered for every connection from then on.
 */
export const CategoryPicker = ({ groups, value, onChange, onCreate }: CategoryPickerProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = groups.find((group) => group.id === value) ?? null;
  const typed = query.trim().replace(/\s+/g, ' ');
  // The server treats names that differ only in case as the same category.
  const taken = groups.some((group) => group.name.toLowerCase() === typed.toLowerCase());
  const options: Option[] = [
    ...groups
      .filter((group) => fold(group.name).includes(fold(typed)))
      .map((group): Option => ({ type: 'group', group })),
    ...(typed !== '' && !taken ? [{ type: 'create', name: typed } as const] : []),
  ];
  const current = Math.min(active, Math.max(options.length - 1, 0));

  const close = () => {
    setOpen(false);
    setQuery('');
    setActive(0);
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        close();
      }
    };

    document.addEventListener('mousedown', onPointer);

    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  useEffect(() => {
    listRef.current?.children[current]?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const choose = async (option: Option) => {
    setError(null);

    if (option.type === 'group') {
      onChange(option.group.id);
      close();
      inputRef.current?.blur();

      return;
    }

    setBusy(true);

    try {
      const group = await onCreate(option.name);

      onChange(group.id);
      close();
      inputRef.current?.blur();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const option = options[current];

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive(Math.min(current + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (event.key === 'Enter' && open && option) {
      // Picks the highlighted line instead of submitting the form around it.
      event.preventDefault();
      void choose(option);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      close();
    }
  };

  return (
    <div className="picker" ref={rootRef}>
      <div
        className={open ? 'picker__field picker__field--open' : 'picker__field'}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options.length > 0 ? `${listId}-${current}` : undefined}
          value={open ? query : (selected?.name ?? '')}
          placeholder={open && selected ? selected.name : 'Choose or create a category'}
          disabled={busy}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {selected && !open && (
          <button
            type="button"
            className="picker__clear"
            title="No category"
            aria-label="No category"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
          >
            ×
          </button>
        )}
        <Chevron up={open} />
      </div>
      {open && (
        <div className="picker__menu">
          <ul id={listId} ref={listRef} role="listbox" className="picker__options">
            {options.length === 0 && (
              <li className="picker__empty">No categories yet. Type a name to create one.</li>
            )}
            {options.map((option, index) => (
              <li
                key={option.type === 'group' ? option.group.id : 'create'}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.type === 'group' && option.group.id === value}
                className={
                  index === current ? 'picker__option picker__option--active' : 'picker__option'
                }
                // Keeps the focus in the input, so the menu does not close first.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => void choose(option)}
              >
                {option.type === 'group' ? (
                  <>
                    <span>{option.group.name}</span>
                    {option.group.id === value && <span className="picker__check">✓</span>}
                  </>
                ) : (
                  <span>
                    Create category <strong>“{option.name}”</strong>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <a
            className="picker__manage"
            href="#settings/categories"
            onMouseDown={(e) => e.preventDefault()}
            onClick={close}
          >
            <span aria-hidden>⚙</span> Manage categories
          </a>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
};
