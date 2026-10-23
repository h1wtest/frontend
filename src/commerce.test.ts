// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  CommandAttempts,
  formatMoney,
  publishedOffers,
  assertOwner,
  paymentStage,
} from './commerce';

describe('exact user commerce decisions', () => {
  it('groups exact decimals without rounding provider quantities or losing micro-units', () => {
    expect(formatMoney('9000000.000001', 'en')).toBe('9,000,000.000001');
    expect(formatMoney('0.123456789012345678', 'en')).toBe('0.123456789012345678');
    expect(formatMoney('1234.000001', 'ru')).toBe('1\u00a0234,000001');
  });
  it('reuses an ambiguous command key but gives changed payloads independent identities', () => {
    const attempts = new CommandAttempts();
    const first = attempts.body('checkout', { offer_id: 'offer', network: 'USDTBSC' });
    expect(attempts.body('checkout', { offer_id: 'offer', network: 'USDTBSC' })).toEqual(first);
    expect(
      attempts.body('checkout', { offer_id: 'offer', network: 'USDTTRC20' }).idempotency_key,
    ).not.toBe(first.idempotency_key);
    attempts.complete('checkout');
    expect(
      attempts.body('checkout', { offer_id: 'offer', network: 'USDTBSC' }).idempotency_key,
    ).not.toBe(first.idempotency_key);
  });
  it('never equates accepted money or provider progress with fulfilled access', () => {
    expect(paymentStage('PAYMENT_ACCEPTED')).toBe('accepted');
    expect(paymentStage('FULFILLMENT_PENDING')).toBe('accepted');
    expect(paymentStage('FULFILLED')).toBe('fulfilled');
    expect(paymentStage('REVIEW_REQUIRED')).toBe('review');
    expect(paymentStage('PAYMENT_PENDING')).toBe('pending');
  });
  it('rejects foreign owner results rather than rendering another account', () => {
    expect(() => assertOwner({ user_id: 'other' }, 'self')).toThrow();
    expect(() => assertOwner({ user_id: 'self' }, 'self')).not.toThrow();
  });
  it('offers only the current published revision and keeps exact price strings', () => {
    const revision = {
      id: 'r1',
      plan_id: 'p',
      version: 1,
      state: 'PUBLISHED' as const,
      name: { en: 'Pro', ru: 'Про' },
      description: { en: 'Description', ru: 'Описание' },
      features: [],
      offers: [
        {
          id: 'o',
          revision_id: 'r1',
          duration_days: 30,
          price: '12.000001',
          currency: 'USDT' as const,
        },
      ],
    };
    const result = publishedOffers({
      products: [{ id: 'product', key: 'product' }],
      plans: [
        {
          id: 'p',
          product_id: 'product',
          key: 'pro',
          upgrade_rank: 1,
          current_revision_id: 'r1',
          version: 1,
        },
      ],
      revisions: [
        revision,
        { ...revision, id: 'old' },
        { ...revision, id: 'draft', state: 'DRAFT' },
      ],
    });
    expect(result.map((item) => item.offer.id)).toEqual(['o']);
    expect(result[0].offer.price).toBe('12.000001');
  });
});
