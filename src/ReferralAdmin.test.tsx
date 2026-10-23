// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthSession } from './auth';
import { api } from './api';
import { I18nProvider } from './i18n';
import { ReferralAdmin } from './ReferralAdmin';
import type { Payout } from './ReferralPanel';
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
  api.setSession('admin-referral-test', 'csrf');
  let paid = false;
  const mutations: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      let response: unknown;
      if (options.method === 'PUT')
        mutations.push(JSON.parse(String(options.body)) as Record<string, unknown>);
      if (options.method === 'POST') {
        const body = JSON.parse(String(options.body));
        mutations.push(body);
        paid = true;
      }
      if (url.pathname.endsWith('/rate'))
        response = { rate_bps: 100, version: 1, effective_at: '2026-10-24T10:00:00Z' };
      else if (url.pathname.endsWith('/partners') || url.pathname.endsWith('/history'))
        response = { items: [], next_cursor: null };
      else {
        const payout = {
          id: '20000000-0000-4000-8000-000000000001',
          user_id: '10000000-0000-4000-8000-000000000001',
          network: 'tron',
          address: 'T-address',
          amount: '15.123456',
          currency: 'USDT',
          state: paid ? 'PAID' : 'PENDING',
          version: paid ? 2 : 1,
          created_at: '2026-10-24T10:00:00Z',
          reason: null,
          reference: paid ? 'tx-external' : null,
          paid_at: paid ? '2026-10-24T11:00:00.000Z' : null,
          decided_at: null,
        };
        response = options.method === 'POST' ? payout : { items: [payout], next_cursor: null };
      }
      return new Response(JSON.stringify(response));
    }),
  );
  return mutations;
}
it('admits safe support reads without finance mutation forms', async () => {
  fixture();
  render(
    <I18nProvider initialLocale="en">
      <ReferralAdmin auth={auth(['referrals:read'])} />
    </I18nProvider>,
  );
  await screen.findByText('15.123456 USDT');
  expect(screen.queryByRole('button', { name: 'Publish global rate' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Record payout decision' })).toBeNull();
});
it('records externally completed payment evidence and removes the decision form after the immutable result', async () => {
  const mutations = fixture();
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <ReferralAdmin auth={auth(['referrals:read', 'referrals:payouts:decide'])} />
    </I18nProvider>,
  );
  await screen.findByText('15.123456 USDT');
  await user.click(screen.getByRole('button', { name: 'Record payout decision' }));
  expect(mutations).toHaveLength(0);
  await user.type(screen.getByLabelText('Decision reason'), 'Reviewed externally');
  await user.type(screen.getByLabelText('External payment reference'), 'tx-external');
  fireEvent.change(screen.getByLabelText('Payment date and time'), {
    target: { value: '2026-10-24T11:00' },
  });
  await user.click(screen.getByRole('button', { name: 'Record payout decision' }));
  await screen.findByText('PAID');
  expect(mutations[0]).toMatchObject({
    decision: 'PAID',
    expected_version: 1,
    reason: 'Reviewed externally',
    reference: 'tx-external',
    paid_at: expect.any(String),
    idempotency_key: expect.any(String),
  });
  expect(screen.queryByRole('button', { name: 'Record payout decision' })).toBeNull();
});
it('does not expose administrative data without the read permission even for a staff role', async () => {
  const mutations = fixture();
  render(
    <I18nProvider initialLocale="en">
      <ReferralAdmin auth={auth(['referrals:payouts:decide'])} />
    </I18nProvider>,
  );
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  expect(mutations).toHaveLength(0);
});
it('requires a reason before publishing a new global rate with its optimistic version', async () => {
  const mutations = fixture();
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <ReferralAdmin auth={auth(['referrals:read', 'referrals:rates:write'])} />
    </I18nProvider>,
  );
  const rate = await screen.findByLabelText('Rate (basis points)');
  await user.clear(rate);
  await user.type(rate, '125');
  await user.click(screen.getByRole('button', { name: 'Publish global rate' }));
  expect(mutations).toHaveLength(0);
  await user.type(screen.getByLabelText('Reason'), 'Approved new sales rate');
  await user.click(screen.getByRole('button', { name: 'Publish global rate' }));
  expect(mutations[0]).toEqual({
    rate_bps: 125,
    expected_version: 1,
    reason: 'Approved new sales rate',
    idempotency_key: expect.any(String),
  });
});
it('restores a partner to the global rate without overwriting historical decisions', async () => {
  api.setSession('partner-rate-test', 'csrf');
  const mutations: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      const partner = {
        user_id: '10000000-0000-4000-8000-000000000001',
        code: 'PARTNER',
        referral_url: 'https://example.test/?ref=PARTNER',
        earned: '5.000000',
        reserved: '0.000000',
        paid: '0.000000',
        available: '5.000000',
        debt: '0.000000',
        rate_bps: 200,
        version: 1,
        payout_networks: ['bsc', 'tron'],
        override_rate_bps: 200,
        rate_version: 3,
      };
      let response: unknown;
      if (options.method === 'PUT') {
        mutations.push(JSON.parse(String(options.body)));
        response = { rate_bps: null, version: 4, effective_at: '2026-10-24T11:00:00Z' };
      } else if (url.pathname.endsWith('/history'))
        response = {
          items: [
            {
              id: '40000000-0000-4000-8000-000000000001',
              scope: 'GLOBAL',
              user_id: null,
              rate_bps: 100,
              version: 1,
              effective_at: '2026-10-24T10:00:00Z',
              actor_id: null,
              reason: 'Initial approved rate',
            },
          ],
          next_cursor: null,
        };
      else if (url.pathname.endsWith('/rate'))
        response = { rate_bps: 100, version: 1, effective_at: '2026-10-24T10:00:00Z' };
      else if (url.pathname.endsWith('/partners'))
        response = { items: [partner], next_cursor: null };
      else response = { items: [], next_cursor: null };
      return new Response(JSON.stringify(response));
    }),
  );
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <ReferralAdmin auth={auth(['referrals:read', 'referrals:rates:write'])} />
    </I18nProvider>,
  );
  await screen.findByText('PARTNER');
  await user.click(screen.getByLabelText('Use global rate'));
  const reasons = screen.getAllByLabelText('Reason');
  await user.type(reasons[1], 'Restore default policy');
  await user.click(screen.getByRole('button', { name: 'Publish partner rate' }));
  expect(mutations[0]).toEqual({
    rate_bps: null,
    expected_version: 3,
    reason: 'Restore default policy',
    idempotency_key: expect.any(String),
  });
  await user.click(screen.getAllByRole('button', { name: 'Rate history' })[0]);
  await screen.findByText('Initial approved rate');
  expect(screen.getByText('System')).toBeTruthy();
});

