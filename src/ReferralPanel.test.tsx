// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { I18nProvider } from './i18n';
import { ReferralPanel } from './ReferralPanel';
import type { Payout } from './ReferralPanel';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('reserves the server available balance without numeric conversion and cancels only the pending version', async () => {
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  let payout: Record<string, unknown> | undefined;
  api.setSession('referral-test', 'csrf');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      const path = url.pathname;
      const body = JSON.parse(String(options.body ?? '{}')) as Record<string, unknown>;
      let response: unknown;
      if (options.method === 'POST') {
        requests.push({ path, body });
        payout = {
          id: '20000000-0000-4000-8000-000000000001',
          user_id: '10000000-0000-4000-8000-000000000001',
          network: 'tron',
          address: 'T-address',
          amount: '1234567.123456',
          currency: 'USDT',
          state: path.endsWith('/cancel') ? 'CANCELLED' : 'PENDING',
          version: path.endsWith('/cancel') ? 2 : 1,
          created_at: '2026-10-24T10:00:00Z',
          decided_at: null,
          reason: null,
          reference: null,
          paid_at: null,
        };
        response = payout;
      } else if (path.endsWith('/payouts'))
        response = { items: payout ? [payout] : [], next_cursor: null };
      else
        response = {
          user_id: '10000000-0000-4000-8000-000000000001',
          code: 'OWN-CODE',
          referral_url: 'https://example.test/?ref=OWN-CODE',
          earned: '1234567.123456',
          reserved: '0.000000',
          paid: '0.000000',
          available: '1234567.123456',
          debt: '0.000000',
          rate_bps: 125,
          version: 1,
          payout_networks: ['bsc', 'tron'],
        };
      return new Response(JSON.stringify(response));
    }),
  );
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <ReferralPanel />
    </I18nProvider>,
  );
  await screen.findByText('OWN-CODE');
  expect(screen.getAllByText('1234567.123456 USDT').length).toBeGreaterThan(0);
  await user.selectOptions(screen.getByLabelText('Network'), 'tron');
  await user.type(screen.getByLabelText('Payout address'), 'T-address');
  await user.click(screen.getByRole('button', { name: 'Request payout' }));
  await screen.findByText('PENDING');
  expect(requests[0].body).toEqual({
    network: 'tron',
    address: 'T-address',
    idempotency_key: expect.any(String),
  });
  await user.click(screen.getByRole('button', { name: 'Cancel payout' }));
  await screen.findByText('CANCELLED');
  expect(requests[1].body).toEqual({ expected_version: 1, idempotency_key: expect.any(String) });
});

const ownerId = '10000000-0000-4000-8000-000000000001';
const payoutId = '20000000-0000-4000-8000-000000000001';
function referralSummary(available = '20.000000', reserved = '0.000000') {
  return {
    user_id: ownerId,
    code: 'RETRY-CODE',
    referral_url: 'https://example.test/?ref=RETRY-CODE',
    earned: '27.000000',
    reserved,
    paid: '0.000000',
    available,
    debt: '0.000000',
    rate_bps: 125,
    version: 1,
    payout_networks: ['tron'],
  };
}
function referralPayout(state: Payout['state'] = 'PENDING', id = payoutId): Payout {
  return {
    id,
    user_id: ownerId,
    network: 'tron',
    address: 'T-address',
    amount: '20.000000',
    currency: 'USDT',
    state,
    version: state === 'PENDING' ? 1 : 2,
    created_at: '2026-10-24T10:00:00Z',
    decided_at: null,
    reason: null,
    reference: null,
    paid_at: null,
  };
}
const response = (body: unknown) => new Response(JSON.stringify(body));
const deferredResponse = () => Promise.withResolvers<Response>();
function renderReferrals() {
  return render(
    <I18nProvider initialLocale="en">
      <ReferralPanel />
    </I18nProvider>,
  );
}
function balance(label: string) {
  return screen.queryByText(label === 'Available' ? 'Available balance' : label, { selector: 'dt' })
    ?.nextElementSibling?.textContent;
}

