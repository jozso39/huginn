import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Connection, FieldInfo, Rule, RuleHistoryEntry } from '../api.types';
import { relativeTime } from '../connectorMeta';
import { RuleEditor } from './RuleEditor';
import { ConnectorIcon } from './ConnectorIcon';

interface RulesViewProps {
  connection: Connection;
}

const ORIGIN_LABEL: Record<Rule['origin'], string> = {
  Default: 'built-in',
  User: 'yours',
  Feedback: 'learned',
};

const nameOf = (entry: RuleHistoryEntry): string => {
  const name = entry.after?.name ?? entry.before?.name;

  return typeof name === 'string' ? name : '';
};

const checkSummary = (checks: Record<string, unknown> | null): string | null => {
  if (!checks) {
    return null;
  }

  const dry = checks.dryRun as
    { hits?: number; evaluated?: number; conflicts?: number } | undefined;

  return [
    typeof checks.reasoning === 'string' ? checks.reasoning : null,
    dry ? `caught ${dry.hits ?? 0}/${dry.evaluated ?? 0}, ${dry.conflicts ?? 0} conflicts` : null,
  ]
    .filter(Boolean)
    .join(' · ');
};

/**
 * Every rule of one connection, in the order they are tried: the first that fires
 * decides. Proposals from the feedback agent wait at the top for a yes or no.
 */
export const RulesView = ({ connection }: RulesViewProps) => {
  const [rules, setRules] = useState<Rule[]>([]);
  const [history, setHistory] = useState<RuleHistoryEntry[]>([]);
  const [fields, setFields] = useState<FieldInfo[]>([]);
  // A rule id, the string 'new' for the add form, or null.
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(
    () => Promise.all([api.listRules(connection.id), api.fields(connection.id)]),
    [connection.id]
  );
  const apply = useCallback(([list, fieldList]: Awaited<ReturnType<typeof fetchAll>>) => {
    setRules(list.rules);
    setHistory(list.history);
    setFields(fieldList);
  }, []);
  const load = useCallback(async () => apply(await fetchAll()), [apply, fetchAll]);

  useEffect(() => {
    void fetchAll()
      .then(apply)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [fetchAll, apply]);

  const act = async (action: () => Promise<unknown>, message?: string) => {
    setError(null);
    setNotice(null);

    try {
      await action();
      await load();

      if (message) {
        setNotice(message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const proposals = rules.filter((rule) => rule.status === 'Proposed');
  const ordered = rules.filter((rule) => rule.status !== 'Proposed');

  const ruleCard = (rule: Rule, index: number) => (
    <li key={rule.id} className={`rule rule--${rule.status.toLowerCase()}`}>
      {editing === rule.id ? (
        <RuleEditor
          connectionId={connection.id}
          fields={fields}
          initial={rule}
          onSaved={() => {
            setEditing(null);
            void act(() => Promise.resolve(), 'Saved. Waiting items are being re-sorted.');
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <div className="rule__head">
            <span className={`category category--${rule.verdict.toLowerCase()}`}>
              {rule.verdict}
            </span>
            <strong>{rule.name}</strong>
            <span className="muted small">
              {rule.kind === 'Soft' ? `sentence ≥ ${rule.threshold.toFixed(2)}` : 'conditions'} ·{' '}
              {ORIGIN_LABEL[rule.origin]} · {rule.hits} hits
              {rule.lastHitAt && `, last ${relativeTime(rule.lastHitAt)}`}
              {rule.status === 'Disabled' && ' · off'}
            </span>
          </div>
          <p className="rule__description">{rule.description}</p>
          <div className="rule__actions">
            {rule.status === 'Proposed' ? (
              <>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void act(() => api.setRuleStatus(rule.id, 'Active'), 'Approved.')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => void act(() => api.deleteRule(rule.id), 'Dismissed.')}
                >
                  Dismiss
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => void act(() => api.moveRule(rule.id, 'Up'))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={index === ordered.length - 1}
                  onClick={() => void act(() => api.moveRule(rule.id, 'Down'))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void act(() =>
                      api.setRuleStatus(rule.id, rule.status === 'Disabled' ? 'Active' : 'Disabled')
                    )
                  }
                >
                  {rule.status === 'Disabled' ? 'Turn on' : 'Turn off'}
                </button>
              </>
            )}
            <button type="button" onClick={() => setEditing(rule.id)}>
              Edit
            </button>
            {rule.status !== 'Proposed' && (
              <button
                type="button"
                className="danger"
                onClick={() => {
                  if (window.confirm(`Delete rule “${rule.name}”?`)) {
                    void act(() => api.deleteRule(rule.id));
                  }
                }}
              >
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </li>
  );

  return (
    <section className="rules-view">
      <a href="#connections" className="small">
        ← Connections
      </a>
      <header className="rules-view__head">
        <ConnectorIcon kind={connection.kind} />
        <div>
          <h2>{connection.name}</h2>
          <p className="muted small">
            Tried top to bottom; the first rule that fires decides. Nothing fires → Undecided.
          </p>
        </div>
        <span className="spacer" />
        <button
          type="button"
          onClick={() =>
            void act(async () => {
              const result = await api.retriage(connection.id);

              setNotice(`Re-sorted ${result.evaluated} waiting items; ${result.changed} moved.`);
            })
          }
        >
          Re-sort waiting items
        </button>
      </header>

      {notice && <p className="notice small">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {proposals.length > 0 && (
        <>
          <h3>Waiting for your approval</h3>
          <ul className="rule-list">{proposals.map((rule, i) => ruleCard(rule, i))}</ul>
        </>
      )}

      <h3>Rules</h3>
      {ordered.length === 0 && <p className="muted">No rules: everything lands in Undecided.</p>}
      <ol className="rule-list">{ordered.map((rule, i) => ruleCard(rule, i))}</ol>

      {editing === 'new' ? (
        <RuleEditor
          connectionId={connection.id}
          fields={fields}
          onSaved={() => {
            setEditing(null);
            void act(() => Promise.resolve(), 'Rule added. Waiting items are being re-sorted.');
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button type="button" className="primary" onClick={() => setEditing('new')}>
          + Add rule
        </button>
      )}

      {history.length > 0 && (
        <details className="history">
          <summary>History ({history.length})</summary>
          <ul>
            {history.map((entry) => (
              <li key={entry.id} className="small">
                <span className="muted">{relativeTime(entry.createdAt)}</span> · {entry.change}{' '}
                <strong>{nameOf(entry)}</strong> · {ORIGIN_LABEL[entry.origin]}
                {entry.reason && <> · “{entry.reason}”</>}
                {checkSummary(entry.checks) && (
                  <span className="muted"> · {checkSummary(entry.checks)}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
};