const partnerId = '10000000-0000-4000-8000-000000000001';
const pendingId = '20000000-0000-4000-8000-000000000001';
const globalRate = { rate_bps: 100, version: 1, effective_at: '2026-10-24T10:00:00Z' };
const partnerRecord = {
  user_id: partnerId,
  code: 'PARTNER',
  referral_url: 'https://example.test/?ref=PARTNER',
  earned: '5.000000',
  reserved: '0.000000',
  paid: '0.000000',
  available: '5.000000',
  debt: '0.000000',
  rate_bps: 200,
  version: 1,
  payout_networks: ['tron'],
  override_rate_bps: 200,
  rate_version: 3,
};
function adminPayout(state: Payout['state'] = 'PENDING', id = pendingId): Payout {
  return {
    id,
    user_id: partnerId,
    network: 'tron',
    address: 'T-address',
    amount: '15.123456',
    currency: 'USDT',
    state,
    version: state === 'PENDING' ? 1 : 2,
    created_at: '2026-10-24T10:00:00Z',
    decided_at: null,
    reason: state === 'PAID' ? 'Reviewed externally' : null,
    reference: state === 'PAID' ? 'tx-external' : null,
    paid_at: state === 'PAID' ? '2026-10-24T11:00:00.000Z' : null,
  };
}
const reply = (body: unknown) => new Response(JSON.stringify(body));

