// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminPanel } from './AdminPanel';
import { api } from './api';
import { I18nProvider } from './i18n';
import type { AuthSession } from './auth';
const target = '01900000-0000-7000-8000-000000000001';
const auth: AuthSession = {
  user: {
    id: '01900000-0000-7000-8000-000000000002',
    email: 'support@example.test',
    roles: ['support'],
    permissions: ['users:read', 'notifications:bindings:reset'],
    mfa_enabled: true,
    is_verified: true,
  },
  session_id: '01900000-0000-7000-8000-000000000003',
  csrf_token: 'csrf',
  mfa_verified: true,
};
const userRow = {
  id: target,
  email: 'target@example.test',
  roles: [],
  is_banned: false,
  ban_reason: null,
  is_verified: true,
  mfa_enabled: false,
  created_at: '2026-10-24T00:00:00Z',
};
function fixture(reply: () => Promise<Response> = async () => Response.json({ status: 'reset' })) {
  api.setSession(auth.session_id, 'csrf');
  const requests: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL, options: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v1/admin/users') return Response.json([userRow]);
      if (url.pathname.endsWith('/telegram/reset')) {
        requests.push({ path: url.pathname, body: JSON.parse(String(options.body)) });
        return reply();
      }
      return Response.json({ error: 'not_found', code: 'not_found' }, { status: 404 });
    }),
  );
  return requests;
}
const view = (session = auth) => (
  <I18nProvider initialLocale="en">
    <AdminPanel auth={session} />
  </I18nProvider>
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  api.setSession(null);
});
it('requires a reason and explicit permission and renders reset only after the authoritative reply', async () => {
  const gate = Promise.withResolvers<Response>();
  const requests = fixture(() => gate.promise);
  render(view());
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Find users' }));
  await screen.findByText('target@example.test');
  const form = within(screen.getByRole('form', { name: 'Reset Telegram binding' }));
  await user.click(form.getByRole('button', { name: 'Reset Telegram binding' }));
  expect(requests).toHaveLength(0);
  await user.type(form.getByLabelText('Reset reason'), 'Verified lost chat');
  await user.click(form.getByRole('checkbox'));
  await user.click(form.getByRole('button', { name: 'Reset Telegram binding' }));
  expect(screen.queryByText('Telegram binding reset confirmed by the server.')).toBeNull();
  expect(requests).toEqual([
    {
      path: `/api/v1/admin/users/${target}/telegram/reset`,
      body: { reason: 'Verified lost chat' },
    },
  ]);
  await act(async () => {
    gate.resolve(Response.json({ status: 'reset' }));
    await gate.promise;
  });
  await screen.findByText('Telegram binding reset confirmed by the server.');
});
it('hides reset without its permission and retains a localized failure instead of reporting reset', async () => {
  fixture();
  const user = userEvent.setup();
  const rendered = render(view({ ...auth, user: { ...auth.user, permissions: ['users:read'] } }));
  await user.click(screen.getByRole('button', { name: 'Find users' }));
  await screen.findByText('target@example.test');
  expect(screen.queryByRole('form', { name: 'Reset Telegram binding' })).toBeNull();
  rendered.unmount();
  fixture(async () =>
    Response.json({ error: 'PRIVATE_DETAILS', code: 'access_denied' }, { status: 403 }),
  );
  render(view());
  await user.click(screen.getByRole('button', { name: 'Find users' }));
  await screen.findByText('target@example.test');
  await user.type(screen.getByLabelText('Reset reason'), 'Verified request');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Reset Telegram binding' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('Telegram binding reset confirmed by the server.')).toBeNull();
  expect(screen.queryByText('PRIVATE_DETAILS')).toBeNull();
});
it('does not expose an old reset completion after the account session changes', async () => {
  const gate = Promise.withResolvers<Response>();
  fixture(() => gate.promise);
  const user = userEvent.setup();
  const rendered = render(view());
  await user.click(screen.getByRole('button', { name: 'Find users' }));
  await screen.findByText('target@example.test');
  await user.type(screen.getByLabelText('Reset reason'), 'Old account request');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Reset Telegram binding' }));
  const replacement = {
    ...auth,
    session_id: '01900000-0000-7000-8000-000000000004',
    user: { ...auth.user, id: '01900000-0000-7000-8000-000000000005' },
  };
  api.setSession(replacement.session_id, 'csrf');
  rendered.rerender(view(replacement));
  await act(async () => {
    gate.resolve(Response.json({ status: 'reset' }));
    await gate.promise;
  });
  expect(screen.queryByText('Telegram binding reset confirmed by the server.')).toBeNull();
});
