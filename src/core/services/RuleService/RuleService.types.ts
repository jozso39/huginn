import type {
  Rule,
  RuleDraft,
  RuleHistoryEntry,
  RuleOrigin,
  RuleStatus,
} from '@/core/triage/Rule.types';

export interface RuleView extends Rule {
  /** A human reading of the predicate or the criterion. */
  readonly description: string;
}

export interface FieldInfo {
  readonly field: string;
  /** A few distinct values seen on recent items, to help write a condition. */
  readonly samples: readonly string[];
}

export interface RuleChangeContext {
  readonly origin: RuleOrigin;
  readonly status?: RuleStatus;
  readonly priority?: number;
  readonly reason?: string | null;
  readonly itemId?: string | null;
  readonly checks?: Readonly<Record<string, unknown>> | null;
}

export enum MoveDirection {
  Up = 'Up',
  Down = 'Down',
}

export interface IRuleService {
  list(connectionId: string): Promise<readonly RuleView[]>;
  history(connectionId: string): Promise<readonly RuleHistoryEntry[]>;
  get(id: string): Promise<Rule | null>;
  /** Validates, stores, records history, re-triages the connection's open items. */
  create(connectionId: string, draft: RuleDraft, context: RuleChangeContext): Promise<Rule>;
  update(id: string, draft: RuleDraft, context: RuleChangeContext): Promise<Rule>;
  setStatus(id: string, status: RuleStatus): Promise<Rule>;
  move(id: string, direction: MoveDirection): Promise<void>;
  remove(id: string): Promise<void>;
  /** Throws a Validation error describing what is wrong with the draft. */
  validate(draft: RuleDraft): RuleDraft;
  /** The connector's suggested rules; returns how many were added. */
  installDefaults(connectionId: string): Promise<number>;
  /** Installs defaults on connections that never had any rule (upgrades, new kinds). */
  installMissingDefaults(): Promise<void>;
  fields(connectionId: string): Promise<readonly FieldInfo[]>;
}