it('recovers a committed payout after a dropped reply instead of reserving intervening credit', async () => {
  api.setSession('payout-retry-credit', 'csrf');
  const bodies: Record<string, unknown>[] = [];
  const reservations = new Map<string, Payout>();
  let available = '20.000000';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      if (options.method === 'POST') {
        const body = JSON.parse(String(options.body));
        bodies.push(body);
        const key = String(body.idempotency_key);
        if (reservations.has(key)) return response(reservations.get(key));
        const payout = {
          ...referralPayout(
            'PENDING',
            reservations.size === 0 ? payoutId : '20000000-0000-4000-8000-000000000002',
          ),
          amount: available,
        };
        reservations.set(key, payout);
        available = '0.000000';
        if (bodies.length === 1) throw new TypeError('response lost after commit');
        return response(payout);
      }
      if (url.pathname.endsWith('/payouts')) return response({ items: [], next_cursor: null });
      return response(referralSummary(available, '20.000000'));
    }),
  );
  const user = userEvent.setup();
  renderReferrals();
  await screen.findByText('RETRY-CODE');
  await user.type(screen.getByLabelText('Payout address'), 'T-address');
  await user.click(screen.getByRole('button', { name: 'Request payout' }));
  await screen.findByRole('alert');
  available = '7.000000';
  await user.click(screen.getByRole('button', { name: 'Request payout' }));
  await screen.findByText(payoutId);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(reservations.size).toBe(1);
  await waitFor(() => expect(balance('Available')).toBe('7.000000 USDT'));
  expect(
    within(screen.getByText(payoutId).closest('li')!).getByText('20.000000 USDT'),
  ).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Request payout' }));
  await waitFor(() => expect(bodies).toHaveLength(3));
  expect(bodies[2].idempotency_key).not.toBe(bodies[1].idempotency_key);
});

it('keeps a cancellation command identity until its committed reply is recovered', async () => {
  api.setSession('cancel-retry', 'csrf');
  const bodies: Record<string, unknown>[] = [];
  let committedKey: string | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      if (options.method === 'POST') {
        const body = JSON.parse(String(options.body));
        bodies.push(body);
        if (!committedKey) {
          committedKey = body.idempotency_key;
          throw new TypeError('response lost after cancellation');
        }
        if (body.idempotency_key !== committedKey)
          return new Response(JSON.stringify({ code: 'version_conflict' }), { status: 409 });
        return response(referralPayout('CANCELLED'));
      }
      return response(
        url.pathname.endsWith('/payouts')
          ? { items: [referralPayout()], next_cursor: null }
          : referralSummary(committedKey ? '20.000000' : '0.000000'),
      );
    }),
  );
  const user = userEvent.setup();
  renderReferrals();
  await screen.findByText('PENDING');
  await user.click(screen.getByRole('button', { name: 'Cancel payout' }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: 'Cancel payout' }));
  await screen.findByText('CANCELLED');
  expect(bodies[1]).toEqual(bodies[0]);
  expect(screen.queryByRole('button', { name: 'Cancel payout' })).toBeNull();
  await waitFor(() => expect(balance('Available')).toBe('20.000000 USDT'));
});

it('starts a distinct payout command only when the failed form body is explicitly changed', async () => {
  api.setSession('payout-changed-command', 'csrf');
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      if (options.method === 'POST') {
        bodies.push(JSON.parse(String(options.body)));
        throw new TypeError('ambiguous transport');
      }
      return response(
        url.pathname.endsWith('/payouts') ? { items: [], next_cursor: null } : referralSummary(),
      );
    }),
  );
  const user = userEvent.setup();
  renderReferrals();
  await screen.findByText('RETRY-CODE');
  await user.type(screen.getByLabelText('Payout address'), 'T-address');
  await user.click(screen.getByRole('button', { name: 'Request payout' }));
  await screen.findByRole('alert');
  await user.type(screen.getByLabelText('Payout address'), '-changed');
  await user.click(screen.getByRole('button', { name: 'Request payout' }));
  await screen.findByRole('alert');
  expect(bodies[1].address).toBe('T-address-changed');
  expect(bodies[1].idempotency_key).not.toBe(bodies[0].idempotency_key);
});

