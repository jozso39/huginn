import { useState } from 'react';
import type {
  Connection,
  ConnectionGroup,
  ConnectorDescriptor,
  JsonSchemaProperty,
} from '../api.types';
import { CategoryPicker } from './CategoryPicker';
import { ColorPicker } from './ColorPicker';

export interface ConnectionFormValues {
  name: string;
  groupId: string | null;
  color: string;
  config: Record<string, string>;
  secrets: Record<string, string>;
}

interface ConnectionFormProps {
  descriptor: ConnectorDescriptor;
  /** Present when editing: fields start from its values, secrets start blank. */
  existing?: Connection;
  groups: ConnectionGroup[];
  onCreateGroup: (name: string) => Promise<ConnectionGroup>;
  /** A new connection's colour until the user picks one. */
  defaultColor: string;
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

/** A field tied to another field's choice is shown only with that choice; it keeps its value. */
const applies = (prop: JsonSchemaProperty, config: Record<string, string>): boolean =>
  Object.entries(prop.shownWhen ?? {}).every(([key, value]) => config[key] === value);

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
  groups,
  onCreateGroup,
  defaultColor,
  submitLabel,
  busyLabel,
  onSubmit,
  onCancel,
}: ConnectionFormProps) => {
  const [name, setName] = useState(existing?.name ?? '');
  const [groupId, setGroupId] = useState<string | null>(existing?.groupId ?? null);
  const [color, setColor] = useState(existing?.color ?? defaultColor);
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
      await onSubmit({ name, groupId, color, config, secrets });
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
      <div className="field">
        <span className="field__label">Category</span>
        <CategoryPicker
          groups={groups}
          value={groupId}
          onChange={setGroupId}
          onCreate={onCreateGroup}
        />
        <small className="muted">
          Connections in one category share a section in the inbox. None: a section of its own.
        </small>
      </div>
      <div className="field">
        <span className="field__label">Colour</span>
        <ColorPicker value={color} onChange={setColor} />
      </div>
      {Object.entries(descriptor.configSchema.properties ?? {})
        .filter(([, prop]) => applies(prop, config))
        .map(([key, prop]) => (
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
