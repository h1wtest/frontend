// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiClient, api } from './api';
import { ConsentPanel } from './ConsentPanel';
import { I18nProvider } from './i18n';

const id = '12345678-1234-4123-8123-123456789abc';
let server: Server;
let base = '';
let decision: boolean | undefined;
let unsafe = false;
let failure = false;
const originalRequest = api.request.bind(api);
beforeAll(async () => {
  server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/auth/csrf') return res.end('{"csrf_token":"csrf"}');
    if (req.method === 'GET')
      return res.end(
        JSON.stringify({
          request_id: id,
          client_name: 'Calendar App',
          scopes: ['openid', 'email'],
          expires_at: '2099-01-01T00:00:00Z',
        }),
      );
    let body = '';
    for await (const part of req) body += part;
    if (failure) {
      res.statusCode = 403;
      return res.end('{"code":"forbidden","error":"PRIVATE PROVIDER TEXT"}');
    }
    if (req.headers['x-csrf-token'] !== 'csrf') {
      res.statusCode = 403;
      return res.end('{}');
    }
    decision = JSON.parse(body).approved;
    res.end(
      JSON.stringify({
        redirect_to: unsafe
          ? 'https://evil.example/oauth/consent/complete/' + id
          : '/oauth/consent/complete/' + id,
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(() => {
  cleanup();
  api.request = originalRequest;
  decision = undefined;
  unsafe = false;
  failure = false;
});
afterAll(async () => {
  server.close();
  await once(server, 'close');
});
function useServer() {
  const client = new ApiClient(base);
  api.request = client.request.bind(client);
}

it.each([true, false])(
  'requires an explicit %s decision and continues only after the authoritative response',
  async (approved) => {
    useServer();
    const user = userEvent.setup();
    let continuation = '';
    render(
      <I18nProvider initialLocale="en">
        <ConsentPanel
          requestId={id}
          onComplete={(path) => {
            continuation = path;
          }}
        />
      </I18nProvider>,
    );
    await screen.findByText('Calendar App');
    expect(decision).toBeUndefined();
    expect(continuation).toBe('');
    await user.click(
      screen.getByRole('button', { name: approved ? 'Approve access' : 'Deny access' }),
    );
    await waitFor(() => expect(continuation).toBe('/oauth/consent/complete/' + id));
    expect(decision).toBe(approved);
    expect(screen.queryByRole('button', { name: 'Approve access' })).toBeNull();
  },
);
it('blocks a cross-origin continuation without invoking completion', async () => {
  useServer();
  unsafe = true;
  const user = userEvent.setup();
  let completed = false;
  render(
    <I18nProvider initialLocale="en">
      <ConsentPanel
        requestId={id}
        onComplete={() => {
          completed = true;
        }}
      />
    </I18nProvider>,
  );
  await screen.findByText('Calendar App');
  await user.click(screen.getByRole('button', { name: 'Approve access' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Unsafe authorization');
  expect(completed).toBe(false);
});
it('localizes failure and never exposes backend/provider text', async () => {
  useServer();
  failure = true;
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="ru">
      <ConsentPanel
        requestId={id}
        onComplete={() => {
          throw new Error('must not complete');
        }}
      />
    </I18nProvider>,
  );
  await screen.findByText('Calendar App');
  await user.click(screen.getByRole('button', { name: 'Отклонить доступ' }));
  expect((await screen.findByRole('alert')).textContent).not.toContain('PRIVATE PROVIDER TEXT');
  expect(decision).toBeUndefined();
});

it('clears consent and cannot submit after the authenticated session expires', async () => {
  useServer();
  render(
    <I18nProvider initialLocale="en">
      <ConsentPanel
        requestId={id}
        onComplete={() => {
          throw new Error('must not complete');
        }}
      />
    </I18nProvider>,
  );
  await screen.findByText('Calendar App');
  window.dispatchEvent(new Event('session-expired'));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve access' })).toBeNull());
  expect((await screen.findByRole('alert')).textContent).toContain('session has expired');
  expect(decision).toBeUndefined();
});
