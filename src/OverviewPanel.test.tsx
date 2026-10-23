// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { OverviewPanel } from './OverviewPanel';
import { I18nProvider } from './i18n';
import { api } from './api';
import type { AuthSession } from './auth';
const auth: AuthSession = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'self@example.test',
    is_verified: true,
    mfa_enabled: true,
    mfa_verified: false,
    roles: [],
    permissions: [],
  },
  session_id: '00000000-0000-4000-8000-000000000006',
  csrf_token: 'csrf',
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  api.setSession(null);
});
it('retains available account truth while failed finance and subscription sections stay unavailable', async () => {
  api.setSession(auth.session_id, 'csrf');
  vi.stubGlobal('fetch', async () =>
    Response.json({
      account: {
        status: 'available',
        data: { user: auth.user, session_id: auth.session_id, mfa_verified: false },
      },
      subscriptions: { status: 'unavailable', data: null },
      orders: { status: 'available', data: { items: [], next_cursor: null } },
      referrals: { status: 'unavailable', data: null },
    }),
  );
  render(
    <I18nProvider initialLocale="en">
      <OverviewPanel auth={auth} />
    </I18nProvider>,
  );
  await screen.findByText('self@example.test');
  const subscriptions = screen.getByRole('region', { name: 'Subscriptions' });
  expect(within(subscriptions).getByText('Temporarily unavailable')).toBeTruthy();
  expect(within(subscriptions).queryByText('No subscriptions yet.')).toBeNull();
  const referrals = screen.getByRole('region', { name: 'Referrals' });
  expect(within(referrals).getByText('Temporarily unavailable')).toBeTruthy();
  expect(within(referrals).queryByText('0.000000 USDT')).toBeNull();
  expect(screen.getByText('No orders yet.')).toBeTruthy();
});
it('discards a previous session overview arriving after account switch', async () => {
  api.setSession(auth.session_id, 'csrf');
  const delayed = Promise.withResolvers<Response>();
  vi.stubGlobal('fetch', () => delayed.promise);
  const view = render(
    <I18nProvider initialLocale="en">
      <OverviewPanel auth={auth} />
    </I18nProvider>,
  );
  const next = {
    ...auth,
    session_id: '00000000-0000-4000-8000-000000000007',
    user: { ...auth.user, id: '00000000-0000-4000-8000-000000000008', email: 'next@example.test' },
  };
  api.setSession(next.session_id, 'csrf');
  vi.stubGlobal('fetch', async () =>
    Response.json({
      account: {
        status: 'available',
        data: { user: next.user, session_id: next.session_id, mfa_verified: false },
      },
      subscriptions: { status: 'available', data: { items: [], next_cursor: null } },
      orders: { status: 'available', data: { items: [], next_cursor: null } },
      referrals: { status: 'unavailable', data: null },
    }),
  );
  view.rerender(
    <I18nProvider initialLocale="en">
      <OverviewPanel auth={next} />
    </I18nProvider>,
  );
  delayed.resolve(
    Response.json({
      account: {
        status: 'available',
        data: { user: auth.user, session_id: auth.session_id, mfa_verified: false },
      },
      subscriptions: { status: 'unavailable', data: null },
      orders: { status: 'unavailable', data: null },
      referrals: { status: 'unavailable', data: null },
    }),
  );
  await screen.findByText('next@example.test');
  expect(screen.queryByText('self@example.test')).toBeNull();
});
