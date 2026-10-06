import type {
  Action,
  AiKeyInfo,
  AiProvider,
  Connection,
  ConnectionGroup,
  ConnectorDescriptor,
  ConnectorKind,
  DryRunResult,
  FeedbackResult,
  FieldInfo,
  Item,
  ItemState,
  OAuthAppView,
  OAuthProvider,
  PairingStatus,
  SignInStart,
  SignInStatus,
  RedirectMode,
  RichContent,
  Rule,
  RuleDraft,
  RuleHistoryEntry,
  RuleStatus,
  Settings,
  Verdict,
} from './api.types';

/** What the settings form sends besides the connector's own config and tokens. */
export interface ConnectionLook {
  groupId: string | null;
  color: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { message?: string };

  if (!response.ok) {
    throw new ApiError(data.message ?? `HTTP ${response.status}`, response.status);
  }

  return data as T;
};

export const api = {
  listItems: (state: ItemState) =>
    request<{ items: Item[] }>('GET', `/items?state=${state}&limit=500`).then((r) => r.items),
  /** The archive: items with every word of `query` (case and accents ignored), newest first. */
  searchArchive: (query: string, limit: number) =>
    request<{ items: Item[] }>(
      'GET',
      `/items?state=Done&limit=${limit}&q=${encodeURIComponent(query)}`
    ).then((r) => r.items),
  content: (id: string) =>
    request<{ content: RichContent }>('GET', `/items/${id}/content`).then((r) => r.content),
  getItem: (id: string) => request<{ item: Item; actions: Action[] }>('GET', `/items/${id}`),
  reply: (id: string, text: string) =>
    request<{ item: Item }>('POST', `/items/${id}/reply`, { text }).then((r) => r.item),
  draft: (id: string, text: string) =>
    request<{ item: Item }>('POST', `/items/${id}/draft`, { text }).then((r) => r.item),
  react: (id: string, emoji: string) =>
    request<{ item: Item }>('POST', `/items/${id}/react`, { emoji }).then((r) => r.item),
  done: (id: string) => request<{ item: Item }>('POST', `/items/${id}/done`).then((r) => r.item),
  feedback: (id: string, verdict: Verdict, explanation: string) =>
    request<FeedbackResult>('POST', `/items/${id}/feedback`, { verdict, explanation }),
  reopen: (id: string) =>
    request<{ item: Item }>('POST', `/items/${id}/reopen`).then((r) => r.item),

  listConnections: () =>
    request<{ connections: Connection[] }>('GET', '/connections').then((r) => r.connections),
  listKinds: () =>
    request<{ kinds: ConnectorDescriptor[] }>('GET', '/connections/kinds').then((r) => r.kinds),
  createConnection: (
    input: ConnectionLook & {
      kind: string;
      name: string;
      config: Record<string, unknown>;
      secrets: Record<string, string>;
    }
  ) => request<{ connection: Connection }>('POST', '/connections', input).then((r) => r.connection),
  updateConnection: (
    id: string,
    changes: ConnectionLook & { name: string; config: Record<string, unknown> }
  ) => request<{ connection: Connection }>('PUT', `/connections/${id}`, changes),
  updateSecrets: (id: string, secrets: Record<string, string>) =>
    request<{ ok: true }>('PUT', `/connections/${id}/secrets`, { secrets }),
  setEnabled: (id: string, enabled: boolean) =>
    request<{ connection: Connection }>('PUT', `/connections/${id}/enabled`, { enabled }),
  removeConnection: (id: string) => request<{ ok: true }>('DELETE', `/connections/${id}`),
  listGroups: () => request<{ groups: ConnectionGroup[] }>('GET', '/groups').then((r) => r.groups),
  /** Returns the existing category when the name is taken (ignoring case). */
  createGroup: (name: string) =>
    request<{ group: ConnectionGroup }>('POST', '/groups', { name }).then((r) => r.group),
  renameGroup: (id: string, name: string) =>
    request<{ group: ConnectionGroup }>('PUT', `/groups/${id}`, { name }).then((r) => r.group),
  deleteGroup: (id: string) => request<{ ok: true }>('DELETE', `/groups/${id}`),

  getSettings: () => request<{ settings: Settings; ai: AiKeyInfo | null }>('GET', '/settings'),
  /** Checked with the provider first; it is never sent back. */
  saveAiKey: (provider: AiProvider, key: string) =>
    request<{ ai: AiKeyInfo }>('PUT', '/settings/ai-key', { provider, key }).then((r) => r.ai),
  removeAiKey: () => request<{ ok: true }>('DELETE', '/settings/ai-key'),
  saveSettings: (patch: Partial<Settings>) =>
    request<{ settings: Settings }>('PUT', '/settings', patch).then((r) => r.settings),

  getOAuthApp: (provider: OAuthProvider) =>
    request<{ app: OAuthAppView }>('GET', `/oauth/apps/${provider}`).then((r) => r.app),
  saveOAuthApp: (
    provider: OAuthProvider,
    body: { clientId: string; clientSecret: string; redirectMode: RedirectMode }
  ) => request<{ app: OAuthAppView }>('PUT', `/oauth/apps/${provider}`, body).then((r) => r.app),
  startPairing: (target: { kind: ConnectorKind } | { connectionId: string }) =>
    request<{ pairingId: string; code: string }>('POST', '/connections/pairings', target),
  pairingStatus: (pairingId: string) =>
    request<PairingStatus>('GET', `/connections/pairings/${pairingId}`),
  /** The provider page to send the browser to, and the id to ask how it ended. */
  signIn: (target: { kind: ConnectorKind } | { connectionId: string }) =>
    request<SignInStart>('POST', '/oauth/sign-in', target),
  signInStatus: (signInId: string) =>
    request<SignInStatus>('GET', `/oauth/sign-in/${encodeURIComponent(signInId)}`),

  listRules: (connectionId: string) =>
    request<{ rules: Rule[]; history: RuleHistoryEntry[] }>(
      'GET',
      `/connections/${connectionId}/rules`
    ),
  createRule: (connectionId: string, draft: RuleDraft) =>
    request<{ rule: Rule }>('POST', `/connections/${connectionId}/rules`, draft).then(
      (r) => r.rule
    ),
  dryRun: (connectionId: string, draft: RuleDraft) =>
    request<DryRunResult>('POST', `/connections/${connectionId}/rules/dry-run`, draft),
  retriage: (connectionId: string) =>
    request<{ evaluated: number; changed: number }>('POST', `/connections/${connectionId}/triage`),
  fields: (connectionId: string) =>
    request<{ fields: FieldInfo[] }>('GET', `/connections/${connectionId}/fields`).then(
      (r) => r.fields
    ),
  updateRule: (id: string, draft: RuleDraft) =>
    request<{ rule: Rule }>('PUT', `/rules/${id}`, draft).then((r) => r.rule),
  setRuleStatus: (id: string, status: RuleStatus) =>
    request<{ rule: Rule }>('PUT', `/rules/${id}/status`, { status }).then((r) => r.rule),
  moveRule: (id: string, direction: 'Up' | 'Down') =>
    request<{ ok: true }>('POST', `/rules/${id}/move`, { direction }),
  deleteRule: (id: string) => request<{ ok: true }>('DELETE', `/rules/${id}`),
};
