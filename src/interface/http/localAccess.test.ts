import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { localAccess } from './localAccess';

const TOKEN = 'launch-token-0123456789abcdef0123456789';
const HOST = '127.0.0.1:47823';

const app = new Hono();

app.use(
  '*',
  localAccess(TOKEN, () => 47823)
);
app.get('/api/items', (c) => c.json({ items: [] }));
app.post('/api/items/1/reply', (c) => c.json({ ok: true }));
app.get('/', (c) => c.text('spa'));

const call = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  app.request(`http://${HOST}${path}`, {
    method: init.method ?? 'GET',
    headers: { host: HOST, ...init.headers },
  });

describe('local access (the Mac app)', () => {
  test('the window proves itself once and gets a strict, script-proof cookie', async () => {
    const launched = await call(`/__launch?token=${TOKEN}`);
    const cookie = launched.headers.get('set-cookie') ?? '';

    expect(launched.status).toBe(302);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');

    const session = cookie.split(';')[0] ?? '';

    expect((await call('/api/items', { headers: { cookie: session } })).status).toBe(200);
  });

  test('without the session the API is closed, the page shell is not', async () => {
    expect((await call('/api/items')).status).toBe(401);
    expect((await call('/__launch?token=wrong')).status).toBe(403);
    expect((await call('/')).status).toBe(200);
  });

  test('a rebinding page (foreign Host) and a cross-site write are refused', async () => {
    const session = `huginn_session=${TOKEN}`;

    expect(
      (await call('/api/items', { headers: { host: 'evil.example:47823', cookie: session } }))
        .status
    ).toBe(403);
    expect(
      (
        await call('/api/items/1/reply', {
          method: 'POST',
          headers: { cookie: session, origin: 'https://evil.example' },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await call('/api/items/1/reply', {
          method: 'POST',
          headers: { cookie: session, origin: `http://${HOST}` },
        })
      ).status
    ).toBe(200);
  });
});
