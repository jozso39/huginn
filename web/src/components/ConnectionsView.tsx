import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Connection, ConnectorDescriptor } from '../api.types';
import { CONNECTOR_META, relativeTime } from '../connectorMeta';
import type { ConnectionFormValues } from './ConnectionForm';
import { ConnectionForm } from './ConnectionForm';

interface ConnectionsViewProps {
  connections: Connection[];
  onChanged: () => Promise<void>;
}

/** Blank optional fields are left out so the server's defaults apply. */
const filledOnly = (values: Record<string, string>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== ''));

/** Add, edit, pause and remove connections. */
export const ConnectionsView = ({ connections, onChanged }: ConnectionsViewProps) => {
  const [kinds, setKinds] = useState<ConnectorDescriptor[]>([]);
  const [newKind, setNewKind] = useState<string>('');
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.listKinds().then((list) => {
      setKinds(list);
      setNewKind((current) => (current !== '' ? current : (list[0]?.kind ?? '')));
    });
  }, []);

  const descriptorOf = (kind: string) => kinds.find((k) => k.kind === kind);
  const newDescriptor = descriptorOf(newKind);

  const create = async (values: ConnectionFormValues) => {
    const name = values.name.trim();

    await api.createConnection({
      kind: newKind,
      name: name !== '' ? name : (newDescriptor?.label ?? newKind),
      config: filledOnly(values.config),
      secrets: values.secrets,
    });
    await onChanged();
  };

  const update = async (connection: Connection, values: ConnectionFormValues) => {
    const name = values.name.trim();

    await api.updateConnection(
      connection.id,
      name !== '' ? name : connection.name,
      filledOnly(values.config)
    );

    const newSecrets = filledOnly(values.secrets);

    if (Object.keys(newSecrets).length > 0) {
      await api.updateSecrets(connection.id, newSecrets);
    }

    setEditing(null);
    await onChanged();
  };

  const act = async (action: () => Promise<unknown>) => {
    setError(null);

    try {
      await action();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="connections">
      <ul className="connection-list">
        {connections.length === 0 && <li className="muted">No connections yet.</li>}
        {connections.map((connection) => {
          const meta = CONNECTOR_META[connection.kind];
          const descriptor = descriptorOf(connection.kind);

          return (
            <li key={connection.id} className="connection">
              <div className="connection__row">
                <span className="badge" style={{ background: meta.color }}>
                  {meta.glyph}
                </span>
                <div className="connection__info">
                  <strong>{connection.name}</strong>
                  <span className={`status status--${connection.status.toLowerCase()}`}>
                    {connection.status}
                  </span>
                  <span className="muted">
                    {connection.lastSyncAt
                      ? `synced ${relativeTime(connection.lastSyncAt)}`
                      : 'never synced'}
                  </span>
                  {connection.statusMessage && (
                    <span className={connection.status === 'Error' ? 'error' : 'warn'}>
                      {connection.statusMessage}
                    </span>
                  )}
                </div>
                <div className="connection__buttons">
                  {descriptor && editing !== connection.id && (
                    <button type="button" onClick={() => setEditing(connection.id)}>
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      void act(() => api.setEnabled(connection.id, !connection.enabled))
                    }
                  >
                    {connection.enabled ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      if (window.confirm(`Remove “${connection.name}” and all its items?`)) {
                        void act(() => api.removeConnection(connection.id));
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
              {descriptor && editing === connection.id && (
                <ConnectionForm
                  descriptor={descriptor}
                  existing={connection}
                  submitLabel="Save"
                  busyLabel="Saving…"
                  onSubmit={(values) => update(connection, values)}
                  onCancel={() => setEditing(null)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="error">{error}</p>}

      <div className="add-connection">
        <h2>Add a connection</h2>
        <label>
          Type
          <select value={newKind} onChange={(e) => setNewKind(e.target.value)}>
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {newDescriptor && (
          // Keyed by kind so switching type starts a fresh form with that type's defaults.
          <ConnectionForm
            key={newDescriptor.kind}
            descriptor={newDescriptor}
            submitLabel="Connect"
            busyLabel="Connecting…"
            onSubmit={create}
          />
        )}
      </div>
    </section>
  );
};
