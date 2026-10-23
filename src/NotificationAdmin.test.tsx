// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthSession } from './auth';
import { api } from './api';
import { I18nProvider, useI18n } from './i18n';
import { NotificationAdmin } from './NotificationAdmin';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const auth = (permissions: string[]): AuthSession => ({
  session_id: 's1',
  csrf_token: 'csrf',
  user: {
    id: 'u1',
    email: 's@example.test',
    is_verified: true,
    mfa_enabled: true,
    roles: ['SUPPORT'],
    permissions,
  },
});
function fixture() {
  api.setSession('notification-admin-test', 'csrf');
  const mutations: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      const template = {
        event_type: 'subscription.changed',
        version: 1,
        locales: {
          en: { subject: 'Started', body: 'Active subscription' },
          ru: { subject: 'Начало', body: 'Подписка активна' },
        },
      };
      let response: unknown;
      if (options.method !== 'GET') {
        const body = JSON.parse(String(options.body));
        mutations.push({ path: url.pathname, body });
        response =
          options.method === 'PUT'
            ? { ...template, version: 2, locales: body.locales }
            : { status: 'queued' };
      } else if (url.pathname.endsWith('/templates')) response = { items: [template] };
      else
        response = [
          {
            id: '30000000-0000-4000-8000-000000000001',
            user_id: '10000000-0000-4000-8000-000000000001',
            channel: 'email',
            status: 'failed',
            attempts: 3,
            created_at: '2026-10-24T10:00:00Z',
            next_attempt_at: '2026-10-24T11:00:00Z',
            last_error: 'SECRET_PROVIDER_DETAILS',
            message_id: 'message-1',
            delivered_at: null,
            ambiguous: false,
          },
          {
            id: '30000000-0000-4000-8000-000000000002',
            user_id: '10000000-0000-4000-8000-000000000001',
            channel: 'email',
            status: 'sent',
            attempts: 1,
            created_at: '2026-10-24T10:00:00Z',
            next_attempt_at: '2026-10-24T11:00:00Z',
            last_error: null,
            message_id: 'message-2',
            delivered_at: '2026-10-24T11:00:00Z',
            ambiguous: false,
          },
        ];
      return new Response(JSON.stringify(response));
    }),
  );
  return mutations;
}
it('keeps support read-only and omits raw provider delivery errors', async () => {
  fixture();
  render(
    <I18nProvider initialLocale="en">
      <NotificationAdmin auth={auth(['notifications:read'])} />
    </I18nProvider>,
  );
  await screen.findByText('subscription.changed');
  expect(screen.queryByText('SECRET_PROVIDER_DETAILS')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Publish template' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Replay failed delivery' })).toBeNull();
});
it('publishes both locale revisions atomically and only replays failed deliveries with a reason', async () => {
  const mutations = fixture();
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <NotificationAdmin
        auth={auth(['notifications:read', 'notifications:templates:write', 'notifications:replay'])}
      />
    </I18nProvider>,
  );
  const subject = await screen.findByLabelText('EN subject');
  await user.clear(subject);
  await user.type(subject, 'Updated');
  await user.click(screen.getByRole('button', { name: 'Publish template' }));
  expect(mutations[0].body).toEqual({
    expected_version: 1,
    locales: {
      en: { subject: 'Updated', body: 'Active subscription' },
      ru: { subject: 'Начало', body: 'Подписка активна' },
    },
  });
  expect(screen.getAllByRole('button', { name: 'Replay failed delivery' })).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Replay failed delivery' }));
  expect(mutations).toHaveLength(1);
  await user.type(screen.getByLabelText('Replay reason'), 'Provider recovered');
  await user.click(screen.getByRole('button', { name: 'Replay failed delivery' }));
  expect(mutations[1]).toEqual({
    path: '/api/v1/admin/deliveries/30000000-0000-4000-8000-000000000001/replay',
    body: { reason: 'Provider recovered' },
  });
});
function SwitchLocale() {
  const { setLocale } = useI18n();
  return <button onClick={() => setLocale('ru')}>Switch locale</button>;
}
it('preserves unsaved EN and RU template edits across website language changes', async () => {
  fixture();
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <SwitchLocale />
      <NotificationAdmin auth={auth(['notifications:read', 'notifications:templates:write'])} />
    </I18nProvider>,
  );
  const subject = await screen.findByLabelText('EN subject');
  await user.clear(subject);
  await user.type(subject, 'Unsaved subject');
  await user.click(screen.getByRole('button', { name: 'Switch locale' }));
  expect((screen.getByLabelText('EN тема') as HTMLInputElement).value).toBe('Unsaved subject');
  expect((screen.getByLabelText('RU текст') as HTMLTextAreaElement).value).toBe('Подписка активна');
});
