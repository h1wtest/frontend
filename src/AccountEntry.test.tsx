// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountEntry } from './AccountEntry';
import { ApiClient } from './api';

let server: Server;
let origin: string;
beforeAll(async () => {
  server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/auth/csrf') return res.end('{"csrf_token":"csrf"}');
    let raw = '';
    for await (const part of req) raw += part;
    const body = JSON.parse(raw || '{}');
    if (
      req.url === '/api/v1/auth/login' &&
      body.email === 'user@example.test' &&
      body.password === 'correct-password' &&
      req.headers['x-csrf-token'] === 'csrf'
    )
      return res.end('{"status":"mfa_required","challenge_id":"challenge-1"}');
    if (
      req.url === '/api/v1/auth/mfa/verify-login' &&
      body.challenge_id === 'challenge-1' &&
      body.code === 'recovery-once'
    )
      return res.end(
        '{"status":"authenticated","user":{"id":"1","email":"user@example.test","is_verified":true,"mfa_enabled":true,"roles":[],"permissions":[]},"session_id":"s1"}',
      );
    res.statusCode = 400;
    res.end('{"error":"Incorrect credentials","code":"invalid_credentials"}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(cleanup);
afterAll(async () => {
  server.close();
  await once(server, 'close');
});
it('finishes MFA using the server challenge and accepts a recovery code without persisting a bearer token', async () => {
  const user = userEvent.setup();
  let authenticated = false;
  render(
    <AccountEntry
      client={new ApiClient(origin)}
      authenticated={async () => {
        authenticated = true;
      }}
    />,
  );
  await user.type(screen.getByLabelText('Email'), 'user@example.test');
  await user.type(screen.getByLabelText('Пароль'), 'correct-password');
  await user.click(screen.getByRole('button', { name: 'Войти' }));
  await user.type(await screen.findByLabelText('Код MFA или резервный код'), 'recovery-once');
  await user.click(screen.getByRole('button', { name: 'Подтвердить вход' }));
  await screen.findByText('Вход выполнен.');
  expect(authenticated).toBe(true);
  expect(localStorage.length).toBe(0);
});
it('keeps an invalid login anonymous and presents the real server error for correction', async () => {
  const user = userEvent.setup();
  let authenticated = false;
  render(
    <AccountEntry
      client={new ApiClient(origin)}
      authenticated={async () => {
        authenticated = true;
      }}
    />,
  );
  await user.type(screen.getByLabelText('Email'), 'wrong@example.test');
  await user.type(screen.getByLabelText('Пароль'), 'wrong-password');
  await user.click(screen.getByRole('button', { name: 'Войти' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Incorrect credentials');
  expect(authenticated).toBe(false);
  expect((screen.getByRole('button', { name: 'Войти' }) as HTMLButtonElement).disabled).toBe(false);
});
