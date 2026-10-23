// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminPanel } from './AdminPanel';
import { I18nProvider } from './i18n';
import { api } from './api';
import type { AuthSession } from './auth';
let server: Server;
let origin: string;
const nativeFetch = globalThis.fetch;
let commands: { reason: string; idempotency_key: string }[];
let targetRoles: string[];
let commandPaths: string[];
let statusReads: number;
let resumes: { method: string; path: string; csrf: string | string[] | undefined; body: unknown }[];
const userId = '01900000-0000-7000-8000-000000000001';
const auth: AuthSession = {
  user: {
    id: '01900000-0000-7000-8000-000000000002',
    email: 'support@example.test',
    roles: ['support'],
    permissions: ['users:read', 'users:sessions:revoke'],
    mfa_enabled: true,
    is_verified: true,
  },
  session_id: '01900000-0000-7000-8000-000000000003',
  csrf_token: 'csrf',
  mfa_verified: true,
};
beforeAll(async () => {
  server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.startsWith('/api/v1/admin/users?'))
      return res.end(
        JSON.stringify([
          {
            id: userId,
            email: 'ordinary@example.test',
            roles: targetRoles,
            is_banned: false,
            ban_reason: null,
            is_verified: true,
            mfa_enabled: false,
            created_at: '2026-10-24T00:00:00Z',
          },
        ]),
      );
    if (req.url === `/api/v1/admin/users/${userId}/revoke-sessions`) {
      let raw = '';
      for await (const part of req) raw += part;
      commandPaths.push(req.url);
      commands.push(JSON.parse(raw) as { reason: string; idempotency_key: string });
      res.statusCode = 202;
      return res.end(
        JSON.stringify({ command_id: '01900000-0000-7000-8000-000000000004', status: 'unknown' }),
      );
    }
    if (
      req.url === '/api/v1/admin/commands/01900000-0000-7000-8000-000000000004' &&
      req.method === 'GET'
    ) {
      statusReads++;
      return res.end(
        JSON.stringify({ command_id: '01900000-0000-7000-8000-000000000004', status: 'unknown' }),
      );
    }
    if (
      req.url === '/api/v1/admin/commands/01900000-0000-7000-8000-000000000004/resume' &&
      req.method === 'POST'
    ) {
      let raw = '';
      for await (const part of req) raw += part;
      resumes.push({
        method: req.method,
        path: req.url,
        csrf: req.headers['x-csrf-token'],
        body: JSON.parse(raw),
      });
      return res.end(
        JSON.stringify({
          command_id: '01900000-0000-7000-8000-000000000004',
          status: 'succeeded',
          result: { revoked: 1 },
        }),
      );
    }
    res.statusCode = 404;
    res.end('{"error":"not_found","code":"not_found"}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing_listener');
  origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  commands = [];
  targetRoles = [];
  commandPaths = [];
  statusReads = 0;
  resumes = [];
  api.setSession(auth.session_id, 'csrf');
  vi.stubGlobal('fetch', ((input, options) => {
    const url = new URL(String(input));
    return nativeFetch(origin + url.pathname + url.search, options);
  }) as typeof fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  api.setSession(null);
});
afterAll(async () => {
  server.close();
  await once(server, 'close');
});
it('reuses the command key after an unknown result and never labels it successful', async () => {
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <AdminPanel auth={auth} />
    </I18nProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Find users' }));
  await screen.findByText('ordinary@example.test');
  await user.type(screen.getByLabelText('Reason'), 'Lost device');
  await user.click(screen.getByRole('button', { name: 'Revoke sessions' }));
  await screen.findByText('Result unknown; check before retrying');
  await user.click(screen.getByRole('button', { name: 'Revoke sessions' }));
  expect(commands).toHaveLength(2);
  expect(commands[1].idempotency_key).toBe(commands[0].idempotency_key);
  expect(screen.queryByText('Succeeded')).toBeNull();
});
it.each([
  ['support', [], true],
  ['support', ['support'], false],
  ['support', ['admin'], false],
  ['support', ['owner'], false],
  ['admin', [], true],
  ['admin', ['support'], true],
  ['admin', ['admin'], true],
  ['admin', ['owner'], false],
  ['owner', [], true],
  ['owner', ['support'], true],
  ['owner', ['admin'], true],
  ['owner', ['owner'], true],
] as const)(
  'restricts %s session revocation to its authorized target scope %j',
  async (role, targets, permitted) => {
    targetRoles = [...targets];
    const actor = {
      ...auth,
      user: {
        ...auth.user,
        id:
          role === 'owner' && targets.some((target) => target === 'owner') ? userId : auth.user.id,
        roles: [role],
      },
    };
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <AdminPanel auth={actor} />
      </I18nProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Find users' }));
    const row = (await screen.findByText('ordinary@example.test')).closest('li');
    if (!row) throw new Error('missing_target_row');
    const revoke = within(row).queryByRole('button', { name: 'Revoke sessions' });
    expect(Boolean(revoke)).toBe(permitted);
    if (revoke) {
      await user.type(within(row).getByLabelText('Reason'), 'Lost staff device');
      await user.click(revoke);
      await screen.findByText('Result unknown; check before retrying');
      expect(commandPaths).toEqual([`/api/v1/admin/users/${userId}/revoke-sessions`]);
      expect(commands[0].reason).toBe('Lost staff device');
      expect(commands[0].idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    } else expect(commands).toHaveLength(0);
  },
);
it('never substitutes the OWNER role for session-revoke permission or fresh MFA', async () => {
  const user = userEvent.setup();
  const actor = { ...auth, user: { ...auth.user, roles: ['owner'], permissions: ['users:read'] } };
  const view = render(
    <I18nProvider initialLocale="en">
      <AdminPanel auth={actor} />
    </I18nProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Find users' }));
  await screen.findByText('ordinary@example.test');
  expect(screen.queryByRole('button', { name: 'Revoke sessions' })).toBeNull();
  view.rerender(
    <I18nProvider initialLocale="en">
      <AdminPanel
        auth={{
          ...auth,
          mfa_verified: false,
          user: { ...auth.user, roles: ['owner'], mfa_verified: false },
        }}
      />
    </I18nProvider>,
  );
  expect(screen.queryByRole('button', { name: 'Find users' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Revoke sessions' })).toBeNull();
});
it('keeps command status reads observational and resumes only through an explicit CSRF-protected POST with the same journal ID', async () => {
  const actor = {
    ...auth,
    user: { ...auth.user, permissions: [...auth.user.permissions, 'audit:read'] },
  };
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <AdminPanel auth={actor} />
    </I18nProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Find users' }));
  await screen.findByText('ordinary@example.test');
  await user.type(screen.getByLabelText('Reason'), 'Lost device');
  await user.click(screen.getByRole('button', { name: 'Revoke sessions' }));
  await screen.findByText('Result unknown; check before retrying');
  await user.click(screen.getByRole('button', { name: 'Check command result' }));
  expect(statusReads).toBe(1);
  expect(resumes).toHaveLength(0);
  expect(commands).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Resume command' }));
  await screen.findByText('Succeeded');
  expect(resumes).toEqual([
    {
      method: 'POST',
      path: '/api/v1/admin/commands/01900000-0000-7000-8000-000000000004/resume',
      csrf: 'csrf',
      body: {},
    },
  ]);
  expect(screen.queryByRole('button', { name: 'Resume command' })).toBeNull();
});
