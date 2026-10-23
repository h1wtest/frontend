// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecurityPanel } from './SecurityPanel';
import { ApiClient } from './api';
import type { AuthSession } from './auth';
import { I18nProvider } from './i18n';
let revokedOthers = false;
let server: Server;
let client: ApiClient;
const auth: AuthSession = {
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.test',
    is_verified: true,
    mfa_enabled: false,
    roles: [],
    permissions: [],
  },
  session_id: '22222222-2222-4222-8222-222222222222',
  csrf_token: 'csrf',
};
beforeAll(async () => {
  server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/auth/sessions')
      return res.end(
        JSON.stringify([
          {
            session_id: '22222222-2222-4222-8222-222222222222',
            device_name: 'Current device',
            device_label: 'Desktop',
            browser: 'Firefox',
            os: 'Linux',
            ip_address: '127.0.0.1',
            user_agent: 'browser',
            created_at: '2026-10-24T00:00:00Z',
            last_active_at: '2026-10-24T00:00:00Z',
            expires_at: '2026-11-24T00:00:00Z',
            is_current: true,
          },
          ...(!revokedOthers
            ? [
                {
                  session_id: '33333333-3333-4333-8333-333333333333',
                  device_name: 'Other device',
                  device_label: 'Phone',
                  browser: 'Safari',
                  os: 'iOS',
                  ip_address: '127.0.0.2',
                  user_agent: 'phone',
                  created_at: '2026-10-24T00:00:00Z',
                  last_active_at: '2026-10-24T00:00:00Z',
                  expires_at: '2026-11-24T00:00:00Z',
                  is_current: false,
                },
              ]
            : []),
        ]),
      );
    if (req.url === '/api/v1/auth/sessions/revoke-others' && req.method === 'POST') {
      revokedOthers = true;
      return res.end('{"revoked":1}');
    }
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
    <I18nProvider initialLocale="ru">
      <SecurityPanel
        auth={auth}
        client={client}
        reload={async () => {
          reloads++;
        }}
      />
    </I18nProvider>,
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

it('revokes only other sessions and retains the authoritative current session with expiry and device metadata', async () => {
  revokedOthers = false;
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <SecurityPanel auth={auth} client={client} reload={async () => {}} />
    </I18nProvider>,
  );
  await screen.findByText('Other device');
  expect(screen.getByText('Firefox')).toBeTruthy();
  expect(document.querySelector('time[datetime="2026-11-24T00:00:00Z"]')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Revoke other sessions' }));
  await waitFor(() => expect(screen.queryByText('Other device')).toBeNull());
  expect(screen.getByText('Current device')).toBeTruthy();
  expect(screen.getByText('Current')).toBeTruthy();
});

it('removes one-time MFA setup material when the account session changes', async () => {
  const user = userEvent.setup();
  const rendered = render(
    <I18nProvider initialLocale="en">
      <SecurityPanel auth={auth} client={client} reload={async () => {}} />
    </I18nProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Set up MFA' }));
  await screen.findByText('SECRET-FROM-SERVER');
  rendered.rerender(
    <I18nProvider initialLocale="en">
      <SecurityPanel
        auth={{
          ...auth,
          session_id: 'another-session',
          user: { ...auth.user, id: 'another-user' },
        }}
        client={client}
        reload={async () => {}}
      />
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.queryByText('SECRET-FROM-SERVER')).toBeNull());
  expect(screen.queryByText('backup-one')).toBeNull();
});
