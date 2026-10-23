// SPDX-License-Identifier: MIT
import { expect, it } from 'vitest';
import { decodeWire, validateCommand } from './wire';
it('rejects duplicate wire keys instead of accepting a changed monetary field', () => {
  expect(() =>
    decodeWire('/api/v1/orders', 'GET', '{"items":[],"items":[{}],"next_cursor":null}'),
  ).toThrow();
});
it('rejects a checkout price supplied by the browser before sending the owner command', () => {
  expect(() =>
    validateCommand('/api/v1/orders', 'POST', {
      offer_id: '01900000-0000-7000-8000-000000000001',
      kind: 'INITIAL',
      network: 'USDTBSC',
      idempotency_key: '01900000-0000-7000-8000-000000000002',
      amount: '0.000001',
    }),
  ).toThrow();
});
it('keeps existing identity wire outside the new business registry without weakening JSON parsing', () => {
  expect(decodeWire('/api/v1/auth/me', 'GET', '{"session_id":"s"}')).toEqual({ session_id: 's' });
});