it.each(['PAID', 'REJECTED'] as const)(
  'recovers a committed %s admin decision with the original key after a dropped response',
  async (decision) => {
    api.setSession(`decision-retry-${decision}`, 'csrf');
    const bodies: Record<string, unknown>[] = [];
    let key: string | undefined;
    let decisions = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL, options: RequestInit) => {
        if (options.method === 'POST') {
          const body = JSON.parse(String(options.body));
          bodies.push(body);
          if (!key) {
            key = body.idempotency_key;
            decisions++;
            throw new TypeError('reply dropped after immutable decision');
          }
          return body.idempotency_key === key
            ? reply(adminPayout(decision))
            : new Response(JSON.stringify({ code: 'version_conflict' }), { status: 409 });
        }
        return reply(
          url.pathname.endsWith('/rate')
            ? globalRate
            : {
                items: url.pathname.endsWith('/payouts') ? [adminPayout()] : [],
                next_cursor: null,
              },
        );
      }),
    );
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <ReferralAdmin auth={auth(['referrals:read', 'referrals:payouts:decide'])} />
      </I18nProvider>,
    );
    await screen.findByText(pendingId);
    if (decision === 'REJECTED')
      await user.selectOptions(screen.getByLabelText('Decision'), 'REJECTED');
    await user.type(screen.getByLabelText('Decision reason'), 'Reviewed externally');
    if (decision === 'PAID') {
      await user.type(screen.getByLabelText('External payment reference'), 'tx-external');
      fireEvent.change(screen.getByLabelText('Payment date and time'), {
        target: { value: '2026-10-24T11:00' },
      });
    }
    await user.click(screen.getByRole('button', { name: 'Record payout decision' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Record payout decision' }));
    await screen.findByText(decision);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(decisions).toBe(1);
    expect(screen.queryByRole('button', { name: 'Record payout decision' })).toBeNull();
    if (decision === 'PAID') expect(screen.getByText('tx-external')).toBeTruthy();
  },
);

it.each(['global', 'partner'] as const)(
  'recovers a committed %s rate command and then uses the returned version for a distinct command',
  async (scope) => {
    api.setSession(`rate-retry-${scope}`, 'csrf');
    const bodies: Record<string, unknown>[] = [];
    const results = new Map<string, { rate_bps: number; version: number; effective_at: string }>();
    let commits = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL, options: RequestInit) => {
        if (options.method === 'PUT') {
          const body = JSON.parse(String(options.body));
          bodies.push(body);
          const key = String(body.idempotency_key);
          if (results.has(key)) return reply(results.get(key));
          commits++;
          const result = {
            rate_bps: Number(body.rate_bps),
            version: Number(body.expected_version) + 1,
            effective_at: '2026-10-24T11:00:00Z',
          };
          results.set(key, result);
          if (bodies.length === 1) throw new TypeError('rate reply lost after commit');
          return reply(result);
        }
        const committed = [...results.values()][0];
        return reply(
          url.pathname.endsWith('/rate')
            ? scope === 'global' && committed
              ? committed
              : globalRate
            : {
                items: url.pathname.endsWith('/partners')
                  ? [
                      {
                        ...partnerRecord,
                        ...(scope === 'partner' && committed
                          ? {
                              rate_bps: committed.rate_bps,
                              override_rate_bps: committed.rate_bps,
                              rate_version: committed.version,
                            }
                          : {}),
                      },
                    ]
                  : [],
                next_cursor: null,
              },
        );
      }),
    );
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <ReferralAdmin auth={auth(['referrals:read', 'referrals:rates:write'])} />
      </I18nProvider>,
    );
    await screen.findByText('PARTNER');
    const form = screen.getByRole('form', {
      name: scope === 'global' ? 'Publish global rate' : 'Individual rate override',
    });
    const fields = within(form);
    await user.clear(fields.getByLabelText('Rate (basis points)'));
    await user.type(fields.getByLabelText('Rate (basis points)'), '125');
    await user.type(fields.getByLabelText('Reason'), 'Approved rate');
    await user.click(fields.getByRole('button'));
    await fields.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Refresh' }).hasAttribute('disabled')).toBe(false),
    );
    await user.click(fields.getByRole('button'));
    await fields.findByRole('status');
    expect(bodies[1]).toEqual(bodies[0]);
    expect(commits).toBe(1);
    await user.click(fields.getByRole('button'));
    await waitFor(() => expect(bodies).toHaveLength(3));
    expect(bodies[2].expected_version).toBe(scope === 'global' ? 2 : 4);
    expect(bodies[2].idempotency_key).not.toBe(bodies[1].idempotency_key);
  },
);

