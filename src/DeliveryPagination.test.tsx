// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { I18nProvider } from './i18n';
import { NotificationAdmin } from './NotificationAdmin';
import { ProfilePanel } from './ProfilePanel';
import type { AuthSession } from './auth';
const userId = '01900000-0000-7000-8000-000000000001';
const first = '01900000-0000-7000-8000-000000000002';
const second = '01900000-0000-7000-8000-000000000003';
const stamp = '2026-10-24T10:00:00Z';
const row = (id: string) => ({
  id,
  user_id: userId,
  channel: 'email',
  status: 'sent',
  attempts: 1,
  created_at: stamp,
  next_attempt_at: stamp,
  last_error: null,
  message_id: id,
  delivered_at: stamp,
  ambiguous: false,
});
const auth: AuthSession = {
  user: {
    id: userId,
    email: 'owner@example.test',
    is_verified: true,
    mfa_enabled: true,
    roles: ['owner'],
    permissions: ['notifications:read'],
  },
  session_id: '01900000-0000-7000-8000-000000000004',
  csrf_token: 'csrf',
  mfa_verified: true,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  api.setSession(null);
});
it.each(['own', 'admin'] as const)(
  'continues %s delivery history using opaque time-plus-ID metadata even when the page is shorter than limit',
  async (scope) => {
    api.setSession(auth.session_id, 'csrf');
    const path = scope === 'own' ? '/api/v1/notifications' : '/api/v1/admin/deliveries';
    const cursors: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL) => {
        const url = new URL(String(input));
        if (url.pathname === path) {
          const cursor = url.searchParams.get('cursor');
          cursors.push(cursor);
          return Response.json([row(cursor ? second : first)], {
            headers: cursor ? {} : { 'X-Next-Cursor': 'opaque_same_timestamp_id' },
          });
        }
        if (url.pathname.endsWith('/templates')) return Response.json({ items: [] });
        if (url.pathname === '/api/v1/users/me')
          return Response.json({
            profile: {
              user_id: userId,
              email: auth.user.email,
              display_name: null,
              avatar_url: null,
              phone_number: null,
              website_locale: 'en',
              notification_locale: 'en',
              telegram_linked: false,
              binding_version: 0,
            },
            notification_settings: {
              email_login_alerts: true,
              email_security_alerts: true,
              telegram_login_alerts: false,
              telegram_security_alerts: false,
              email_subscription: true,
              telegram_subscription: false,
              telegram_trading: false,
            },
            capabilities: { telegram: false },
          });
        if (url.pathname.endsWith('/telegram'))
          return Response.json({
            linked: false,
            binding_version: 0,
            link_pending: false,
            candidate_ready: false,
            unlink_pending: false,
          });
        return Response.json(
          Object.fromEntries(
            ['account', 'subscriptions', 'orders', 'referrals'].map((key) => [
              key,
              { status: 'unavailable', data: null },
            ]),
          ),
        );
      }),
    );
    render(
      <I18nProvider initialLocale="en">
        {scope === 'own' ? <ProfilePanel /> : <NotificationAdmin auth={auth} />}
      </I18nProvider>,
    );
    const user = userEvent.setup();
    if (scope === 'own')
      await user.click(await screen.findByRole('button', { name: 'Load notification history' }));
    await screen.findByText(first);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText(second);
    expect(screen.getByText(first)).toBeTruthy();
    expect(cursors).toEqual([null, 'opaque_same_timestamp_id']);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull());
  },
);