it.each(['create', 'cancel'] as const)(
  'ignores a delayed pre-%s refresh after the financial command completes',
  async (operation) => {
    api.setSession(`payout-stale-${operation}`, 'csrf');
    const staleSummary = deferredResponse();
    const stalePayouts = deferredResponse();
    let summaryReads = 0;
    let payoutReads = 0;
    let mutated = false;
    const oldPayouts = operation === 'cancel' ? [referralPayout()] : [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL, options: RequestInit) => {
        if (options.method === 'POST') {
          mutated = true;
          return response(referralPayout(operation === 'cancel' ? 'CANCELLED' : 'PENDING'));
        }
        if (url.pathname.endsWith('/payouts')) {
          if (++payoutReads === 2) return stalePayouts.promise;
          return response({ items: oldPayouts, next_cursor: null });
        }
        if (++summaryReads === 2) return staleSummary.promise;
        return response(
          referralSummary(
            mutated ? (operation === 'cancel' ? '20.000000' : '0.000000') : '9.000000',
          ),
        );
      }),
    );
    const user = userEvent.setup();
    renderReferrals();
    await screen.findByText('RETRY-CODE');
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(payoutReads).toBe(2));
    if (operation === 'create') {
      await user.type(screen.getByLabelText('Payout address'), 'T-address');
      await user.click(screen.getByRole('button', { name: 'Request payout' }));
    } else await user.click(screen.getByRole('button', { name: 'Cancel payout' }));
    await screen.findByText(operation === 'cancel' ? 'CANCELLED' : 'PENDING');
    await waitFor(() =>
      expect(balance('Available')).toBe(
        operation === 'cancel' ? '20.000000 USDT' : '0.000000 USDT',
      ),
    );
    await act(async () => {
      staleSummary.resolve(response(referralSummary('9.000000')));
      stalePayouts.resolve(response({ items: oldPayouts, next_cursor: 'obsolete' }));
    });
    expect(screen.getByText(payoutId)).toBeTruthy();
    expect(screen.getByText(operation === 'cancel' ? 'CANCELLED' : 'PENDING')).toBeTruthy();
    expect(balance('Available')).toBe(operation === 'cancel' ? '20.000000 USDT' : '0.000000 USDT');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    if (operation === 'cancel')
      expect(screen.queryByRole('button', { name: 'Cancel payout' })).toBeNull();
  },
);

it('fences an old history page and cursor when a newer refresh replaces the history', async () => {
  api.setSession('payout-page-generation', 'csrf');
  const oldPage = deferredResponse();
  const cursors: string[] = [];
  let firstPages = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL) => {
      if (!url.pathname.endsWith('/payouts')) return response(referralSummary());
      const cursor = url.searchParams.get('cursor');
      if (cursor) {
        cursors.push(cursor);
        if (cursor === 'old-page') return oldPage.promise;
        return response({
          items: [referralPayout('CANCELLED', '20000000-0000-4000-8000-000000000003')],
          next_cursor: null,
        });
      }
      ++firstPages;
      return response({
        items: [
          referralPayout(
            'PENDING',
            firstPages === 1 ? payoutId : '20000000-0000-4000-8000-000000000002',
          ),
        ],
        next_cursor: firstPages === 1 ? 'old-page' : 'new-page',
      });
    }),
  );
  const user = userEvent.setup();
  renderReferrals();
  await screen.findByText(payoutId);
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  fireEvent(window, new Event('focus'));
  await screen.findByText('20000000-0000-4000-8000-000000000002');
  await act(async () => {
    oldPage.resolve(response({ items: [referralPayout('CANCELLED')], next_cursor: 'stale-next' }));
  });
  expect(screen.queryByText(payoutId)).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByText('20000000-0000-4000-8000-000000000003');
  expect(cursors).toEqual(['old-page', 'new-page']);
});

it('lets only the latest refresh publish and aborts requests when the panel unmounts', async () => {
  api.setSession('payout-latest-refresh', 'csrf');
  const reads: { url: URL; signal: AbortSignal; deferred: PromiseWithResolvers<Response> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: URL, options: RequestInit) => {
      const deferred = deferredResponse();
      reads.push({ url, signal: options.signal!, deferred });
      return deferred.promise;
    }),
  );
  const view = renderReferrals();
  await waitFor(() => expect(reads).toHaveLength(2));
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(reads).toHaveLength(4));
  expect(reads[0].signal.aborted).toBe(true);
  await act(async () => {
    reads[2].deferred.resolve(response(referralSummary('7.000000')));
    reads[3].deferred.resolve(
      response({ items: [referralPayout('CANCELLED')], next_cursor: null }),
    );
  });
  await screen.findByText('CANCELLED');
  await act(async () => {
    reads[0].deferred.resolve(response(referralSummary('99.000000')));
    reads[1].deferred.resolve(response({ items: [], next_cursor: 'stale' }));
  });
  expect(balance('Available')).toBe('7.000000 USDT');
  expect(screen.getByText(payoutId)).toBeTruthy();
  fireEvent(window, new Event('online'));
  await waitFor(() => expect(reads).toHaveLength(6));
  view.unmount();
  expect(reads[4].signal.aborted).toBe(true);
  expect(reads[5].signal.aborted).toBe(true);
});

