// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { exportJWK, generateKeyPair, SignJWT, type GenerateKeyPairResult } from 'jose';
import { OidcConsumer } from './oidc';

let server: Server;
let base: string;
let key: GenerateKeyPairResult;
let other: GenerateKeyPairResult;
let nonce = '';
let fault = '';
let exchanges = 0;
let refreshes = 0;
interface Gate {
  promise: Promise<void>;
  resolve: () => void;
}
let paused: { started: Gate; resume: Gate } | undefined;
const issuer = 'https://identity.test';
const store = new Map<string, string>();
const storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
};
const transport: typeof fetch = (url, options) =>
  fetch(base + new URL(String(url)).pathname, options);
beforeAll(async () => {
  key = await generateKeyPair('RS256');
  other = await generateKeyPair('RS256');
  const jwk = await exportJWK(key.publicKey);
  server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/.well-known/openid-configuration')
      return res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: issuer + '/oauth/authorize',
          token_endpoint: issuer + '/oauth/token',
          jwks_uri: issuer + '/jwks',
          userinfo_endpoint: issuer + '/oauth/userinfo',
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        }),
      );
    if (req.url === '/jwks')
      return res.end(
        JSON.stringify({ keys: [{ ...jwk, kid: 'active', alg: 'RS256', use: 'sig' }] }),
      );
    if (req.url === '/oauth/userinfo')
      return res.end('{"sub":"user-1","email":"user@example.test"}');
    if (req.url !== '/oauth/token') {
      res.statusCode = 404;
      return res.end('{}');
    }
    let raw = '';
    for await (const part of req) raw += part;
    const body = new URLSearchParams(raw);
    const refreshing = body.get('grant_type') === 'refresh_token';
    if (refreshing) refreshes++;
    else exchanges++;
    if (paused) {
      const gate = paused;
      paused = undefined;
      gate.started.resolve();
      await gate.resume.promise;
    }
    if (
      body.get('client_id') !== 'web-demo' ||
      (!refreshing &&
        (!body.get('code_verifier') || body.get('redirect_uri') !== issuer + '/oidc/callback'))
    ) {
      res.statusCode = 400;
      return res.end('{"error":"invalid_grant"}');
    }
    if (refreshing && body.get('refresh_token') !== 'refresh-1') {
      res.statusCode = 400;
      return res.end('{"error":"invalid_grant"}');
    }
    const id = await new SignJWT({
      ...(fault === 'access' ? {} : { nonce: fault === 'nonce' ? 'wrong' : nonce }),
      token_use: fault === 'access' ? 'access' : 'id',
      email: 'user@example.test',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'active' })
      .setSubject(fault === 'subject' ? 'other-user' : 'user-1')
      .setIssuer(fault === 'issuer' ? 'https://evil.test' : issuer)
      .setAudience(fault === 'audience' ? 'another-client' : 'web-demo')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(fault === 'signature' ? other.privateKey : key.privateKey);
    res.end(
      JSON.stringify({
        access_token: 'access',
        token_type: 'Bearer',
        expires_in: 300,
        refresh_token: refreshing ? 'refresh-2' : 'refresh-1',
        id_token: id,
        scope: 'openid email profile offline_access',
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.close();
  await once(server, 'close');
});
beforeEach(() => {
  store.clear();
  fault = '';
  exchanges = 0;
  refreshes = 0;
});
async function transaction() {
  const client = new OidcConsumer(issuer, storage, transport);
  const authorization = new URL(await client.begin());
  nonce = authorization.searchParams.get('nonce')!;
  const callback = new URL(issuer + '/oidc/callback');
  callback.searchParams.set('code', 'code-1');
  callback.searchParams.set('state', authorization.searchParams.get('state')!);
  return { client, authorization, callback };
}
describe('standards consumer', () => {
  it('uses S256, validates a signed identity, binds userinfo and rotates refresh in memory', async () => {
    const { client, authorization, callback } = await transaction();
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('code_challenge')).toHaveLength(43);
    expect((await client.complete(callback)).claims.sub).toBe('user-1');
    expect((await client.refresh()).userinfo.email).toBe('user@example.test');
    expect(refreshes).toBe(1);
    expect(store.size).toBe(0);
    await expect(client.complete(callback)).rejects.toThrow();
  });
  it.each(['nonce', 'audience', 'issuer', 'signature', 'access'])(
    'rejects a token with invalid %s before showing a proof',
    async (faultName) => {
      const { client, callback } = await transaction();
      fault = faultName;
      await expect(client.complete(callback)).rejects.toThrow();
      await expect(client.refresh()).rejects.toThrow();
    },
  );
  it('rejects swapped state without exchanging the code', async () => {
    const { client, callback } = await transaction();
    callback.searchParams.set('state', 'attacker');
    await expect(client.complete(callback)).rejects.toThrow();
    expect(exchanges).toBe(0);
  });
  it('rejects a refresh identity changing the authenticated subject', async () => {
    const { client, callback } = await transaction();
    await client.complete(callback);
    fault = 'subject';
    await expect(client.refresh()).rejects.toThrow();
    await expect(client.refresh()).rejects.toThrow();
  });
  it('rejects a validly signed access JWT substituted for a refreshed ID token', async () => {
    const { client, callback } = await transaction();
    await client.complete(callback);
    fault = 'access';
    await expect(client.refresh()).rejects.toThrow();
    await expect(client.refresh()).rejects.toThrow();
  });
  it.each(['complete', 'refresh'] as const)(
    'clear invalidates pending %s and cannot resurrect tokens',
    async (operation) => {
      const { client, callback } = await transaction();
      if (operation === 'refresh') await client.complete(callback);
      const gate = {
        started: Promise.withResolvers<void>(),
        resume: Promise.withResolvers<void>(),
      };
      paused = gate;
      const pending = operation === 'refresh' ? client.refresh() : client.complete(callback);
      const rejection = expect(pending).rejects.toThrow();
      await gate.started.promise;
      client.clear();
      gate.resume.resolve();
      await rejection;
      await expect(client.refresh()).rejects.toThrow();
      expect(store.size).toBe(0);
    },
  );
});
