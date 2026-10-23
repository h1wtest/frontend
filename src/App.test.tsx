// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { act, cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppRoot from './App';
import { I18nProvider } from './i18n';
const App = () => (
  <I18nProvider initialLocale="ru">
    <AppRoot />
  </I18nProvider>
);
let server: Server;
let base: string;
let account = 'A';
interface Gate {
  promise: Promise<void>;
  resolve: () => void;
}
let pausedMe: { started: Gate; resume: Gate; unauthorized?: boolean } | undefined;
let observedMe: Promise<void> | undefined;
const nativeFetch = globalThis.fetch;
beforeAll(async () => {
  server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/v1/auth/me') {
      const authenticatedAccount = account;
      let unauthorized = !authenticatedAccount;
      if (pausedMe) {
        const gate = pausedMe;
        pausedMe = undefined;
        gate.started.resolve();
        await gate.resume.promise;
        unauthorized ||= gate.unauthorized ?? false;
      }
      if (unauthorized) {
        res.statusCode = 401;
        return res.end('{"error":"Unauthenticated","code":"unauthenticated"}');
      }
      return res.end(
        JSON.stringify({
          user: {
            id:
              authenticatedAccount === 'A'
                ? '01900000-0000-7000-8000-000000000001'
                : '01900000-0000-7000-8000-000000000002',
            email: authenticatedAccount + '@example.test',
            is_verified: true,
            mfa_enabled: false,
            roles: [],
            permissions: [],
          },
          session_id:
            authenticatedAccount === 'A'
              ? '01900000-0000-7000-8000-000000000003'
              : '01900000-0000-7000-8000-000000000004',
          csrf_token: 'csrf',
        }),
      );
    }
    if (req.url === '/api/v1/auth/csrf') return res.end('{"csrf_token":"csrf"}');
    if (req.url === '/api/v1/auth/login') {
      account = 'A';
      return res.end('{"status":"authenticated"}');
    }
    if (req.url === '/api/v1/users/me/telegram')
      return res.end(
        '{"linked":false,"binding_version":0,"link_pending":false,"candidate_ready":false,"unlink_pending":false}',
      );
    if (req.url === '/api/v1/users/me')
      return res.end(
        JSON.stringify({
          profile: {
            user_id:
              account === 'A'
                ? '01900000-0000-7000-8000-000000000001'
                : '01900000-0000-7000-8000-000000000002',
            email: account + '@example.test',
            display_name: 'Name ' + account,
            avatar_url: null,
            phone_number: null,
            website_locale: 'ru',
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
        }),
      );
    if (req.url === '/api/v1/auth/sessions') return res.end('[]');
    if (req.url === '/api/v1/auth/mfa/setup')
      return res.end(
        '{"secret":"ACCOUNT-A-SECRET","otpauth_uri":"otpauth://totp/A?secret=A","recovery_codes":["A-recovery"]}',
      );
    if (req.url === '/api/v1/auth/password/reset') {
      let raw = '';
      for await (const part of req) raw += part;
      const body = JSON.parse(raw);
      if (body.password === 'new-password-123') {
        if (body.token === 'reset-once') {
          account = '';
          return res.end('{}');
        }
        if (body.token === 'reset-other-account') return res.end('{}');
      }
    }
    res.statusCode = 400;
    res.end('{"error":"Invalid request"}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  base = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  account = 'A';
  pausedMe = undefined;
  observedMe = undefined;
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.stubGlobal('fetch', ((input, options) => {
    const url = new URL(String(input));
    const request = nativeFetch(base + url.pathname + url.search, options);
    if (url.pathname === '/api/v1/auth/me' && pausedMe)
      observedMe = request.then((response) => response.clone().text()).then(() => {});
    return request;
  }) as typeof fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  server.close();
  await once(server, 'close');
});
it('routes a reset link while already authenticated and immediately scrubs the one-time token', async () => {
  window.history.replaceState(null, '', '/?token=reset-once');
  const user = userEvent.setup();
  render(<App />);
  const token = (await screen.findByLabelText('Одноразовый токен из письма')) as HTMLInputElement;
  expect(token.value).toBe('reset-once');
  expect(window.location.search).toBe('');
  await user.type(screen.getByLabelText('Новый пароль'), 'new-password-123');
  await user.click(screen.getByRole('button', { name: 'Сбросить пароль' }));
  await screen.findByRole('button', { name: 'Войти' });
});
it('replaces cached profile fields when another tab switches the authoritative session', async () => {
  render(<App />);
  await waitFor(() =>
    expect((screen.getByLabelText('Отображаемое имя') as HTMLInputElement).value).toBe('Name A'),
  );
  account = 'B';
  fireEvent.focus(window);
  await waitFor(() =>
    expect((screen.getByLabelText('Отображаемое имя') as HTMLInputElement).value).toBe('Name B'),
  );
  expect(screen.queryByText('A@example.test')).toBeNull();
});
it('unmounts prior-account MFA secrets on a cross-tab session transition', async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByLabelText('Отображаемое имя');
  await user.click(screen.getByRole('button', { name: 'Безопасность' }));
  await user.click(screen.getByRole('button', { name: 'Настроить MFA' }));
  await screen.findByText('ACCOUNT-A-SECRET');
  account = 'B';
  fireEvent.focus(window);
  await screen.findByText('B@example.test');
  expect(screen.queryByText('ACCOUNT-A-SECRET')).toBeNull();
  expect(screen.queryByText('A-recovery')).toBeNull();
});
it('preserves a pending PKCE transaction across anonymous boot and the subsequent login session', async () => {
  const pending = '{"verifier":"pkce-verifier","state":"state","nonce":"nonce","created":1}';
  sessionStorage.setItem('sso.oidc.transaction', pending);
  account = '';
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('button', { name: 'Войти' });
  expect(sessionStorage.getItem('sso.oidc.transaction')).toBe(pending);
  await user.type(screen.getByLabelText('Email'), 'A@example.test');
  await user.type(screen.getByLabelText('Пароль'), 'valid-password');
  await user.click(screen.getByRole('button', { name: 'Войти' }));
  await screen.findByLabelText('Отображаемое имя');
  expect(sessionStorage.getItem('sso.oidc.transaction')).toBe(pending);
});
it('never restores authenticated state from a delayed me response after session invalidation', async () => {
  render(<App />);
  await screen.findByLabelText('Отображаемое имя');
  const gate = { started: Promise.withResolvers<void>(), resume: Promise.withResolvers<void>() };
  pausedMe = gate;
  fireEvent.focus(window);
  await gate.started.promise;
  fireEvent(window, new Event('session-expired'));
  gate.resume.resolve();
  await observedMe;
  await screen.findByRole('button', { name: 'Войти' });
  await waitFor(() => expect(screen.queryByLabelText('Отображаемое имя')).toBeNull());
  expect(screen.queryByText('A@example.test')).toBeNull();
});
it('does not let a delayed old-session 401 expire the newly accepted account', async () => {
  render(<App />);
  await screen.findByLabelText('Отображаемое имя');
  const gate = {
    started: Promise.withResolvers<void>(),
    resume: Promise.withResolvers<void>(),
    unauthorized: true,
  };
  pausedMe = gate;
  fireEvent.focus(window);
  await gate.started.promise;
  account = 'B';
  fireEvent.focus(window);
  await waitFor(() =>
    expect((screen.getByLabelText('Отображаемое имя') as HTMLInputElement).value).toBe('Name B'),
  );
  await act(async () => {
    gate.resume.resolve();
    await observedMe;
  });
  await waitFor(() => {
    expect(screen.getByText('B@example.test', { selector: 'header span' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Войти' })).toBeNull();
    expect(screen.queryByText('A@example.test')).toBeNull();
  });
});
it('reconciles an unrelated live session after resetting another account instead of inventing logout', async () => {
  window.history.replaceState(null, '', '/?token=reset-other-account');
  const user = userEvent.setup();
  render(<App />);
  await screen.findByLabelText('Одноразовый токен из письма');
  await user.type(screen.getByLabelText('Новый пароль'), 'new-password-123');
  const gate = { started: Promise.withResolvers<void>(), resume: Promise.withResolvers<void>() };
  pausedMe = gate;
  await user.click(screen.getByRole('button', { name: 'Сбросить пароль' }));
  await gate.started.promise;
  expect(screen.getByRole('status').textContent).toContain('Проверка сессии');
  expect(screen.queryByLabelText('Отображаемое имя')).toBeNull();
  expect(screen.queryByLabelText('Одноразовый токен из письма')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Войти' })).toBeNull();
  await act(async () => {
    gate.resume.resolve();
    await observedMe;
  });
  await waitFor(() =>
    expect((screen.getByLabelText('Отображаемое имя') as HTMLInputElement).value).toBe('Name A'),
  );
  expect(screen.queryByLabelText('Одноразовый токен из письма')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Войти' })).toBeNull();
  fireEvent.focus(window);
  await waitFor(() =>
    expect(screen.getByText('A@example.test', { selector: 'header span' })).toBeTruthy(),
  );
});
it('keeps reset reconciliation pending when an older independently delayed session check finishes', async () => {
  window.history.replaceState(null, '', '/?token=reset-other-account');
  const user = userEvent.setup();
  render(<App />);
  await screen.findByLabelText('Одноразовый токен из письма');
  await user.type(screen.getByLabelText('Новый пароль'), 'new-password-123');
  const previous = {
    started: Promise.withResolvers<void>(),
    resume: Promise.withResolvers<void>(),
  };
  pausedMe = previous;
  fireEvent.focus(window);
  await previous.started.promise;
  const previousResponse = observedMe;
  const reconciliation = {
    started: Promise.withResolvers<void>(),
    resume: Promise.withResolvers<void>(),
  };
  pausedMe = reconciliation;
  await user.click(screen.getByRole('button', { name: 'Сбросить пароль' }));
  await reconciliation.started.promise;
  const reconciliationResponse = observedMe;
  await act(async () => {
    previous.resume.resolve();
    await previousResponse;
  });
  expect(screen.getByRole('status').textContent).toContain('Проверка сессии');
  expect(screen.queryByRole('button', { name: 'Войти' })).toBeNull();
  expect(screen.queryByLabelText('Отображаемое имя')).toBeNull();
  expect(screen.queryByLabelText('Одноразовый токен из письма')).toBeNull();
  await act(async () => {
    reconciliation.resume.resolve();
    await reconciliationResponse;
  });
  await waitFor(() =>
    expect((screen.getByLabelText('Отображаемое имя') as HTMLInputElement).value).toBe('Name A'),
  );
});
it('finishes the loading boundary when an explicit session expiry supersedes a pending bootstrap', async () => {
  const gate = { started: Promise.withResolvers<void>(), resume: Promise.withResolvers<void>() };
  pausedMe = gate;
  render(<App />);
  await gate.started.promise;
  fireEvent(window, new Event('session-expired'));
  await screen.findByRole('button', { name: 'Войти' });
  expect(screen.queryByText('Проверка сессии…')).toBeNull();
  await act(async () => {
    gate.resume.resolve();
    await observedMe;
  });
  expect(screen.queryByLabelText('Отображаемое имя')).toBeNull();
  expect(screen.getByRole('button', { name: 'Войти' })).toBeTruthy();
});
it('keeps unsaved settings values when the website language changes without changing account', async () => {
  const user = userEvent.setup();
  render(<App />);
  const input = await screen.findByLabelText('Отображаемое имя');
  await user.clear(input);
  await user.type(input, 'Unsaved display name');
  await user.selectOptions(screen.getByLabelText('Язык интерфейса'), 'en');
  expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe(
    'Unsaved display name',
  );
  expect(screen.getByText('A@example.test', { selector: 'header span' })).toBeTruthy();
});
