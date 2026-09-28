import type {
  Action,
  Connection,
  ConnectorDescriptor,
  ConnectorKind,
  Item,
  ItemState,
  OAuthAppView,
  OAuthProvider,
  RedirectMode,
} from './api.types';

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
  getItem: (id: string) => request<{ item: Item; actions: Action[] }>('GET', `/items/${id}`),
  reply: (id: string, text: string) =>
    request<{ item: Item }>('POST', `/items/${id}/reply`, { text }).then((r) => r.item),
  draft: (id: string, text: string) =>
    request<{ item: Item }>('POST', `/items/${id}/draft`, { text }).then((r) => r.item),
  react: (id: string, emoji: string) =>
    request<{ item: Item }>('POST', `/items/${id}/react`, { emoji }).then((r) => r.item),
  done: (id: string) => request<{ item: Item }>('POST', `/items/${id}/done`).then((r) => r.item),
  reopen: (id: string) =>
    request<{ item: Item }>('POST', `/items/${id}/reopen`).then((r) => r.item),

  listConnections: () =>
    request<{ connections: Connection[] }>('GET', '/connections').then((r) => r.connections),
  listKinds: () =>
    request<{ kinds: ConnectorDescriptor[] }>('GET', '/connections/kinds').then((r) => r.kinds),
  createConnection: (input: {
    kind: string;
    name: string;
    config: Record<string, unknown>;
    secrets: Record<string, string>;
  }) =>
    request<{ connection: Connection }>('POST', '/connections', input).then((r) => r.connection),
  updateConnection: (id: string, name: string, config: Record<string, unknown>) =>
    request<{ connection: Connection }>('PUT', `/connections/${id}`, { name, config }),
  updateSecrets: (id: string, secrets: Record<string, string>) =>
    request<{ ok: true }>('PUT', `/connections/${id}/secrets`, { secrets }),
  setEnabled: (id: string, enabled: boolean) =>
    request<{ connection: Connection }>('PUT', `/connections/${id}/enabled`, { enabled }),
  removeConnection: (id: string) => request<{ ok: true }>('DELETE', `/connections/${id}`),
  getOAuthApp: (provider: OAuthProvider) =>
    request<{ app: OAuthAppView }>('GET', `/oauth/apps/${provider}`).then((r) => r.app),
  saveOAuthApp: (
    provider: OAuthProvider,
    body: { clientId: string; clientSecret: string; redirectMode: RedirectMode }
  ) => request<{ app: OAuthAppView }>('PUT', `/oauth/apps/${provider}`, body).then((r) => r.app),
  /** Returns the provider page to send the browser to. */
  signIn: (target: { kind: ConnectorKind } | { connectionId: string }) =>
    request<{ url: string }>('POST', '/oauth/sign-in', target).then((r) => r.url),
};
