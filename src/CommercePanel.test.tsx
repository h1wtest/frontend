// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommercePanel } from './CommercePanel';
import { I18nProvider } from './i18n';
import { api } from './api';
import { commerceMessages } from './commerce-resources';
import type { AuthSession } from './auth';

const auth: AuthSession = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'self@example.test',
    is_verified: true,
    mfa_enabled: false,
    mfa_verified: false,
    roles: [],
    permissions: [],
  },
  session_id: '00000000-0000-4000-8000-000000000004',
  csrf_token: 'csrf',
};
const snapshot = {
  product_id: '00000000-0000-4000-8000-000000000010',
  plan_id: '00000000-0000-4000-8000-000000000011',
  plan_key: 'pro',
  upgrade_rank: 2,
  revision_id: '00000000-0000-4000-8000-000000000012',
  offer_id: '00000000-0000-4000-8000-000000000013',
  duration_days: 30,
  price: '30.000000',
  currency: 'USDT',
  name: { en: 'Pro', ru: 'Про' },
  features: [],
  snapshot_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};
const order = {
  id: '00000000-0000-4000-8000-000000000014',
  user_id: '00000000-0000-4000-8000-000000000001',
  product_id: '00000000-0000-4000-8000-000000000010',
  subscription_id: null,
  action_id: '00000000-0000-4000-8000-000000000015',
  kind: 'INITIAL',
  amount: '30.000000',
  currency: 'USDT',
  state: 'PAYMENT_ACCEPTED',
  version: 2,
  created_at: '2026-10-24T00:00:00Z',
  updated_at: '2026-10-24T00:01:00Z',
  payment_attempt: {
    id: '00000000-0000-4000-8000-000000000016',
    state: 'ACCEPTED',
    provider_payment_id: '12345678901234567890',
    provider_root_id: null,
    network: 'USDTBSC',
    pay_address: 'wallet',
    pay_amount: '30.000000',
    actually_paid: '30.000000',
    provider_status: 'finished',
    expires_at: null,
    next_reconcile_at: null,
  },
  fulfillment_error: null,
  offer_snapshot: snapshot,
  commission_quote_id: null,
  accepted_at: '2026-10-24T00:01:00Z',
};
const catalog = {
  products: [{ id: '00000000-0000-4000-8000-000000000010', key: 'Product' }],
  plans: [
    {
      id: '00000000-0000-4000-8000-000000000011',
      product_id: '00000000-0000-4000-8000-000000000010',
      key: 'pro',
      upgrade_rank: 2,
      current_revision_id: '00000000-0000-4000-8000-000000000012',
      version: 1,
    },
  ],
  revisions: [
    {
      id: '00000000-0000-4000-8000-000000000012',
      plan_id: '00000000-0000-4000-8000-000000000011',
      version: 1,
      state: 'PUBLISHED',
      name: snapshot.name,
      description: { en: 'Paid access', ru: 'Платный доступ' },
      features: [],
      offers: [
        {
          id: '00000000-0000-4000-8000-000000000013',
          revision_id: '00000000-0000-4000-8000-000000000012',
          duration_days: 30,
          price: '30.000000',
          currency: 'USDT',
        },
      ],
    },
  ],
};
const subscription = {
  id: '00000000-0000-4000-8000-000000000017',
  user_id: '00000000-0000-4000-8000-000000000001',
  product_id: '00000000-0000-4000-8000-000000000010',
  plan_id: '00000000-0000-4000-8000-000000000018',
  revision_id: '00000000-0000-4000-8000-000000000019',
  offer_id: '00000000-0000-4000-8000-000000000020',
  state: 'ACTIVE',
  version: 7,
  current_period_start: '2026-10-01T00:00:00Z',
  current_period_end: '2099-11-01T00:00:00Z',
  cancel_at_period_end: false,
  next_offer_id: null,
  features: [],
  pending_period: null,
  current_offer_snapshot: {
    ...snapshot,
    plan_id: '00000000-0000-4000-8000-000000000018',
    revision_id: '00000000-0000-4000-8000-000000000019',
    offer_id: '00000000-0000-4000-8000-000000000020',
    upgrade_rank: 1,
    name: { en: 'Basic', ru: 'Базовый' },
  },
  next_offer_snapshot: null,
};
function transport(
  handler?: (path: string, options?: RequestInit) => Promise<Response> | Response | undefined,
) {
  api.setSession(auth.session_id, 'csrf');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string, options?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const custom = handler?.(path, options);
      if (custom) return custom;
      return Response.json(
        path === '/api/v1/catalog/pages'
          ? { ...catalog, next_cursor: null }
          : path === '/api/v1/subscriptions'
            ? { items: [subscription], next_cursor: null }
            : path.endsWith('/entitlement')
              ? {
                  subscription_id: '00000000-0000-4000-8000-000000000017',
                  allowed: true,
                  features: [],
                  checked_at: '2026-10-24T00:00:00Z',
                }
              : path === '/api/v1/orders'
                ? { items: [order], next_cursor: null }
                : order,
      );
    }),
  );
}
function panel(
  session = auth,
  section: 'catalog' | 'subscriptions' | 'payments' = 'payments',
  locale: 'en' | 'ru' = 'en',
) {
  return (
    <I18nProvider initialLocale={locale}>
      <CommercePanel auth={session} section={section} />
    </I18nProvider>
  );
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  api.setSession(null);
});
it.each([
  ['en', 'denied'],
  ['en', 'outage'],
  ['ru', 'denied'],
  ['ru', 'outage'],
] as const)(
  'invalidates access at the paid boundary without focus (%s, %s)',
  async (locale, outcome) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T00:00:00Z'));
    const boundary = '2026-10-24T00:00:01Z';
    const refreshed = Promise.withResolvers<Response>();
    let entitlementReads = 0;
    transport((path) => {
      if (path === '/api/v1/subscriptions')
        return Response.json({
          items: [{ ...subscription, current_period_end: boundary }],
          next_cursor: null,
        });
      if (path.endsWith('/entitlement')) {
        entitlementReads++;
        if (entitlementReads > 1) return refreshed.promise;
      }
      return undefined;
    });
    await act(async () => {
      render(panel(auth, 'subscriptions', locale));
    });
    const allowed = commerceMessages.accessAllowed[locale];
    const denied = commerceMessages.accessDenied[locale];
    expect(screen.getByText(allowed)).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(screen.getByText(allowed)).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.queryByText(allowed)).toBeNull();
    expect(screen.queryByText(denied)).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(entitlementReads).toBe(2);
    await act(async () => {
      if (outcome === 'outage') refreshed.reject(new TypeError('network unavailable'));
      else
        refreshed.resolve(
          Response.json({
            subscription_id: subscription.id,
            allowed: false,
            features: [],
            checked_at: boundary,
          }),
        );
    });
    expect(screen.queryByText(allowed)).toBeNull();
    if (outcome === 'outage') {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.queryByText(denied)).toBeNull();
    } else {
      expect(screen.getByText(denied)).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    }
  },
);
it('invalidates hidden-tab access at the boundary but defers the owner read until visible', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T00:00:00Z'));
  let visibility: DocumentVisibilityState = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  const refreshed = Promise.withResolvers<Response>();
  let entitlementReads = 0;
  transport((path) => {
    if (path === '/api/v1/subscriptions')
      return Response.json({
        items: [{ ...subscription, current_period_end: '2026-10-24T00:00:01Z' }],
        next_cursor: null,
      });
    if (path.endsWith('/entitlement') && ++entitlementReads > 1) return refreshed.promise;
    return undefined;
  });
  await act(async () => {
    render(panel(auth, 'subscriptions'));
  });
  expect(screen.getByText(commerceMessages.accessAllowed.en)).toBeTruthy();
  await act(async () => {
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.queryByText(commerceMessages.accessAllowed.en)).toBeNull();
  expect(entitlementReads).toBe(1);
  await act(async () => {
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(entitlementReads).toBe(2);
  expect(screen.queryByText(commerceMessages.accessAllowed.en)).toBeNull();
  await act(async () => {
    refreshed.resolve(
      Response.json({
        subscription_id: subscription.id,
        allowed: false,
        features: [],
        checked_at: '2026-10-24T00:00:01Z',
      }),
    );
  });
  expect(screen.getByText(commerceMessages.accessDenied.en)).toBeTruthy();
});
it('discards an old session boundary refresh after account change', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T00:00:00Z'));
  const oldRefresh = Promise.withResolvers<Response>();
  let currentAuth = auth;
  let entitlementReads = 0;
  transport((path) => {
    if (path === '/api/v1/subscriptions')
      return Response.json({
        items: [
          {
            ...subscription,
            user_id: currentAuth.user.id,
            current_period_end: '2026-10-24T00:00:01Z',
          },
        ],
        next_cursor: null,
      });
    if (path.endsWith('/entitlement')) {
      entitlementReads++;
      if (entitlementReads === 2) return oldRefresh.promise;
      if (currentAuth !== auth)
        return Response.json({
          subscription_id: subscription.id,
          allowed: false,
          features: [],
          checked_at: '2026-10-24T00:00:01Z',
        });
    }
    return undefined;
  });
  let view!: RenderResult;
  await act(async () => {
    view = render(panel(auth, 'subscriptions'));
  });
  expect(screen.getByText(commerceMessages.accessAllowed.en)).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(entitlementReads).toBe(2);
  currentAuth = {
    ...auth,
    session_id: '00000000-0000-4000-8000-000000000005',
    user: { ...auth.user, id: '00000000-0000-4000-8000-000000000003' },
  };
  api.setSession(currentAuth.session_id, 'csrf');
  await act(async () => {
    view.rerender(panel(currentAuth, 'subscriptions'));
  });
  expect(screen.getByText(commerceMessages.accessDenied.en)).toBeTruthy();
  await act(async () => {
    oldRefresh.resolve(
      Response.json({
        subscription_id: subscription.id,
        allowed: true,
        features: [],
        checked_at: '2026-10-24T00:00:01Z',
      }),
    );
  });
  expect(screen.queryByText(commerceMessages.accessAllowed.en)).toBeNull();
  expect(screen.getByText(commerceMessages.accessDenied.en)).toBeTruthy();
});
it('labels accepted payment as not yet fulfilled and exposes authoritative recovery detail', async () => {
  transport();
  render(panel());
  const listedOrder = within(await screen.findByRole('article'));
  expect(listedOrder.getByText('Payment accepted — activation pending')).toBeTruthy();
  await userEvent.click(listedOrder.getByRole('button', { name: 'Open order' }));
  const detail = within(await screen.findByRole('region', { name: 'Order ID' }));
  await detail.findByText('12345678901234567890');
  expect(detail.getByText('Payment accepted — activation pending')).toBeTruthy();
  expect(detail.queryByText('Access activated')).toBeNull();
  expect(detail.queryByRole('button', { name: 'Cancel proven unpaid order' })).toBeNull();
});
it('requires verified email before displaying a purchase command', async () => {
  transport();
  render(panel({ ...auth, user: { ...auth.user, is_verified: false } }, 'catalog'));
  await screen.findByText('Paid access');
  expect(screen.getByRole('button', { name: 'Buy' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByText('Verify your email before purchasing.')).toBeTruthy();
});
it('fails closed on foreign order ownership', async () => {
  transport((path) =>
    path === '/api/v1/orders'
      ? Response.json({
          items: [{ ...order, user_id: '00000000-0000-4000-8000-000000000002' }],
          next_cursor: null,
        })
      : undefined,
  );
  render(panel());
  await screen.findByRole('alert');
  expect(screen.queryByText('Payment accepted — activation pending')).toBeNull();
});
it('ignores late previous-session order data after account switch', async () => {
  const deferred = Promise.withResolvers<Response>();
  transport((path) => (path === '/api/v1/orders' ? deferred.promise : undefined));
  const view = render(panel());
  const next = {
    ...auth,
    session_id: '00000000-0000-4000-8000-000000000005',
    user: { ...auth.user, id: '00000000-0000-4000-8000-000000000003' },
  };
  api.setSession(next.session_id, 'csrf');
  vi.stubGlobal('fetch', async () => Response.json({ items: [], next_cursor: null }));
  view.rerender(panel(next));
  deferred.resolve(Response.json({ items: [order], next_cursor: null }));
  await screen.findByText('No orders yet.');
  expect(screen.queryByText('Payment accepted — activation pending')).toBeNull();
});
it('confirms the exact prepared upgrade quote instead of accepting browser-calculated money', async () => {
  let checkout: Record<string, unknown> | undefined;
  transport((path, options) => {
    if (path.endsWith('/upgrade-quote'))
      return Response.json({
        id: '00000000-0000-4000-8000-000000000021',
        operation_id: '00000000-0000-4000-8000-000000000024',
        user_id: '00000000-0000-4000-8000-000000000001',
        product_id: '00000000-0000-4000-8000-000000000010',
        subscription_id: '00000000-0000-4000-8000-000000000017',
        kind: 'UPGRADE',
        state: 'PREPARED',
        version: 1,
        offer_snapshot: snapshot,
        amount: '9.000001',
        currency: 'USDT',
        expires_at: '2099-10-24T00:05:00Z',
        quote_at: '2026-10-24T00:00:00Z',
        subscription_version: 7,
        attempt_id: null,
      });
    if (path === '/api/v1/orders' && options?.method === 'POST') {
      checkout = JSON.parse(String(options.body));
      return Response.json({
        ...order,
        subscription_id: '00000000-0000-4000-8000-000000000017',
        kind: 'UPGRADE',
        amount: '9.000001',
      });
    }
    return undefined;
  });
  render(panel(auth, 'subscriptions'));
  await userEvent.click(await screen.findByRole('button', { name: 'Get upgrade quote' }));
  await screen.findByText('9.000001 USDT');
  await userEvent.click(screen.getByRole('button', { name: 'Confirm checkout' }));
  await waitFor(() =>
    expect(checkout).toMatchObject({
      action_id: '00000000-0000-4000-8000-000000000021',
      offer_id: '00000000-0000-4000-8000-000000000013',
      subscription_id: '00000000-0000-4000-8000-000000000017',
      kind: 'UPGRADE',
      expected_version: 7,
    }),
  );
  expect(checkout).not.toHaveProperty('amount');
});
it('reuses the checkout attempt after an unknown network outcome instead of issuing a second payment', async () => {
  const keys: string[] = [];
  transport((path, options) => {
    if (path === '/api/v1/orders' && options?.method === 'POST') {
      keys.push(JSON.parse(String(options.body)).idempotency_key);
      if (keys.length === 1) return Promise.reject(new TypeError('network lost'));
      return Response.json(order);
    }
    return undefined;
  });
  render(panel(auth, 'catalog'));
  await userEvent.click(await screen.findByRole('button', { name: 'Buy' }));
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'Buy' }));
  await screen.findByText('wallet');
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});
it('renews the scheduled next offer and preserves its authoritative prepared action at checkout', async () => {
  let preparedBody: Record<string, unknown> | undefined;
  let checkoutBody: Record<string, unknown> | undefined;
  transport((path, options) => {
    if (path === '/api/v1/subscriptions')
      return Response.json({
        items: [{ ...subscription, next_offer_id: '00000000-0000-4000-8000-000000000013' }],
        next_cursor: null,
      });
    if (path.endsWith('/renew')) {
      preparedBody = JSON.parse(String(options?.body));
      return Response.json({
        id: '00000000-0000-4000-8000-000000000022',
        operation_id: '00000000-0000-4000-8000-000000000024',
        user_id: '00000000-0000-4000-8000-000000000001',
        product_id: '00000000-0000-4000-8000-000000000010',
        subscription_id: '00000000-0000-4000-8000-000000000017',
        kind: 'RENEW',
        state: 'PREPARED',
        version: 1,
        offer_snapshot: snapshot,
        amount: '30.000000',
        currency: 'USDT',
        expires_at: '2099-10-24T00:05:00Z',
        quote_at: '2026-10-24T00:00:00Z',
        subscription_version: 7,
        attempt_id: null,
      });
    }
    if (path === '/api/v1/orders' && options?.method === 'POST') {
      checkoutBody = JSON.parse(String(options.body));
      return Response.json(order);
    }
    return undefined;
  });
  render(panel(auth, 'subscriptions'));
  await userEvent.click(await screen.findByRole('button', { name: 'Prepare renewal' }));
  await screen.findByRole('region', { name: 'Authoritative payment quote' });
  expect(preparedBody).toMatchObject({
    offer_id: '00000000-0000-4000-8000-000000000013',
    expected_version: 7,
  });
  await userEvent.click(screen.getByRole('button', { name: 'Confirm checkout' }));
  await waitFor(() =>
    expect(checkoutBody).toMatchObject({
      action_id: '00000000-0000-4000-8000-000000000022',
      kind: 'RENEW',
      offer_id: '00000000-0000-4000-8000-000000000013',
      expected_version: 7,
    }),
  );
});
it('cancel and resume preserve paid-period truth and send the observed subscription version', async () => {
  let cancel = false;
  const bodies: unknown[] = [];
  transport((path, options) => {
    if (path === '/api/v1/subscriptions')
      return Response.json({
        items: [{ ...subscription, cancel_at_period_end: cancel, version: cancel ? 8 : 7 }],
        next_cursor: null,
      });
    if (path.endsWith('/cancel') || path.endsWith('/resume')) {
      bodies.push(JSON.parse(String(options?.body)));
      cancel = path.endsWith('/cancel');
      return Response.json({
        ...subscription,
        cancel_at_period_end: cancel,
        version: cancel ? 8 : 9,
      });
    }
    return undefined;
  });
  render(panel(auth, 'subscriptions'));
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel at period end' }));
  await screen.findByText('Access ends at the paid-period boundary.');
  expect(screen.getByText('Access currently allowed')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Resume subscription' }));
  await screen.findByRole('button', { name: 'Cancel at period end' });
  expect(bodies).toEqual([
    expect.objectContaining({ expected_version: 7 }),
    expect.objectContaining({ expected_version: 8 }),
  ]);
});
it('never offers cancellation when authoritative detail supersedes a stale unpaid listing with an ambiguous create outcome', async () => {
  transport((path) =>
    path === '/api/v1/orders'
      ? Response.json({
          items: [
            {
              ...order,
              state: 'PAYMENT_PENDING',
              accepted_at: null,
              payment_attempt: {
                ...order.payment_attempt,
                state: 'UNPAID',
                pay_address: null,
              },
            },
          ],
          next_cursor: null,
        })
      : path.startsWith('/api/v1/orders/')
        ? Response.json({
            ...order,
            state: 'PAYMENT_PENDING',
            accepted_at: null,
            payment_attempt: {
              ...order.payment_attempt,
              state: 'CREATE_UNKNOWN',
              pay_address: null,
            },
          })
        : undefined,
  );
  render(panel());
  const listedOrder = within(await screen.findByRole('article'));
  await userEvent.click(listedOrder.getByRole('button', { name: 'Open order' }));
  const detail = within(await screen.findByRole('region', { name: 'Order ID' }));
  await detail.findByText('12345678901234567890');
  expect(detail.getByRole('status').textContent).toMatch(/unknown/i);
  expect(detail.queryByRole('button', { name: 'Cancel proven unpaid order' })).toBeNull();
});
it('schedules downgrade without granting a free period or creating a payment', async () => {
  let scheduled: Record<string, unknown> | undefined;
  let checkoutCount = 0;
  transport((path, options) => {
    if (path === '/api/v1/catalog/pages')
      return Response.json({
        ...catalog,
        next_cursor: null,
        plans: [
          { ...catalog.plans[0], upgrade_rank: 1 },
          {
            id: '00000000-0000-4000-8000-000000000018',
            product_id: '00000000-0000-4000-8000-000000000010',
            key: 'current',
            upgrade_rank: 2,
            current_revision_id: null,
            version: 1,
          },
        ],
      });
    if (path === '/api/v1/subscriptions')
      return Response.json({
        items: [
          {
            ...subscription,
            current_offer_snapshot: { ...subscription.current_offer_snapshot, upgrade_rank: 2 },
          },
        ],
        next_cursor: null,
      });
    if (path.endsWith('/downgrade')) {
      scheduled = JSON.parse(String(options?.body));
      return Response.json({
        ...subscription,
        next_offer_id: '00000000-0000-4000-8000-000000000013',
        version: 8,
      });
    }
    if (path === '/api/v1/orders' && options?.method === 'POST') {
      checkoutCount++;
      return Response.json(order);
    }
    return undefined;
  });
  render(panel(auth, 'subscriptions'));
  await userEvent.click(await screen.findByRole('button', { name: 'Schedule downgrade' }));
  await waitFor(() =>
    expect(scheduled).toMatchObject({
      expected_version: 7,
      offer_id: '00000000-0000-4000-8000-000000000013',
    }),
  );
  expect(checkoutCount).toBe(0);
  expect(screen.getByText('Access currently allowed')).toBeTruthy();
});
it('refuses checkout of an expired server quote without substituting a new amount', async () => {
  let checkoutCount = 0;
  transport((path, options) => {
    if (path.endsWith('/upgrade-quote'))
      return Response.json({
        id: '00000000-0000-4000-8000-000000000023',
        operation_id: '00000000-0000-4000-8000-000000000024',
        user_id: '00000000-0000-4000-8000-000000000001',
        product_id: '00000000-0000-4000-8000-000000000010',
        subscription_id: '00000000-0000-4000-8000-000000000017',
        kind: 'UPGRADE',
        state: 'PREPARED',
        version: 1,
        offer_snapshot: snapshot,
        amount: '1.000001',
        currency: 'USDT',
        expires_at: '2001-01-01T00:00:00Z',
        quote_at: '2001-01-01T00:00:00Z',
        subscription_version: 7,
        attempt_id: null,
      });
    if (path === '/api/v1/orders' && options?.method === 'POST') {
      checkoutCount++;
      return Response.json(order);
    }
    return undefined;
  });
  render(panel(auth, 'subscriptions'));
  await userEvent.click(await screen.findByRole('button', { name: 'Get upgrade quote' }));
  await screen.findByText('Quote expired. Request a fresh quote.');
  expect(screen.queryByRole('button', { name: 'Confirm checkout' })).toBeNull();
  expect(checkoutCount).toBe(0);
});
it('shows immutable purchased plan metadata after its revision leaves the public catalog', async () => {
  transport((path) =>
    path === '/api/v1/subscriptions'
      ? Response.json({
          items: [
            {
              ...subscription,
              current_offer_snapshot: {
                ...subscription.current_offer_snapshot,
                name: { en: 'Retired paid plan', ru: 'Архивный оплаченный тариф' },
              },
            },
          ],
          next_cursor: null,
        })
      : undefined,
  );
  render(panel(auth, 'subscriptions'));
  await screen.findByRole('heading', { name: 'Retired paid plan' });
  expect(screen.getAllByText('Retired paid plan').length).toBeGreaterThan(0);
});
