import { useState } from 'react';
import { api } from '../api';
import type {
  Condition,
  ConditionOp,
  DryRunResult,
  FieldInfo,
  Predicate,
  Rule,
  RuleDraft,
  RuleKind,
  Verdict,
} from '../api.types';
import { CONDITION_OPS } from '../api.types';

interface RuleEditorProps {
  connectionId: string;
  fields: FieldInfo[];
  initial?: Rule;
  onSaved: (rule: Rule) => void;
  onCancel: () => void;
}

interface Row {
  field: string;
  op: ConditionOp;
  value: string;
}

type Mode = 'all' | 'any';

const NO_VALUE: ConditionOp[] = ['IsTrue', 'IsFalse', 'Exists'];

const OP_LABEL: Record<ConditionOp, string> = {
  Equals: 'is',
  NotEquals: 'is not',
  Contains: 'contains',
  NotContains: 'does not contain',
  StartsWith: 'starts with',
  EndsWith: 'ends with',
  Matches: 'matches regex',
  In: 'is one of (comma-separated)',
  IsTrue: 'is true',
  IsFalse: 'is false',
  Exists: 'is set',
  GreaterThan: 'is greater than',
  LessThan: 'is less than',
};

const isCondition = (p: Predicate): p is Condition => 'field' in p;

const valueText = (value: Condition['value']): string =>
  Array.isArray(value) ? value.join(', ') : value === undefined ? '' : String(value);

/** A flat all/any of conditions fits the builder; anything deeper is edited as JSON. */
const toRows = (predicate: Predicate | null | undefined): { mode: Mode; rows: Row[] } | null => {
  if (!predicate) {
    return { mode: 'all', rows: [{ field: '', op: 'Equals', value: '' }] };
  }

  const toRow = (c: Condition): Row => ({ field: c.field, op: c.op, value: valueText(c.value) });

  if (isCondition(predicate)) {
    return { mode: 'all', rows: [toRow(predicate)] };
  }

  const list = 'all' in predicate ? predicate.all : 'any' in predicate ? predicate.any : null;

  return list?.every(isCondition)
    ? { mode: 'all' in predicate ? 'all' : 'any', rows: list.map(toRow) }
    : null;
};

const toCondition = (row: Row): Condition => {
  if (NO_VALUE.includes(row.op)) {
    return { field: row.field.trim(), op: row.op };
  }

  if (row.op === 'In') {
    return {
      field: row.field.trim(),
      op: row.op,
      value: row.value
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v !== ''),
    };
  }

  if (row.op === 'GreaterThan' || row.op === 'LessThan') {
    return { field: row.field.trim(), op: row.op, value: Number(row.value) };
  }

  return { field: row.field.trim(), op: row.op, value: row.value };
};

const toPredicate = (mode: Mode, rows: Row[]): Predicate => {
  const conditions = rows.filter((r) => r.field.trim() !== '').map(toCondition);

  return conditions.length === 1 && conditions[0]
    ? conditions[0]
    : mode === 'all'
      ? { all: conditions }
      : { any: conditions };
};

