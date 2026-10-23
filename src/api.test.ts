import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { ApiClient } from './api';

let server: Server;
let origin: string;
let expired = 0;
beforeAll(async () => {
  server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/auth/csrf')
      return res.end(JSON.stringify({ csrf_token: 'browser-csrf' }));
    if (req.url === '/api/v1/auth/logout' && req.method === 'POST') {
      if (req.headers['x-csrf-token'] !== 'browser-csrf') {
        res.statusCode = 403;
        return res.end('{"error":"CSRF missing","code":"csrf"}');
      }
      let body = '';
      for await (const part of req) body += part;
      if (body !== '{}') {
        res.statusCode = 400;
        return res.end('{"error":"Wrong payload"}');
      }
      return res.end('{"revoked":true}');
    }
    res.statusCode = 401;
    res.end('{"error":"Session revoked","code":"session_expired"}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test listener');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.close();
  await once(server, 'close');
});
describe('cookie API transport', () => {
  it('bootstraps CSRF before an actual mutation and sends the JSON payload', async () => {
    const client = new ApiClient(origin, () => expired++);
    expect(await client.request('/api/v1/auth/logout', { method: 'POST', body: {} })).toEqual({
      revoked: true,
    });
  });
  it('invalidates the UI session after server revocation instead of accepting stale auth', async () => {
    const client = new ApiClient(origin, () => expired++);
    await expect(client.request('/api/v1/users/me')).rejects.toMatchObject({
      status: 401,
      code: 'session_expired',
      message: 'Session revoked',
    });
    expect(expired).toBe(1);
  });
  it('rejects an absolute external API path before exposing cookies or CSRF', async () => {
    const client = new ApiClient(origin);
    await expect(
      client.request('https://evil.test/steal', { method: 'POST', body: {} }),
    ).rejects.toThrow();
  });
});