it('fences a delayed pre-decision refresh so it cannot restore a pending decision or stale cursors', async () => {
  api.setSession('admin-predecision-read', 'csrf');
  const stale = Promise.withResolvers<Response>();
  let payoutReads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      if (options.method === 'POST') return reply(adminPayout('PAID'));
      if (url.pathname.endsWith('/payouts') && ++payoutReads === 2) return stale.promise;
      return reply(
        url.pathname.endsWith('/rate')
          ? globalRate
          : { items: url.pathname.endsWith('/payouts') ? [adminPayout()] : [], next_cursor: null },
      );
    }),
  );
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <ReferralAdmin auth={auth(['referrals:read', 'referrals:payouts:decide'])} />
    </I18nProvider>,
  );
  await screen.findByText(pendingId);
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await user.type(screen.getByLabelText('Decision reason'), 'Reviewed externally');
  await user.type(screen.getByLabelText('External payment reference'), 'tx-external');
  fireEvent.change(screen.getByLabelText('Payment date and time'), {
    target: { value: '2026-10-24T11:00' },
  });
  await user.click(screen.getByRole('button', { name: 'Record payout decision' }));
  await screen.findByText('PAID');
  await act(async () => {
    stale.resolve(reply({ items: [adminPayout()], next_cursor: 'old' }));
  });
  expect(screen.getByText('PAID')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Record payout decision' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
});

it.each(['partners', 'payouts'] as const)(
  'discards a delayed %s page when refreshed lists move to a new cursor generation',
  async (collection) => {
    api.setSession(`admin-page-${collection}`, 'csrf');
    const stale = Promise.withResolvers<Response>();
    const cursors: string[] = [];
    let firstPages = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        if (url.pathname.endsWith('/rate')) return reply(globalRate);
        if (!url.pathname.endsWith(`/${collection}`))
          return reply({ items: [], next_cursor: null });
        const cursor = url.searchParams.get('cursor');
        if (cursor) {
          cursors.push(cursor);
          if (cursor === 'old-page') return stale.promise;
          return reply({ items: [], next_cursor: null });
        }
        firstPages++;
        return reply({
          items:
            collection === 'partners'
              ? [{ ...partnerRecord, code: firstPages === 1 ? 'OLD' : 'NEW' }]
              : [adminPayout(firstPages === 1 ? 'PENDING' : 'PAID')],
          next_cursor: firstPages === 1 ? 'old-page' : 'new-page',
        });
      }),
    );
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <ReferralAdmin auth={auth(['referrals:read'])} />
      </I18nProvider>,
    );
    await screen.findByText(collection === 'partners' ? 'OLD' : 'PENDING');
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText(collection === 'partners' ? 'NEW' : 'PAID');
    await act(async () => {
      stale.resolve(
        reply({
          items:
            collection === 'partners'
              ? [
                  {
                    ...partnerRecord,
                    user_id: '10000000-0000-4000-8000-000000000002',
                    code: 'STALE',
                  },
                ]
              : [adminPayout('PENDING', '20000000-0000-4000-8000-000000000002')],
          next_cursor: 'stale-next',
        }),
      );
    });
    expect(
      screen.queryByText(
        collection === 'partners' ? 'STALE' : '20000000-0000-4000-8000-000000000002',
      ),
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(cursors).toEqual(['old-page', 'new-page']));
  },
);

