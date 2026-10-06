import { useCallback, useState } from 'react';
import { api } from '../api';
import type { Connection, ConnectionGroup, ConnectorDescriptor } from '../api.types';
import { nextConnectionColor, tint } from '../colors';
import { relativeTime } from '../connectorMeta';
import type { ConnectionFormValues } from './ConnectionForm';
import { ConnectionForm } from './ConnectionForm';
import { SignInConnect, startSignIn } from './SignInConnect';
import { ConnectorIcon } from './ConnectorIcon';
import { PairConnect } from './PairConnect';

interface ConnectionsViewProps {
  connections: Connection[];
  kinds: ConnectorDescriptor[];
  groups: ConnectionGroup[];
  onChanged: () => Promise<void>;
  onCreateGroup: (name: string) => Promise<ConnectionGroup>;
}

interface Section {
  key: string;
  name: string;
  connections: Connection[];
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

const byName = (a: Connection, b: Connection) => a.name.localeCompare(b.name);

/** One section per category in use (alphabetical, like the categories), the rest last. */
const sectionsOf = (connections: Connection[], groups: ConnectionGroup[]): Section[] => {
  const known = new Set(groups.map((group) => group.id));

  return [
    ...groups.map((group) => ({
      key: group.id,
      name: group.name,
      connections: connections.filter((c) => c.groupId === group.id).sort(byName),
    })),
    {
      key: 'none',
      name: 'No category',
      connections: connections.filter((c) => !c.groupId || !known.has(c.groupId)).sort(byName),
    },
  ].filter((section) => section.connections.length > 0);
};

/** Add, edit, pause and remove connections, shown by category. */
export const ConnectionsView = ({
  connections,
  kinds,
  groups,
  onChanged,
  onCreateGroup,
}: ConnectionsViewProps) => {
  const [adding, setAdding] = useState(false);
  const [chosenKind, setChosenKind] = useState<string>('');
  const [editing, setEditing] = useState<string | null>(null);
  // The connection whose card asks "really delete?" instead of showing itself.
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A connection that was just signed in or linked: its card says so.
  const [welcome, setWelcome] = useState<{ connectionId: string; text: string } | null>(null);
  const welcomeId = welcome?.connectionId ?? null;
  // Brings that card into view as soon as it is in the list (once per welcome).
  const showWelcome = useCallback(
    (card: HTMLLIElement | null) => {
      if (card && welcomeId) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
    [welcomeId]
  );

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
      groupId: values.groupId,
      color: values.color,
      config: filledOnly(values.config),
      secrets: values.secrets,
    });
    setAdding(false);
    setChosenKind('');
    await onChanged();
  };

  // Signed in (in the browser) or linked (on the phone): a new connection's settings open
  // at once, since its category and colour are what is left to choose.
  const connected = useCallback(
    async (connection: Connection, created: boolean) => {
      setAdding(false);
      setChosenKind('');
      setEditing(created ? connection.id : null);
      setWelcome({
        connectionId: connection.id,
        text: created
          ? `${connection.name} is connected. Choose its category and colour below, then Save.`
          : `${connection.name} was already connected; its sign-in is renewed.`,
      });
      await onChanged();
    },
    [onChanged]
  );

  const update = async (connection: Connection, values: ConnectionFormValues) => {
    const name = values.name.trim();

    await api.updateConnection(connection.id, {
      name: name !== '' ? name : connection.name,
      groupId: values.groupId,
      color: values.color,
      config: filledOnly(values.config),
    });

    const newSecrets = filledOnly(values.secrets);

    if (Object.keys(newSecrets).length > 0) {
      await api.updateSecrets(connection.id, newSecrets);
    }

    setEditing(null);
    setWelcome(null);
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

  const card = (connection: Connection) => {
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
      <li
        key={connection.id}
        ref={welcomeId === connection.id ? showWelcome : undefined}
        className="connection"
        style={tint(connection.color)}
      >
        <div className="connection__row">
          <ConnectorIcon kind={connection.kind} />
          <div className="connection__info">
            <strong>{connection.name}</strong>
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
              onClick={() => void act(() => api.setEnabled(connection.id, !connection.enabled))}
            >
              {connection.enabled ? 'Pause' : 'Resume'}
            </button>
            <button type="button" className="danger" onClick={() => setDeleting(connection.id)}>
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
          <PairConnect target={{ connectionId: connection.id }} onLinked={() => onChanged()} />
        )}
        {welcome?.connectionId === connection.id && (
          <p className="notice notice--success small">{welcome.text}</p>
        )}
        {descriptor && editing === connection.id && (
          <ConnectionForm
            descriptor={descriptor}
            existing={connection}
            groups={groups}
            onCreateGroup={onCreateGroup}
            defaultColor={connection.color}
            submitLabel="Save"
            busyLabel="Saving…"
            onSubmit={(values) => update(connection, values)}
            onCancel={() => {
              setEditing(null);
              setWelcome(null);
            }}
          />
        )}
      </li>
    );
  };

  return (
    <div className="connections">
      {connections.length === 0 && <p className="muted">No connections yet.</p>}
      {sectionsOf(connections, groups).map((section) => (
        <section key={section.key} className="connection-group">
          <h3 className="connection-group__name">
            {section.name}
            <span className="muted"> · {section.connections.length}</span>
          </h3>
          <ul className="connection-list">{section.connections.map(card)}</ul>
        </section>
      ))}
      {error && <p className="error">{error}</p>}

      {!adding ? (
        <button
          type="button"
          className="add-button"
          onClick={() => {
            setAdding(true);
            setWelcome(null);
          }}
        >
          <span aria-hidden>＋</span> Add connection
        </button>
      ) : (
        <div className="add-connection">
          <div className="add-connection__head">
            <h3>New connection</h3>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setChosenKind('');
              }}
            >
              Cancel
            </button>
          </div>
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
              onConnected={connected}
            />
          )}
          {newDescriptor?.pairing && (
            <PairConnect
              key={newDescriptor.kind}
              target={{ kind: newDescriptor.kind }}
              onLinked={connected}
            />
          )}
          {(newDescriptor?.signInProvider ?? newDescriptor?.pairing) && (
            <p className="muted small">
              Once it is connected, its settings open here for the category and colour.
            </p>
          )}
          {newDescriptor && !newDescriptor.signInProvider && !newDescriptor.pairing && (
            // Keyed by kind so switching type starts a fresh form with that type's defaults.
            <ConnectionForm
              key={newDescriptor.kind}
              descriptor={newDescriptor}
              groups={groups}
              onCreateGroup={onCreateGroup}
              defaultColor={nextConnectionColor(connections.map((c) => c.color))}
              submitLabel="Connect"
              busyLabel="Connecting…"
              onSubmit={create}
            />
          )}
        </div>
      )}
    </div>
  );
};
