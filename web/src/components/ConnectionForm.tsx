import { useState } from 'react';
import type { Connection, ConnectorDescriptor, JsonSchemaProperty } from '../api.types';

export interface ConnectionFormValues {
  name: string;
  config: Record<string, string>;
  secrets: Record<string, string>;
}

interface ConnectionFormProps {
  descriptor: ConnectorDescriptor;
  /** Present when editing: fields start from its values, secrets start blank. */
  existing?: Connection;
  submitLabel: string;
  busyLabel: string;
  onSubmit: (values: ConnectionFormValues) => Promise<void>;
  onCancel?: () => void;
}

const asText = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

const initialConfig = (descriptor: ConnectorDescriptor, existing?: Connection) =>
  Object.fromEntries(
    Object.entries(descriptor.configSchema.properties ?? {}).map(([key, prop]) => [
      key,
      asText(existing ? existing.config[key] : prop.default),
    ])
  );

const ConfigField = ({
  prop,
  value,
  required,
  onChange,
}: {
  prop: JsonSchemaProperty;
  value: string;
  required: boolean;
  onChange: (value: string) => void;
}) => {
  if (prop.enum) {
    return (
      <select value={value} required={required} onChange={(e) => onChange(e.target.value)}>
        {prop.enum.map((option) => (
          <option key={option} value={option}>
            {prop.optionLabels?.[option] ?? option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      value={value}
      placeholder={required ? '' : 'optional'}
      type={prop.format === 'uri' ? 'url' : 'text'}
      required={required}
      onChange={(e) => onChange(e.target.value)}
    />
  );
};

/**
 * The add/edit form for one connection, generated from the connector's config schema
 * and secret fields — a new connector needs no UI work. When editing, secret fields
 * start empty and an empty one keeps the stored token.
 */
export const ConnectionForm = ({
  descriptor,
  existing,
  submitLabel,
  busyLabel,
  onSubmit,
  onCancel,
}: ConnectionFormProps) => {
  const [name, setName] = useState(existing?.name ?? '');
  const [config, setConfig] = useState<Record<string, string>>(() =>
    initialConfig(descriptor, existing)
  );
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const required = new Set(descriptor.configSchema.required ?? []);

  const submit = async () => {
    setBusy(true);
    setError(null);

    try {
      await onSubmit({ name, config, secrets });
      setSecrets({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="connection-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label>
        Name
        <input
          value={name}
          placeholder={`Work ${descriptor.label}`}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {Object.entries(descriptor.configSchema.properties ?? {}).map(([key, prop]) => (
        <label key={key}>
          {prop.title ?? key}
          <ConfigField
            prop={prop}
            value={config[key] ?? ''}
            required={required.has(key)}
            onChange={(value) => setConfig((c) => ({ ...c, [key]: value }))}
          />
          {prop.description && <small className="muted">{prop.description}</small>}
        </label>
      ))}
      {descriptor.secretFields.map((field) => (
        <label key={field.key}>
          {field.label}
          <input
            type="password"
            autoComplete="off"
            value={secrets[field.key] ?? ''}
            placeholder={existing ? 'unchanged — paste to replace' : ''}
            required={!existing}
            onChange={(e) => setSecrets((s) => ({ ...s, [field.key]: e.target.value }))}
          />
          {field.hint && <small className="muted">{field.hint}</small>}
        </label>
      ))}
      <p className="muted small">
        Tokens are encrypted before they are stored and never sent back to the browser.
      </p>
      <div className="form-buttons">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? busyLabel : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
};