it('aborts old-account reads and clears financial data before loading a changed admin session', async () => {
  api.setSession('admin-account-a', 'csrf');
  const stale: PromiseWithResolvers<Response>[] = [];
  const signals: AbortSignal[] = [];
  let phase = 'initial';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      if (phase === 'stale') {
        const deferred = Promise.withResolvers<Response>();
        stale.push(deferred);
        signals.push(options.signal!);
        return deferred.promise;
      }
      return reply(
        url.pathname.endsWith('/rate')
          ? globalRate
          : {
              items:
                url.pathname.endsWith('/payouts') && phase === 'initial' ? [adminPayout()] : [],
              next_cursor: null,
            },
      );
    }),
  );
  const user = userEvent.setup();
  const view = render(
    <I18nProvider initialLocale="en">
      <ReferralAdmin auth={auth(['referrals:read'])} />
    </I18nProvider>,
  );
  await screen.findByText(pendingId);
  phase = 'stale';
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(stale).toHaveLength(3));
  phase = 'new';
  api.setSession('admin-account-b', 'csrf');
  view.rerender(
    <I18nProvider initialLocale="en">
      <ReferralAdmin auth={{ ...auth(['referrals:read']), session_id: 's2' }} />
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.queryByText(pendingId)).toBeNull());
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  await act(async () => {
    stale[0].resolve(reply(globalRate));
    stale[1].resolve(reply({ items: [], next_cursor: null }));
    stale[2].resolve(reply({ items: [adminPayout()], next_cursor: null }));
  });
  expect(screen.queryByText(pendingId)).toBeNull();
});

it.each(['global', 'partner'] as const)(
  'does not let a delayed pre-%s-rate read restore the previous rate and version',
  async (scope) => {
    api.setSession(`admin-rate-race-${scope}`, 'csrf');
    const stale = Promise.withResolvers<Response>();
    const bodies: Record<string, unknown>[] = [];
    let rateReads = 0;
    let partnerReads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL, options: RequestInit) => {
        if (options.method === 'PUT') {
          bodies.push(JSON.parse(String(options.body)));
          return reply({
            rate_bps: 125,
            version: scope === 'global' ? 2 : 4,
            effective_at: '2026-10-24T11:00:00Z',
          });
        }
        if (url.pathname.endsWith('/rate')) {
          if (++rateReads === 2 && scope === 'global') return stale.promise;
          return reply(globalRate);
        }
        if (url.pathname.endsWith('/partners')) {
          if (++partnerReads === 2 && scope === 'partner') return stale.promise;
          return reply({ items: [partnerRecord], next_cursor: null });
        }
        return reply({ items: [], next_cursor: null });
      }),
    );
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <ReferralAdmin auth={auth(['referrals:read', 'referrals:rates:write'])} />
      </I18nProvider>,
    );
    await screen.findByText('PARTNER');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    const form = within(
      screen.getByRole('form', {
        name: scope === 'global' ? 'Publish global rate' : 'Individual rate override',
      }),
    );
    await user.clear(form.getByLabelText('Rate (basis points)'));
    await user.type(form.getByLabelText('Rate (basis points)'), '125');
    await user.type(form.getByLabelText('Reason'), 'Approved rate');
    await user.click(form.getByRole('button'));
    await form.findByRole('status');
    await act(async () => {
      stale.resolve(
        reply(scope === 'global' ? globalRate : { items: [partnerRecord], next_cursor: null }),
      );
    });
    expect(screen.getByText('Rate (basis points): 125')).toBeTruthy();
    await user.click(form.getByRole('button'));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].expected_version).toBe(scope === 'global' ? 2 : 4);
  },
);