/** Add or edit one rule, and try it on recent items before it goes live. */
export const RuleEditor = ({
  connectionId,
  fields,
  initial,
  onSaved,
  onCancel,
}: RuleEditorProps) => {
  const parsed = toRows(initial?.predicate);
  const [name, setName] = useState(initial?.name ?? '');
  const [verdict, setVerdict] = useState<Verdict>(initial?.verdict ?? 'Spam');
  const [kind, setKind] = useState<RuleKind>(initial?.kind ?? 'Hard');
  const [mode, setMode] = useState<Mode>(parsed?.mode ?? 'all');
  const [rows, setRows] = useState<Row[]>(parsed?.rows ?? []);
  const [json, setJson] = useState(parsed ? '' : JSON.stringify(initial?.predicate, null, 2));
  const [asJson, setAsJson] = useState(parsed === null);
  const [criterion, setCriterion] = useState(initial?.criterion ?? '');
  const [threshold, setThreshold] = useState(initial?.threshold ?? 0.7);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = (): RuleDraft => {
    if (kind === 'Soft') {
      return { name: name.trim(), verdict, kind, criterion: criterion.trim(), threshold };
    }

    return {
      name: name.trim(),
      verdict,
      kind,
      predicate: asJson ? (JSON.parse(json) as Predicate) : toPredicate(mode, rows),
    };
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);

    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setRow = (index: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <form
      className="rule-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () =>
          onSaved(
            initial
              ? await api.updateRule(initial.id, draft())
              : await api.createRule(connectionId, draft())
          )
        );
      }}
    >
      <div className="rule-editor__line">
        <label>
          Name
          <input value={name} required onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Puts it in
          <select value={verdict} onChange={(e) => setVerdict(e.target.value as Verdict)}>
            <option value="Important">Important</option>
            <option value="Spam">Spam</option>
          </select>
        </label>
        <label>
          Decided by
          <select value={kind} onChange={(e) => setKind(e.target.value as RuleKind)}>
            <option value="Hard">Conditions (exact)</option>
            <option value="Soft">A sentence (judged by Jev)</option>
          </select>
        </label>
      </div>

      {kind === 'Soft' && (
        <>
          <label>
            When this is true
            <textarea
              rows={2}
              value={criterion}
              required
              placeholder="This email is an automated notification that needs no reply."
              onChange={(e) => setCriterion(e.target.value)}
            />
            <small className="muted">
              One yes/no statement about the message; “yes” means it goes to {verdict}.
            </small>
          </label>
          <label>
            Fires at probability ≥ {threshold.toFixed(2)}
            <input
              type="range"
              min={0.5}
              max={0.99}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </label>
        </>
      )}

      {kind === 'Hard' && !asJson && (
        <div className="conditions">
          <p className="small">
            When{' '}
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="all">all</option>
              <option value="any">any</option>
            </select>{' '}
            of these hold:
          </p>
          <datalist id={`fields-${connectionId}`}>
            {fields.map((f) => (
              <option key={f.field} value={f.field} />
            ))}
          </datalist>
          {rows.map((row, index) => {
            const samples = fields.find((f) => f.field === row.field)?.samples ?? [];

            return (
              <div key={index} className="condition">
                <input
                  list={`fields-${connectionId}`}
                  value={row.field}
                  placeholder="field"
                  aria-label="Field"
                  onChange={(e) => setRow(index, { field: e.target.value })}
                />
                <select
                  value={row.op}
                  aria-label="Comparison"
                  onChange={(e) => setRow(index, { op: e.target.value as ConditionOp })}
                >
                  {CONDITION_OPS.map((op) => (
                    <option key={op} value={op}>
                      {OP_LABEL[op]}
                    </option>
                  ))}
                </select>
                {!NO_VALUE.includes(row.op) && (
                  <input
                    value={row.value}
                    placeholder={samples[0] ?? 'value'}
                    aria-label="Value"
                    onChange={(e) => setRow(index, { value: e.target.value })}
                  />
                )}
                <button
                  type="button"
                  aria-label="Remove condition"
                  onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                >
                  ×
                </button>
                {samples.length > 0 && (
                  <small className="muted condition__samples">seen: {samples.join(' · ')}</small>
                )}
              </div>
            );
          })}
          <div className="form-buttons">
            <button
              type="button"
              onClick={() =>
                setRows((current) => [...current, { field: '', op: 'Equals', value: '' }])
              }
            >
              + Condition
            </button>
            <button
              type="button"
              className="linklike"
              onClick={() => {
                setJson(JSON.stringify(toPredicate(mode, rows), null, 2));
                setAsJson(true);
              }}
            >
              Edit as JSON
            </button>
          </div>
        </div>
      )}

      {kind === 'Hard' && asJson && (
        <label>
          Predicate (JSON)
          <textarea
            rows={8}
            className="mono"
            value={json}
            onChange={(e) => setJson(e.target.value)}
          />
          <small className="muted">
            {'{"field", "op", "value"}'} combined with {'{"all": […]}'}, {'{"any": […]}'},{' '}
            {'{"not": …}'}.
          </small>
        </label>
      )}

      <div className="form-buttons">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(async () => setDryRun(await api.dryRun(connectionId, draft())))}
        >
          Test on recent items
        </button>
        <span className="spacer" />
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {initial ? 'Save' : 'Add rule'}
        </button>
      </div>

      {dryRun && (
        <div className="dry-run small">
          <p>
            Fires on <strong>{dryRun.hits.length}</strong> of the last {dryRun.evaluated} items
            {dryRun.conflicts > 0 && (
              <span className="error">
                {' '}
                — {dryRun.conflicts} of them you sorted by hand into the other category
              </span>
            )}
            .
          </p>
          <ul>
            {dryRun.hits.slice(0, 12).map((hit) => (
              <li key={hit.itemId}>
                <span className={`category category--${hit.currentCategory.toLowerCase()}`}>
                  {hit.currentCategory}
                </span>{' '}
                {hit.title} <span className="muted">· {hit.author}</span>
                {hit.probability !== null && (
                  <span className="muted"> · {Math.round(hit.probability * 100)}%</span>
                )}
                {hit.userDecided && <span className="muted"> · sorted by you</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </form>
  );
};
