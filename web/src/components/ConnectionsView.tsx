import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Connection, ConnectorDescriptor } from '../api.types';
import { CONNECTOR_META, relativeTime } from '../connectorMeta';

interface ConnectionsViewProps {
  connections: Connection[];
  onChanged: () => Promise<void>;
}

const emptyValues = (descriptor: ConnectorDescriptor | undefined) =>
  Object.fromEntries(Object.keys(descriptor?.configSchema.properties ?? {}).map((k) => [k, '']));

/**
 * Add, pause and remove connections. The form is generated from each connector's
 * config schema and secret fields, so a new connector needs no UI work.
 */
export const ConnectionsView = ({ connections, onChanged }: ConnectionsViewProps) => {
  const [kinds, setKinds] = useState<ConnectorDescriptor[]>([]);
  const [kind, setKind] = useState<string>('');
  const [name, setName] = useState('');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.listKinds().then((list) => {
      setKinds(list);
      setKind((current) => (current !== '' ? current : (list[0]?.kind ?? '')));
    });
  }, []);

  const descriptor = kinds.find((k) => k.kind === kind);

  const chooseKind = (next: string) => {
    setKind(next);
    setConfig(emptyValues(kinds.find((k) => k.kind === next)));
    setSecrets({});
  };

  const submit = async () => {
    setBusy(true);
    setError(null);

    try {
      const trimmed = name.trim();

      await api.createConnection({
        kind,
        name: trimmed !== '' ? trimmed : (descriptor?.label ?? kind),
        // Blank optional fields are omitted so the server's defaults apply.
        config: Object.fromEntries(Object.entries(config).filter(([, value]) => value !== '')),
        secrets,
      });
      setName('');
      setConfig(emptyValues(descriptor));
      setSecrets({});
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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

          return (
            <li key={connection.id} className="connection">
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
                  <span className="error">{connection.statusMessage}</span>
                )}
              </div>
              <div className="connection__buttons">
                <button
                  type="button"
                  onClick={() => void act(() => api.setEnabled(connection.id, !connection.enabled))}
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
            </li>
          );
        })}
      </ul>

      <form
        className="add-connection"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>Add a connection</h2>
        <label>
          Type
          <select value={kind} onChange={(e) => chooseKind(e.target.value)}>
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input
            value={name}
            placeholder={descriptor ? `Work ${descriptor.label}` : ''}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {Object.entries(descriptor?.configSchema.properties ?? {}).map(([key, prop]) => (
          <label key={key}>
            {prop.title ?? key}
            <input
              value={config[key] ?? ''}
              placeholder={prop.description ?? ''}
              type={prop.format === 'uri' ? 'url' : 'text'}
              required={descriptor?.configSchema.required?.includes(key)}
              onChange={(e) => setConfig((c) => ({ ...c, [key]: e.target.value }))}
            />
          </label>
        ))}
        {descriptor?.secretFields.map((field) => (
          <label key={field.key}>
            {field.label}
            <input
              type="password"
              autoComplete="off"
              value={secrets[field.key] ?? ''}
              required
              onChange={(e) => setSecrets((s) => ({ ...s, [field.key]: e.target.value }))}
            />
            {field.hint && <small className="muted">{field.hint}</small>}
          </label>
        ))}
        <p className="muted small">
          Tokens are encrypted before they are stored and never sent back to the browser.
        </p>
        <button type="submit" className="primary" disabled={busy || !kind}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </section>
  );
};