it('retains the completed payout when its post-command summary is unavailable without claiming the old balance', async () => {
  api.setSession('payout-summary-outage', 'csrf');
  let committed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      if (options.method === 'POST') {
        committed = true;
        return response(referralPayout());
      }
      if (url.pathname.endsWith('/payouts')) return response({ items: [], next_cursor: null });
      if (committed) return new Response('{}', { status: 503 });
      return response(referralSummary());
    }),
  );
  const user = userEvent.setup();
  renderReferrals();
  await screen.findByText('RETRY-CODE');
  await user.type(screen.getByLabelText('Payout address'), 'T-address');
  await user.click(screen.getByRole('button', { name: 'Request payout' }));
  await screen.findByRole('alert');
  expect(screen.getByText(payoutId)).toBeTruthy();
  expect(screen.getByText('PENDING')).toBeTruthy();
  expect(balance('Available')).not.toBe('20.000000 USDT');
});

it('aborts an in-flight payout command when the account panel is replaced and cannot publish into its replacement', async () => {
  api.setSession('referral-account-a', 'csrf');
  const committed = Promise.withResolvers<Response>();
  let commandSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      if (options.method === 'POST') {
        commandSignal = options.signal!;
        return committed.promise;
      }
      return response(
        url.pathname.endsWith('/payouts') ? { items: [], next_cursor: null } : referralSummary(),
      );
    }),
  );
  const user = userEvent.setup();
  const view = renderReferrals();
  await screen.findByText('RETRY-CODE');
  await user.type(screen.getByLabelText('Payout address'), 'T-address');
  await user.click(screen.getByRole('button', { name: 'Request payout' }));
  await waitFor(() => expect(commandSignal).toBeDefined());
  view.unmount();
  expect(commandSignal?.aborted).toBe(true);
  api.setSession('referral-account-b', 'csrf');
  renderReferrals();
  await screen.findByText('RETRY-CODE');
  await act(async () => {
    committed.resolve(response(referralPayout()));
  });
  expect(screen.queryByText(payoutId)).toBeNull();
  expect(balance('Available')).toBe('20.000000 USDT');
});

it('invalidates the in-flight old history page when a payout is created, not only when a refresh replaces it', async () => {
  api.setSession('payout-mutation-page-generation', 'csrf');
  const stale = Promise.withResolvers<Response>();
  let committed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      if (options.method === 'POST') {
        committed = true;
        return response(referralPayout());
      }
      if (url.pathname.endsWith('/payouts')) {
        if (url.searchParams.has('cursor')) return stale.promise;
        return response({ items: [], next_cursor: 'pre-reservation' });
      }
      return response(referralSummary(committed ? '0.000000' : '20.000000'));
    }),
  );
  const user = userEvent.setup();
  renderReferrals();
  await screen.findByText('RETRY-CODE');
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  await user.type(screen.getByLabelText('Payout address'), 'T-address');
  await user.click(screen.getByRole('button', { name: 'Request payout' }));
  await screen.findByText(payoutId);
  await waitFor(() => expect(balance('Available')).toBe('0.000000 USDT'));
  await act(async () => {
    stale.resolve(
      response({
        items: [referralPayout('CANCELLED', '20000000-0000-4000-8000-000000000002')],
        next_cursor: 'stale-next',
      }),
    );
  });
  expect(screen.queryByText('20000000-0000-4000-8000-000000000002')).toBeNull();
  expect(screen.getByText(payoutId)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
});

it('retains the first load-more cursor when another refresh supersedes a pending first-page refresh', async () => {
  api.setSession('payout-overlapping-refresh-cursors', 'csrf');
  const staleSummary = Promise.withResolvers<Response>();
  const stalePayouts = Promise.withResolvers<Response>();
  let summaryReads = 0;
  let firstPages = 0;
  const cursors: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL) => {
      if (url.pathname.endsWith('/payouts')) {
        const cursor = url.searchParams.get('cursor');
        if (cursor) {
          cursors.push(cursor);
          return response({ items: [], next_cursor: null });
        }
        firstPages++;
        if (firstPages === 2) return stalePayouts.promise;
        return response({
          items: firstPages === 1 ? [] : [referralPayout()],
          next_cursor: firstPages === 1 ? 'initial' : 'latest',
        });
      }
      if (++summaryReads === 2) return staleSummary.promise;
      return response(referralSummary(summaryReads === 1 ? '20.000000' : '7.000000'));
    }),
  );
  const user = userEvent.setup();
  renderReferrals();
  await screen.findByText('RETRY-CODE');
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(firstPages).toBe(2));
  fireEvent(window, new Event('online'));
  await screen.findByText(payoutId);
  await act(async () => {
    staleSummary.resolve(response(referralSummary('99.000000')));
    stalePayouts.resolve(response({ items: [], next_cursor: 'obsolete' }));
  });
  expect(screen.getByText(payoutId)).toBeTruthy();
  expect(balance('Available')).toBe('7.000000 USDT');
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(cursors).toEqual(['latest']));
});
