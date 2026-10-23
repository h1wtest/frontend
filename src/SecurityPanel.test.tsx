// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecurityPanel } from './SecurityPanel';
import { ApiClient } from './api';
import type { AuthSession } from './auth';
let server: Server;
let client: ApiClient;
const auth: AuthSession = {
  user: {
    id: 'user-1',
    email: 'user@example.test',
    is_verified: true,
    mfa_enabled: false,
    roles: [],
    permissions: [],
  },
  session_id: 'session-1',
  csrf_token: 'csrf',
};
beforeAll(async () => {
  server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/auth/sessions') return res.end('[]');
    if (req.url === '/api/v1/auth/csrf') return res.end('{"csrf_token":"csrf"}');
    if (req.url === '/api/v1/auth/mfa/setup' && req.headers['x-csrf-token'] === 'csrf')
      return res.end(
        '{"secret":"SECRET-FROM-SERVER","otpauth_uri":"otpauth://totp/Account?secret=SECRET","recovery_codes":["backup-one","backup-two"]}',
      );
    let raw = '';
    for await (const part of req) raw += part;
    if (req.url === '/api/v1/auth/mfa/enable' && JSON.parse(raw).code === '123456')
      return res.end('{}');
    res.statusCode = 400;
    res.end('{"error":"Incorrect code"}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  client = new ApiClient(`http://127.0.0.1:${address.port}`);
});
afterEach(cleanup);
afterAll(async () => {
  server.close();
  await once(server, 'close');
});
it('shows actual one-time recovery codes, requires acknowledgment, then hides secrets after enable', async () => {
  const user = userEvent.setup();
  let reloads = 0;
  render(
    <SecurityPanel
      auth={auth}
      client={client}
      reload={async () => {
        reloads++;
      }}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Настроить MFA' }));
  await screen.findByText('backup-one');
  expect(screen.queryByRole('button', { name: 'Включить подготовленную MFA' })).toBeNull();
  await user.click(screen.getByLabelText('Я сохранил резервные коды'));
  await user.type(screen.getByLabelText('Код нового приложения MFA'), '123456');
  await user.click(screen.getByRole('button', { name: 'Включить подготовленную MFA' }));
  await waitFor(() => expect(screen.queryByText('backup-one')).toBeNull());
  expect(screen.queryByText('backup-one')).toBeNull();
  expect(screen.queryByText('SECRET-FROM-SERVER')).toBeNull();
  expect(reloads).toBe(1);
});
