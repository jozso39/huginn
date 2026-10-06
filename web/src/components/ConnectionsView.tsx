import { useState } from 'react';
import { api } from '../api';
import type { Connection, ConnectorDescriptor } from '../api.types';
import { relativeTime } from '../connectorMeta';
import type { ConnectionFormValues } from './ConnectionForm';
import { ConnectionForm } from './ConnectionForm';
import { SignInConnect, startSignIn } from './SignInConnect';
import { ConnectorIcon } from './ConnectorIcon';
import { PairConnect } from './PairConnect';

interface ConnectionsViewProps {
  connections: Connection[];
  kinds: ConnectorDescriptor[];
  onChanged: () => Promise<void>;
}

const STATUS_LABEL: Record<Connection['status'], string> = {
  Idle: 'Starting',
  Running: 'Running',
  NeedsAuth: 'Needs sign-in',
  Error: 'Error',
  Disabled: 'Paused',
};

/** Blank optional fields are left out so the server's defaults apply. */
const filledOnly = (values: Record<string, string>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== ''));

/** Add, edit, pause and remove connections. */
export const ConnectionsView = ({ connections, kinds, onChanged }: ConnectionsViewProps) => {
  const [chosenKind, setChosenKind] = useState<string>('');
  const [editing, setEditing] = useState<string | null>(null);
  // The connection whose card asks "really delete?" instead of showing itself.
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const descriptorOf = (kind: string) => kinds.find((k) => k.kind === kind);
  // Kinds this Mac cannot run (Signal without signal-cli) are not offered at all.
  const addable = kinds.filter((k) => k.unavailable === null);
  const newKind = chosenKind !== '' ? chosenKind : (addable[0]?.kind ?? '');
  const newDescriptor = descriptorOf(newKind);

  const create = async (values: ConnectionFormValues) => {
    const name = values.name.trim();

    await api.createConnection({
      kind: newKind,
      name: name !== '' ? name : (newDescriptor?.label ?? newKind),
      groupName: values.groupName.trim() === '' ? null : values.groupName.trim(),
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
      filledOnly(values.config),
      values.groupName.trim() === '' ? null : values.groupName.trim()
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
          const descriptor = descriptorOf(connection.kind);

          if (deleting === connection.id) {
            return (
              <li key={connection.id} className="connection connection--deleting">
                <p className="delete-confirm__question">
                  Do you really want to permanently delete the <strong>“{connection.name}”</strong>{' '}
                  connection? Its items and rules are deleted with it.
                </p>
                <div className="delete-confirm__buttons">
                  <button
                    type="button"
                    className="danger-solid"
                    onClick={() => {
                      setDeleting(null);
                      void act(() => api.removeConnection(connection.id));
                    }}
                  >
                    Yes, delete
                  </button>
                  <button type="button" onClick={() => setDeleting(null)}>
                    Cancel
                  </button>
                </div>
              </li>
            );
          }

          return (
            <li key={connection.id} className="connection">
              <div className="connection__row">
                <ConnectorIcon kind={connection.kind} />
                <div className="connection__info">
                  <strong>{connection.name}</strong>
                  {connection.groupName && (
                    <span className="muted small">in {connection.groupName}</span>
                  )}
                  <span className={`status status--${connection.status.toLowerCase()}`}>
                    {STATUS_LABEL[connection.status]}
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
                  <a className="button" href={`#rules/${connection.id}`}>
                    Rules
                  </a>
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
                    onClick={() => setDeleting(connection.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {descriptor?.signInProvider && connection.status === 'NeedsAuth' && (
                <div className="sign-in">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void startSignIn({ connectionId: connection.id }, setError)}
                  >
                    Sign in with {descriptor.signInProvider}
                  </button>
                </div>
              )}
              {descriptor?.pairing && connection.status === 'NeedsAuth' && (
                <PairConnect target={{ connectionId: connection.id }} onLinked={onChanged} />
              )}
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
          <select value={newKind} onChange={(e) => setChosenKind(e.target.value)}>
            {addable.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {newDescriptor?.signInProvider && (
          <SignInConnect
            key={newDescriptor.kind}
            descriptor={{ ...newDescriptor, signInProvider: newDescriptor.signInProvider }}
          />
        )}
        {newDescriptor?.pairing && (
          <PairConnect
            key={newDescriptor.kind}
            target={{ kind: newDescriptor.kind }}
            onLinked={onChanged}
          />
        )}
        {newDescriptor && !newDescriptor.signInProvider && !newDescriptor.pairing && (
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