it('keeps rate history pages in their refresh generation and aborts a pending read on unmount', async () => {
  api.setSession('rate-history-generation', 'csrf');
  const stale = Promise.withResolvers<Response>();
  const unmounted = Promise.withResolvers<Response>();
  const cursors: string[] = [];
  let historyReads = 0;
  let pendingSignal: AbortSignal | undefined;
  const entry = (id: string, reason: string) => ({
    id,
    scope: 'GLOBAL',
    user_id: null,
    rate_bps: 100,
    version: 1,
    effective_at: '2026-10-24T10:00:00Z',
    actor_id: null,
    reason,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      if (url.pathname.endsWith('/rate')) return reply(globalRate);
      if (!url.pathname.endsWith('/history')) return reply({ items: [], next_cursor: null });
      const cursor = url.searchParams.get('cursor');
      if (cursor) {
        cursors.push(cursor);
        if (cursor === 'old-page') {
          pendingSignal = options.signal!;
          return stale.promise;
        }
        return reply({ items: [], next_cursor: null });
      }
      historyReads++;
      if (historyReads === 3) {
        pendingSignal = options.signal!;
        return unmounted.promise;
      }
      return reply({
        items: [
          entry(
            '40000000-0000-4000-8000-000000000001',
            historyReads === 1 ? 'Old history' : 'New history',
          ),
        ],
        next_cursor: historyReads === 1 ? 'old-page' : 'new-page',
      });
    }),
  );
  const user = userEvent.setup();
  const view = render(
    <I18nProvider initialLocale="en">
      <ReferralAdmin auth={auth(['referrals:read'])} />
    </I18nProvider>,
  );
  await screen.findByText('Rate (basis points): 100');
  await user.click(screen.getByRole('button', { name: 'Rate history' }));
  await screen.findByText('Old history');
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  await user.click(screen.getByRole('button', { name: 'Rate history' }));
  await screen.findByText('New history');
  expect(pendingSignal?.aborted).toBe(true);
  await act(async () => {
    stale.resolve(
      reply({
        items: [entry('40000000-0000-4000-8000-000000000002', 'Stale history')],
        next_cursor: 'stale-next',
      }),
    );
  });
  expect(screen.queryByText('Stale history')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(cursors).toEqual(['old-page', 'new-page']));
  await user.click(screen.getByRole('button', { name: 'Rate history' }));
  await waitFor(() => expect(historyReads).toBe(3));
  view.unmount();
  expect(pendingSignal?.aborted).toBe(true);
  await act(async () => {
    unmounted.resolve(reply({ items: [], next_cursor: null }));
  });
});

it('allows only the newest overlapping admin refresh to publish its rate, payout state, and cursor', async () => {
  api.setSession('admin-latest-refresh', 'csrf');
  const pending: { deferred: PromiseWithResolvers<Response>; signal: AbortSignal }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: URL, options: RequestInit) => {
      const deferred = Promise.withResolvers<Response>();
      pending.push({ deferred, signal: options.signal! });
      return deferred.promise;
    }),
  );
  const view = render(
    <I18nProvider initialLocale="en">
      <ReferralAdmin auth={auth(['referrals:read'])} />
    </I18nProvider>,
  );
  await waitFor(() => expect(pending).toHaveLength(3));
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(pending).toHaveLength(6));
  expect(pending.slice(0, 3).every(({ signal }) => signal.aborted)).toBe(true);
  await act(async () => {
    pending[3].deferred.resolve(reply({ ...globalRate, rate_bps: 125, version: 2 }));
    pending[4].deferred.resolve(reply({ items: [], next_cursor: null }));
    pending[5].deferred.resolve(reply({ items: [adminPayout('PAID')], next_cursor: null }));
  });
  await screen.findByText('PAID');
  await act(async () => {
    pending[0].deferred.resolve(reply(globalRate));
    pending[1].deferred.resolve(reply({ items: [partnerRecord], next_cursor: 'old-partners' }));
    pending[2].deferred.resolve(reply({ items: [adminPayout()], next_cursor: 'old-payouts' }));
  });
  expect(screen.getByText('Rate (basis points): 125')).toBeTruthy();
  expect(screen.getByText('PAID')).toBeTruthy();
  expect(screen.queryByText('PARTNER')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  fireEvent(window, new Event('online'));
  await waitFor(() => expect(pending).toHaveLength(9));
  view.unmount();
  expect(pending.slice(6).every(({ signal }) => signal.aborted)).toBe(true);
});
