// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { I18nProvider, useI18n } from './i18n';
import { ProfilePanel } from './ProfilePanel';

let linked = false;
let unlinkPending = false;
let websiteLocale = 'en';
let notificationLocale = 'ru';
let mfaEnabled = false;
const writes: { path: string; body: Record<string, unknown> }[] = [];
function profile() {
  return {
    profile: {
      user_id: '10000000-0000-4000-8000-000000000001',
      email: 'u@example.test',
      display_name: 'Initial',
      avatar_url: null,
      phone_number: null,
      website_locale: websiteLocale,
      notification_locale: notificationLocale,
      telegram_linked: linked,
      binding_version: 1,
    },
    notification_settings: {
      email_login_alerts: true,
      email_security_alerts: true,
      email_subscription: false,
      telegram_login_alerts: false,
      telegram_security_alerts: false,
      telegram_subscription: false,
      telegram_trading: false,
    },
    capabilities: { telegram: true },
  };
}
beforeEach(() => {
  linked = false;
  unlinkPending = false;
  websiteLocale = 'en';
  notificationLocale = 'ru';
  mfaEnabled = false;
  writes.length = 0;
  api.setSession('profile-test', 'csrf');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      const path = url.pathname;
      const body = JSON.parse(String(options.body ?? '{}')) as Record<string, unknown>;
      let response: unknown;
      if (options.method !== 'GET') writes.push({ path, body });
      if (path.endsWith('/telegram/link'))
        response = {
          link_token: 'one-use',
          bot_url: 'https://t.me/example_bot?start=one-use',
          expires_at: '2026-10-24T12:00:00Z',
        };
      else if (path.endsWith('/telegram/confirm')) {
        linked = body.link_token === 'one-use';
        response = {
          linked,
          binding_version: 2,
          link_pending: false,
          candidate_ready: false,
          unlink_pending: false,
        };
      } else if (path.endsWith('/telegram/unlink')) {
        unlinkPending = true;
        response = { status: 'pending', expires_at: '2026-10-24T12:00:00Z' };
      } else if (path.endsWith('/telegram'))
        response = {
          linked,
          binding_version: 1,
          link_pending: !linked,
          candidate_ready: !linked,
          unlink_pending: unlinkPending,
        };
      else if (path.endsWith('/overview'))
        response = {
          ...Object.fromEntries(
            ['orders', 'subscriptions', 'referrals'].map((key) => [
              key,
              { status: 'unavailable', data: null },
            ]),
          ),
          account: {
            status: 'available',
            data: {
              user: {
                id: '10000000-0000-4000-8000-000000000001',
                email: 'u@example.test',
                is_verified: true,
                mfa_enabled: mfaEnabled,
                mfa_verified: false,
                roles: [],
                permissions: [],
              },
              session_id: '10000000-0000-4000-8000-000000000002',
              mfa_verified: false,
            },
          },
        };
      else if (path.endsWith('/notifications')) response = [];
      else if (path.endsWith('/auth/reauth')) response = { reauthenticated: true };
      else {
        if (typeof body.website_locale === 'string') websiteLocale = body.website_locale;
        if (typeof body.notification_locale === 'string')
          notificationLocale = body.notification_locale;
        response = profile();
      }
      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function LocaleSwitch() {
  const { setLocale } = useI18n();
  return <button onClick={() => setLocale('ru')}>Switch language</button>;
}
it('keeps a bot candidate unlinked until the same website session confirms and unlink waits for the bot', async () => {
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <ProfilePanel />
    </I18nProvider>,
  );
  await screen.findByLabelText('Display name');
  await user.click(screen.getByRole('button', { name: 'Start Telegram link' }));
  expect(screen.queryByText('Telegram linked')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Refresh Telegram status' }));
  await user.click(await screen.findByRole('button', { name: 'Confirm Telegram link' }));
  await screen.findByText('Telegram linked');
  expect(writes.find((write) => write.path.endsWith('/confirm'))?.body).toEqual({
    link_token: 'one-use',
  });
  expect(screen.queryByRole('button', { name: 'Request Telegram unlink' })).toBeNull();
  await user.type(screen.getByLabelText('Current password'), 'password');
  await user.click(screen.getByRole('button', { name: 'Confirm password' }));
  await user.click(screen.getByRole('button', { name: 'Request Telegram unlink' }));
  await screen.findByText(
    'Confirm unlink in Telegram. The binding remains active until the bot confirms.',
  );
  expect(screen.getByText('Telegram linked')).toBeTruthy();
  linked = false;
  unlinkPending = false;
  await user.click(screen.getByRole('button', { name: 'Refresh Telegram status' }));
  await screen.findByText('Telegram not linked');
  expect(screen.queryByText('Telegram linked')).toBeNull();
});
it('keeps notification locale separate and preserves unsaved profile fields when website language changes', async () => {
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <LocaleSwitch />
      <ProfilePanel />
    </I18nProvider>,
  );
  const name = await screen.findByLabelText('Display name');
  await user.clear(name);
  await user.type(name, 'Unsaved draft');
  await user.click(screen.getByRole('button', { name: 'Switch language' }));
  expect((screen.getByLabelText('Отображаемое имя') as HTMLInputElement).value).toBe(
    'Unsaved draft',
  );
  expect((screen.getByLabelText('Язык уведомлений') as HTMLSelectElement).value).toBe('ru');
  await user.selectOptions(screen.getByLabelText('Язык уведомлений'), 'en');
  await user.click(screen.getByRole('button', { name: 'Сохранить язык уведомлений' }));
  await waitFor(() =>
    expect(writes.some((write) => write.body.notification_locale === 'en')).toBe(true),
  );
  expect(
    writes.find((write) => write.body.notification_locale === 'en')?.body.website_locale,
  ).toBeUndefined();
});
it('persists website language without changing notification locale', async () => {
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <ProfilePanel />
    </I18nProvider>,
  );
  await screen.findByLabelText('Display name');
  await user.selectOptions(screen.getByLabelText('Website language'), 'ru');
  await user.click(screen.getByRole('button', { name: 'Save website language' }));
  await screen.findByLabelText('Отображаемое имя');
  expect(writes.find((write) => write.body.website_locale === 'ru')?.body).toEqual({
    website_locale: 'ru',
  });
  expect(notificationLocale).toBe('ru');
});
it('requires a TOTP or recovery code for MFA-enabled unlink reauthentication', async () => {
  linked = true;
  mfaEnabled = true;
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <ProfilePanel />
    </I18nProvider>,
  );
  await user.type(await screen.findByLabelText('Current password'), 'password');
  await user.click(screen.getByRole('button', { name: 'Confirm password' }));
  expect(writes.find((write) => write.path.endsWith('/auth/reauth'))).toBeUndefined();
  expect(screen.queryByRole('button', { name: 'Request Telegram unlink' })).toBeNull();
  await user.type(screen.getByLabelText('MFA or recovery code'), 'recovery-once');
  await user.click(screen.getByRole('button', { name: 'Confirm password' }));
  await screen.findByRole('button', { name: 'Request Telegram unlink' });
  expect(writes.find((write) => write.path.endsWith('/auth/reauth'))?.body).toEqual({
    password: 'password',
    code: 'recovery-once',
  });
});
