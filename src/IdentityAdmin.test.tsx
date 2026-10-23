// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, ApiClient } from './api';
import type { AuthSession } from './auth';
import { IdentityAdmin } from './IdentityAdmin';
import { I18nProvider } from './i18n';
let server: Server;
let origin = '';
let version = 3;
let permissions = ['users:read'];
let roles = ['support'];
let clientCreated = false;
let assignmentVersion = 2;
let revoked = false;
const originalRequest = api.request.bind(api);
const auth: AuthSession = {
  session_id: 'owner-session',
  csrf_token: 'csrf',
  user: {
    id: 'owner-id',
    email: 'owner@example.test',
    is_verified: true,
    mfa_enabled: true,
    roles: ['owner'],
    permissions: ['roles:read', 'roles:write', 'roles:assign', 'oauth:clients:write'],
  },
};
beforeAll(async () => {
  server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/auth/csrf') return res.end('{"csrf_token":"csrf"}');
    if (req.method === 'GET') {
      if (req.url === '/api/v1/admin/roles')
        return res.end(
          JSON.stringify({
            roles: [
              { slug: 'owner', name: 'OWNER', version: 1, permissions: ['roles:write'] },
              { slug: 'support', name: 'SUPPORT', version, permissions },
            ],
            permissions: ['users:read', 'users:sessions:revoke', 'roles:write'],
          }),
        );
      if (req.url === '/api/v1/admin/oauth/clients')
        return res.end(
          JSON.stringify({
            items: clientCreated
              ? [
                  {
                    client_id: 'created-client',
                    client_name: 'Integration',
                    redirect_uris: ['https://app.example/callback'],
                    allowed_scopes: ['openid'],
                    is_public: false,
                    trusted_first_party: false,
                    revoked_at: revoked ? '2026-10-24T00:00:00Z' : null,
                  },
                ]
              : [],
          }),
        );
      if (req.url === '/api/v1/admin/users/44444444-4444-4444-8444-444444444444/roles')
        return res.end(
          JSON.stringify({
            user_id: '44444444-4444-4444-8444-444444444444',
            roles,
            role_version: assignmentVersion,
          }),
        );
    }
    let raw = '';
    for await (const part of req) raw += part;
    const body = JSON.parse(raw || '{}');
    if (req.headers['x-csrf-token'] !== 'csrf') {
      res.statusCode = 403;
      return res.end('{"code":"forbidden"}');
    }
    if (
      req.url === '/api/v1/admin/roles/support/permissions' &&
      body.expected_version === version &&
      body.reason === 'Grant session support' &&
      body.permissions.includes('users:sessions:revoke')
    ) {
      permissions = body.permissions;
      version++;
      return res.end(JSON.stringify({ slug: 'support', version, permissions }));
    }
    if (
      req.url === '/api/v1/admin/users/44444444-4444-4444-8444-444444444444/roles' &&
      body.expected_version === assignmentVersion &&
      body.reason === 'Promote support' &&
      body.roles.includes('admin')
    ) {
      roles = body.roles;
      assignmentVersion++;
      return res.end(
        JSON.stringify({
          user_id: '44444444-4444-4444-8444-444444444444',
          roles,
          role_version: assignmentVersion,
        }),
      );
    }
    if (
      req.url === '/api/v1/admin/oauth/clients' &&
      body.client_name === 'Integration' &&
      body.redirect_uris[0] === 'https://app.example/callback' &&
      body.allowed_scopes[0] === 'openid' &&
      !body.is_public &&
      !body.trusted_first_party &&
      body.reason === 'Add integration'
    ) {
      clientCreated = true;
      return res.end(
        JSON.stringify({
          client_id: 'created-client',
          client_name: 'Integration',
          redirect_uris: ['https://app.example/callback'],
          allowed_scopes: ['openid'],
          is_public: false,
          trusted_first_party: false,
          revoked_at: null,
          client_secret: 'ONLY-ONCE-SECRET',
        }),
      );
    }
    if (
      req.url === '/api/v1/admin/oauth/clients/created-client/rotate' &&
      body.reason === 'Rotate credentials'
    )
      return res.end('{"client_id":"created-client","client_secret":"ROTATED-SECRET"}');
    if (
      req.url === '/api/v1/admin/oauth/clients/created-client/revoke' &&
      body.reason === 'Retire integration'
    ) {
      revoked = true;
      return res.end('{"client_id":"created-client","revoked":true}');
    }
    res.statusCode = 409;
    res.end('{"code":"version_conflict","error":"PRIVATE DATABASE TEXT"}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(() => {
  cleanup();
  api.request = originalRequest;
  version = 3;
  assignmentVersion = 2;
  permissions = ['users:read'];
  roles = ['support'];
  clientCreated = false;
});
afterAll(async () => {
  server.close();
  await once(server, 'close');
});
function view(session = auth) {
  const client = new ApiClient(origin);
  api.request = client.request.bind(client);
  return render(
    <I18nProvider initialLocale="en">
      <IdentityAdmin auth={session} />
    </I18nProvider>,
  );
}
it('hides OWNER mutation controls from a non-owner even with a role-write permission', () => {
  view({ ...auth, user: { ...auth.user, roles: ['admin'] } });
  expect(screen.queryByRole('button', { name: 'Create OAuth client' })).toBeNull();
  expect(screen.getByText('You do not have permission to manage identity.')).toBeTruthy();
});
it('uses the current role version and refreshes the persisted permission map', async () => {
  view();
  const user = userEvent.setup();
  const role = await screen.findByRole('group', { name: 'SUPPORT' });
  await user.click(within(role).getByLabelText('users:sessions:revoke'));
  await user.type(within(role).getByLabelText('Reason'), 'Grant session support');
  await user.click(within(role).getByRole('button', { name: 'Save permissions' }));
  await waitFor(() =>
    expect(
      within(screen.getByRole('group', { name: 'SUPPORT' })).getByText('Version: 4'),
    ).toBeTruthy(),
  );
  expect(
    (
      within(screen.getByRole('group', { name: 'SUPPORT' })).getByLabelText(
        'users:sessions:revoke',
      ) as HTMLInputElement
    ).checked,
  ).toBe(true);
});
it('loads current staff roles before assigning and clears one-time OAuth secrets explicitly', async () => {
  view();
  const user = userEvent.setup();
  await screen.findByRole('group', { name: 'SUPPORT' });
  await user.type(screen.getByLabelText('User ID'), '44444444-4444-4444-8444-444444444444');
  await user.click(screen.getByRole('button', { name: 'Load current roles' }));
  const assignment = await screen.findByRole('group', { name: 'User staff assignment' });
  await user.click(within(assignment).getByLabelText('ADMIN'));
  await user.type(within(assignment).getByLabelText('Reason'), 'Promote support');
  await user.click(within(assignment).getByRole('button', { name: 'Save staff assignment' }));
  await waitFor(() => expect(roles).toContain('admin'));
  const create = screen.getByRole('form', { name: 'Create OAuth client' });
  await user.type(within(create).getByLabelText('Client name'), 'Integration');
  await user.type(
    within(create).getByLabelText('Exact HTTPS redirect URIs (one per line)'),
    'https://app.example/callback',
  );
  await user.type(within(create).getByLabelText('Reason'), 'Add integration');
  await user.click(within(create).getByRole('button', { name: 'Create OAuth client' }));
  await screen.findByText('ONLY-ONCE-SECRET');
  await user.click(screen.getByRole('button', { name: 'Hide secrets' }));
  expect(screen.queryByText('ONLY-ONCE-SECRET')).toBeNull();
});

it('rotates a confidential secret once, clears it when identity changes, and revokes the client', async () => {
  clientCreated = true;
  revoked = false;
  const rendered = view();
  const user = userEvent.setup();
  await screen.findByText('Integration');
  const rotate = screen.getByRole('form', { name: 'Rotate client secret' });
  await user.type(within(rotate).getByLabelText('Reason'), 'Rotate credentials');
  await user.click(within(rotate).getByRole('button', { name: 'Rotate client secret' }));
  await screen.findByText('ROTATED-SECRET');
  rendered.rerender(
    <I18nProvider initialLocale="en">
      <IdentityAdmin auth={{ ...auth, session_id: 'new-owner-session' }} />
    </I18nProvider>,
  );
  expect(screen.queryByText('ROTATED-SECRET')).toBeNull();
  const revoke = await screen.findByRole('form', { name: 'Revoke client' });
  await user.type(within(revoke).getByLabelText('Reason'), 'Retire integration');
  await user.click(within(revoke).getByRole('button', { name: 'Revoke client' }));
  await screen.findByText(/Revoked:/);
  expect(screen.queryByRole('button', { name: 'Rotate client secret' })).toBeNull();
});

it('does not overwrite a newer permission map and shows a localized conflict rather than backend internals', async () => {
  view();
  const user = userEvent.setup();
  const role = await screen.findByRole('group', { name: 'SUPPORT' });
  version = 9;
  await user.click(within(role).getByLabelText('users:sessions:revoke'));
  await user.type(within(role).getByLabelText('Reason'), 'Grant session support');
  await user.click(within(role).getByRole('button', { name: 'Save permissions' }));
  expect((await within(role).findByRole('alert')).textContent).toContain('record changed');
  expect(screen.getByRole('alert').textContent).not.toContain('PRIVATE DATABASE TEXT');
  expect(permissions).toEqual(['users:read']);
});
