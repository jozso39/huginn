import { useState } from 'react';
import { api } from '../api';
import type { Connection, ConnectionGroup } from '../api.types';

interface CategoriesManagerProps {
  groups: ConnectionGroup[];
  connections: Connection[];
  onChanged: () => Promise<void>;
}

type Mode =
  { type: 'view' } | { type: 'rename'; id: string; name: string } | { type: 'delete'; id: string };

const countLabel = (count: number) =>
  count === 0 ? 'not used' : count === 1 ? '1 connection' : `${count} connections`;

/** Rename and delete categories, or add one ahead of time. */
export const CategoriesManager = ({ groups, connections, onChanged }: CategoriesManagerProps) => {
  const [mode, setMode] = useState<Mode>({ type: 'view' });
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usage = (id: string) => connections.filter((c) => c.groupId === id).length;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);

    try {
      await action();
      setMode({ type: 'view' });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="categories">
      {groups.length === 0 && (
        <p className="muted">No categories yet. Create one here or while editing a connection.</p>
      )}
      <ul className="categories__list">
        {groups.map((group) => {
          const count = usage(group.id);

          if (mode.type === 'delete' && mode.id === group.id) {
            return (
              <li key={group.id} className="categories__row categories__row--deleting">
                <span>
                  Delete <strong>“{group.name}”</strong>?{' '}
                  {count > 0
                    ? `Its ${countLabel(count)} will have no category; nothing else changes.`
                    : 'No connection uses it.'}
                </span>
                <span className="categories__buttons">
                  <button
                    type="button"
                    className="danger-solid"
                    disabled={busy}
                    onClick={() => void run(() => api.deleteGroup(group.id))}
                  >
                    Yes, delete
                  </button>
                  <button type="button" onClick={() => setMode({ type: 'view' })}>
                    Cancel
                  </button>
                </span>
              </li>
            );
          }

          if (mode.type === 'rename' && mode.id === group.id) {
            return (
              <li key={group.id} className="categories__row">
                <form
                  className="categories__rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(() => api.renameGroup(group.id, mode.name));
                  }}
                >
                  <input
                    autoFocus
                    value={mode.name}
                    maxLength={40}
                    aria-label={`New name for ${group.name}`}
                    onChange={(e) => setMode({ ...mode, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setMode({ type: 'view' });
                      }
                    }}
                  />
                  <button type="submit" className="primary" disabled={busy}>
                    Save
                  </button>
                  <button type="button" onClick={() => setMode({ type: 'view' })}>
                    Cancel
                  </button>
                </form>
              </li>
            );
          }

          return (
            <li key={group.id} className="categories__row">
              <span className="categories__name">{group.name}</span>
              <span className="muted small">{countLabel(count)}</span>
              <span className="categories__buttons">
                <button
                  type="button"
                  onClick={() => setMode({ type: 'rename', id: group.id, name: group.name })}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => setMode({ type: 'delete', id: group.id })}
                >
                  Delete
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <form
        className="categories__add"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api.createGroup(newName);
            setNewName('');
          });
        }}
      >
        <input
          value={newName}
          maxLength={40}
          placeholder="New category"
          aria-label="New category"
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" disabled={busy || newName.trim() === ''}>
          Add
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
};
