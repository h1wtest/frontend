// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiClient } from './api';
import { SecurityPanel } from './SecurityPanel';
import { I18nProvider } from './i18n';
import type { AuthSession } from './auth';
const auth: AuthSession = {
  session_id: '01900000-0000-7000-8000-000000000001',
  csrf_token: 'csrf',
  user: {
    id: '01900000-0000-7000-8000-000000000002',
    email: 'user@example.test',
    is_verified: true,
    mfa_enabled: false,
    roles: [],
    permissions: [],
  },
};
const grant = (client_id = 'application/one') => ({
  client_id,
  client_name: client_id === 'application/one' ? 'Calendar app' : 'Notes app',
  scopes: ['openid', 'email'],
  trusted_first_party: false,
  granted_at: '2026-10-24T00:00:00Z',
  last_used_at: '2026-10-24T01:00:00Z',
});
function view(client: ApiClient, session = auth) {
  return (
    <I18nProvider initialLocale="en">
      <SecurityPanel auth={session} client={client} reload={async () => {}} />
    </I18nProvider>
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('lists own applications without staff or MFA and revokes through CSRF before authoritative refresh and opaque pagination', async () => {
  const client = new ApiClient('https://platform.test');
  client.setSession(auth.session_id, 'csrf');
  let revoked = false;
  const commands: { path: string; method: string; csrf: string | null }[] = [];
  const cursors: (string | null)[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL, options: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/sessions')) return Response.json([]);
      if (options.method === 'DELETE') {
        commands.push({
          path: url.pathname,
          method: options.method,
          csrf: new Headers(options.headers).get('X-CSRF-Token'),
        });
        revoked = true;
        return Response.json({ client_id: 'application/one', revoked: true });
      }
      cursors.push(url.searchParams.get('cursor'));
      return Response.json(
        revoked
          ? { items: [], next_cursor: null }
          : url.searchParams.has('cursor')
            ? { items: [grant('application-two')], next_cursor: null }
            : { items: [grant()], next_cursor: 'opaque-grant-cursor' },
      );
    }),
  );
  render(view(client));
  const region = within(await screen.findByRole('region', { name: 'Connected applications' }));
  await region.findByText('Calendar app');
  const user = userEvent.setup();
  await user.click(region.getByRole('button', { name: 'Load more applications' }));
  await region.findByText('Notes app');
  expect(cursors).toEqual([null, 'opaque-grant-cursor']);
  const row = region.getByText('Calendar app').closest('li');
  if (!row) throw new Error('missing_grant');
  await user.click(within(row).getByRole('button', { name: 'Revoke application access' }));
  await region.findByText('No connected applications.');
  expect(commands).toEqual([
    { path: '/api/v1/auth/oauth/grants/application%2Fone', method: 'DELETE', csrf: 'csrf' },
  ]);
  expect(region.queryByText('Notes app')).toBeNull();
});
it('does not convert a failed grant list into an empty-success state or remove a row after revoke failure', async () => {
  const client = new ApiClient('https://platform.test');
  client.setSession(auth.session_id, 'csrf');
  let loadFails = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL, options: RequestInit) => {
      if (new URL(String(input)).pathname.endsWith('/sessions')) return Response.json([]);
      if (loadFails || options.method === 'DELETE')
        return Response.json(
          { error: 'PRIVATE_DETAILS', code: 'dependency_unavailable' },
          { status: 503 },
        );
      return Response.json({ items: [grant()], next_cursor: null });
    }),
  );
  render(view(client));
  const region = within(screen.getByRole('region', { name: 'Connected applications' }));
  await region.findByRole('alert');
  expect(region.queryByText('No connected applications.')).toBeNull();
  loadFails = false;
  await userEvent.click(region.getByRole('button', { name: 'Refresh applications' }));
  await region.findByText('Calendar app');
  await userEvent.click(region.getByRole('button', { name: 'Revoke application access' }));
  await region.findByRole('alert');
  expect(region.getByText('Calendar app')).toBeTruthy();
  expect(region.queryByText('PRIVATE_DETAILS')).toBeNull();
});
it('ignores a delayed old-account grant page after session replacement', async () => {
  const client = new ApiClient('https://platform.test');
  client.setSession(auth.session_id, 'csrf');
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<Response>();
  let first = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL) => {
      if (new URL(String(input)).pathname.endsWith('/sessions')) return Response.json([]);
      if (first) {
        first = false;
        started.resolve();
        return release.promise;
      }
      return Response.json({ items: [grant('application-two')], next_cursor: null });
    }),
  );
  const rendered = render(view(client));
  await started.promise;
  const replacement = {
    ...auth,
    session_id: '01900000-0000-7000-8000-000000000003',
    user: { ...auth.user, id: '01900000-0000-7000-8000-000000000004' },
  };
  client.setSession(replacement.session_id, 'csrf');
  rendered.rerender(view(client, replacement));
  await screen.findByText('Notes app');
  await act(async () => {
    release.resolve(Response.json({ items: [grant()], next_cursor: null }));
    await release.promise;
  });
  await waitFor(() => expect(screen.queryByText('Calendar app')).toBeNull());
});
