// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommerceAdmin } from './CommerceAdmin';
import { I18nProvider } from './i18n';
import type { AuthSession } from './auth';
const orderId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const productId = '00000000-0000-4000-8000-000000000003';
const actionId = '00000000-0000-4000-8000-000000000004';
const attemptId = '00000000-0000-4000-8000-000000000005';
const planId = '00000000-0000-4000-8000-000000000006';
const revisionId = '00000000-0000-4000-8000-000000000007';
const offerId = '00000000-0000-4000-8000-000000000008';
const subscriptionId = '00000000-0000-4000-8000-000000000009';
const evidenceId = '00000000-0000-4000-8000-000000000010';
const batchId = '00000000-0000-4000-8000-000000000011';
const auth: AuthSession = {
  session_id: 's',
  csrf_token: 'csrf',
  user: {
    id: userId,
    email: 'a@example.test',
    mfa_enabled: true,
    is_verified: true,
    roles: ['admin'],
    permissions: [
      'billing:read',
      'billing:resolve',
      'subscriptions:read',
      'subscriptions:close',
      'subscriptions:compensate',
    ],
  },
};
const order = {
  id: orderId,
  user_id: userId,
  product_id: productId,
  action_id: actionId,
  subscription_id: null,
  kind: 'INITIAL',
  amount: '12.345678',
  currency: 'USDT',
  state: 'REVIEW_REQUIRED',
  version: 4,
  created_at: '2026-10-24T00:00:00Z',
  updated_at: '2026-10-24T00:00:00Z',
  payment_attempt: {
    id: attemptId,
    state: 'REVIEW_REQUIRED',
    provider_payment_id: '9007199254740993123',
    provider_root_id: null,
    network: 'USDTTRC20',
    pay_address: 'address',
    pay_amount: '12.345678',
    actually_paid: '12.345678',
    provider_status: 'PRIVATE_PROVIDER_DETAIL',
    expires_at: null,
    next_reconcile_at: null,
  },
  fulfillment_error: null,
  offer_snapshot: {
    product_id: productId,
    plan_id: planId,
    plan_key: 'pro',
    upgrade_rank: 1,
    revision_id: revisionId,
    offer_id: offerId,
    duration_days: 30,
    price: '12.345678',
    currency: 'USDT',
    name: { en: 'Pro', ru: 'Про' },
    features: [],
    snapshot_hash: 'a'.repeat(64),
  },
  commission_quote_id: null,
  accepted_at: null,
};
const subscription = {
  id: subscriptionId,
  user_id: userId,
  product_id: productId,
  plan_id: planId,
  revision_id: revisionId,
  offer_id: offerId,
  state: 'ACTIVE',
  version: 5,
  current_period_start: '2026-10-01T00:00:00Z',
  current_period_end: '2026-11-01T00:00:00Z',
  cancel_at_period_end: false,
  next_offer_id: null,
  features: [],
  pending_period: null,
  current_offer_snapshot: order.offer_snapshot,
  next_offer_snapshot: null,
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function serve(session = auth) {
  const commands: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/csrf')) return Response.json({ csrf_token: 'csrf' });
      if (options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        commands.push({ path, body });
        if (path.endsWith('/preview'))
          return Response.json({
            id: batchId,
            version: 1,
            state: 'PREVIEW',
            days: 2,
            recipient_count: 1,
            total_days: 2,
            reason: 'Outage',
            recipients: [
              {
                subscription_id: subscriptionId,
                expected_version: 5,
                state: 'PENDING',
                result_version: null,
              },
            ],
            created_at: '2026-10-24T00:00:00Z',
          });
        if (path.endsWith('/apply'))
          return Response.json({
            id: batchId,
            version: 2,
            state: 'APPLIED',
            days: 2,
            recipient_count: 1,
            total_days: 2,
            reason: 'Outage',
            recipients: [
              {
                subscription_id: subscriptionId,
                expected_version: 5,
                state: 'CONFLICT',
                result_version: null,
              },
            ],
            created_at: '2026-10-24T00:00:00Z',
          });
        if (path.endsWith('/close'))
          return Response.json({ ...subscription, version: 6, state: 'CLOSED' });
        return Response.json({ ...order, version: 5, state: 'PAYMENT_ACCEPTED' });
      }
      if (path === `/api/v1/admin/payments/${orderId}/status`) return Response.json(order);
      if (path === `/api/v1/admin/payments/${orderId}`)
        return Response.json({
          order,
          evidence: [
            {
              id: evidenceId,
              source: 'STATUS',
              provider_payment_id: '9007199254740993123',
              observed_at: '2026-10-24T00:00:00Z',
              signature_valid: false,
              payload: {
                payment_id: '9007199254740993123',
                order_id: orderId,
                price_amount: '12.345678',
                price_currency: 'USDT',
                pay_currency: 'usdttrc20',
                pay_amount: '12.345678',
                actually_paid: '12.345678',
                payment_status: 'finished',
                parent_payment_id: null,
              },
            },
          ],
          decisions: [],
        });
      if (path.endsWith('/payments')) return Response.json({ items: [order], next_cursor: null });
      if (path === `/api/v1/admin/subscriptions/${subscriptionId}`)
        return Response.json(subscription);
      return Response.json({ items: [subscription], next_cursor: null });
    }),
  );
  render(
    <I18nProvider initialLocale="en">
      <CommerceAdmin auth={session} />
    </I18nProvider>,
  );
  return commands;
}
it('restricts SUPPORT to safe statuses without evidence or financial mutation controls', async () => {
  serve({
    ...auth,
    user: {
      ...auth.user,
      roles: ['support'],
      permissions: ['billing:status:read', 'subscriptions:read'],
    },
  });
  await userEvent.click(await screen.findByRole('button', { name: orderId }));
  await screen.findByText('9007199254740993123');
  expect(screen.queryByText('PRIVATE_PROVIDER_DETAIL')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Payment evidence' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Accept payment' })).toBeNull();
});
it('shows no alerts for healthy lists, disabled detail reads, loaded payment and subscription detail', async () => {
  serve();
  await screen.findByRole('button', { name: orderId });
  await screen.findByRole('checkbox', { name: new RegExp(subscriptionId) });
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: orderId }));
  await screen.findByRole('form', { name: 'Resolve payment' });
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: subscriptionId }));
  await screen.findByRole('form', { name: 'Close subscription' });
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
});
it('shows one localized alert for a failed enabled detail request while disabled reads stay silent', async () => {
  serve();
  const fetchHealthy = globalThis.fetch;
  vi.stubGlobal('fetch', (input: URL, options?: RequestInit) =>
    new URL(String(input)).pathname === `/api/v1/admin/payments/${orderId}`
      ? Promise.resolve(
          Response.json(
            { error: 'PRIVATE_PROVIDER_DETAIL', code: 'dependency_unavailable' },
            { status: 503 },
          ),
        )
      : fetchHealthy(input, options),
  );
  await userEvent.click(await screen.findByRole('button', { name: orderId }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('temporarily unavailable');
  expect(screen.queryAllByRole('alert')).toHaveLength(1);
  expect(screen.queryByText('PRIVATE_PROVIDER_DETAIL')).toBeNull();
});
it('accepts explicit external evidence with exact text amount, reason, CAS and idempotency', async () => {
  const commands = serve();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: orderId }));
  const form = await screen.findByRole('form', { name: 'Resolve payment' });
  const detail = within(screen.getByRole('article', { name: orderId }));
  expect(detail.getByText('4')).toBeTruthy();
  expect(detail.queryByText('Payment accepted')).toBeNull();
  await user.type(within(form).getByLabelText('Reason'), 'Verified external settlement');
  await user.selectOptions(within(form).getByLabelText('Acceptance evidence'), 'external');
  await user.type(within(form).getByLabelText('External amount (USDT)'), '12.345678');
  await user.type(within(form).getByLabelText('External reference'), 'bank-checked-1');
  await user.click(within(form).getByRole('button', { name: 'Accept payment' }));
  await detail.findByText('Payment accepted');
  expect(detail.getByText('5')).toBeTruthy();
  expect(detail.getByText('12.345678 USDT')).toBeTruthy();
  expect(commands[0]).toMatchObject({
    path: `/api/v1/admin/payments/${orderId}/accept`,
    body: {
      expected_version: 4,
      reason: 'Verified external settlement',
      external_payment: { amount: '12.345678', network: 'USDTTRC20', reference: 'bank-checked-1' },
    },
  });
  expect(typeof commands[0].body.idempotency_key).toBe('string');
  expect(screen.queryByText('PRIVATE_PROVIDER_DETAIL')).toBeNull();
});
it.each([
  ['Reverify payment', 'reverify'],
  ['Reject payment', 'reject'],
  ['Retry fulfillment', 'retry-fulfillment'],
])('uses the %s command without acceptance evidence', async (label, operation) => {
  const commands = serve();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: orderId }));
  const form = await screen.findByRole('form', { name: 'Resolve payment' });
  await user.type(within(form).getByLabelText('Reason'), 'Investigated');
  await user.click(within(form).getByRole('button', { name: label }));
  await waitFor(() => expect(commands.length).toBe(1));
  expect(commands[0].path).toBe(`/api/v1/admin/payments/${orderId}/${operation}`);
  expect(commands[0].body).toMatchObject({ expected_version: 4, reason: 'Investigated' });
  expect(commands[0].body.external_payment).toBeUndefined();
});
it('applies only the frozen compensation and displays per-recipient conflict without silently retrying it', async () => {
  const commands = serve();
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText(`Select ${subscriptionId}`));
  const form = screen.getByRole('form', { name: 'Compensation preview' });
  await user.type(within(form).getByLabelText('Days'), '2');
  await user.type(within(form).getByLabelText('Reason'), 'Outage');
  await user.click(within(form).getByRole('button', { name: 'Freeze preview' }));
  await screen.findByText('Frozen recipients');
  expect(screen.getByText('Recipients: 1 · Total days: 2')).toBeTruthy();
  await user.click(screen.getByLabelText(`Select ${subscriptionId}`));
  await user.click(screen.getByRole('button', { name: 'Apply compensation' }));
  await screen.findByText('Version conflict');
  expect(commands[0].body.subscription_ids).toEqual([subscriptionId]);
  expect(commands[1]).toMatchObject({
    path: `/api/v1/admin/subscriptions/compensations/${batchId}/apply`,
    body: { expected_version: 1, reason: 'Outage' },
  });
  expect(commands.length).toBe(2);
});
it('accepts selected saved monetary evidence rather than treating a signature as payment', async () => {
  const commands = serve();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: orderId }));
  const form = await screen.findByRole('form', { name: 'Resolve payment' });
  const detail = within(screen.getByRole('article', { name: orderId }));
  expect(detail.getByText('4')).toBeTruthy();
  expect(detail.queryByText('Payment accepted')).toBeNull();
  await user.type(within(form).getByLabelText('Reason'), 'Independent status checked');
  await user.selectOptions(within(form).getByLabelText('Evidence ID'), evidenceId);
  await user.click(within(form).getByRole('button', { name: 'Accept payment' }));
  await detail.findByText('Payment accepted');
  expect(detail.getByText('5')).toBeTruthy();
  expect(detail.getByText('12.345678 USDT')).toBeTruthy();
  expect(commands[0].body).toMatchObject({
    expected_version: 4,
    evidence_id: evidenceId,
    reason: 'Independent status checked',
  });
  expect(commands[0].body.external_payment).toBeUndefined();
  expect(commands[0].path).toBe(`/api/v1/admin/payments/${orderId}/accept`);
  expect(typeof commands[0].body.idempotency_key).toBe('string');
});
it('rereads persisted manual settlement proof as safe exact fields without treating it as accepted payment', async () => {
  const commands = serve();
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', (input: URL, options?: RequestInit) =>
    new URL(String(input)).pathname === `/api/v1/admin/payments/${orderId}` &&
    options?.method === 'GET'
      ? Promise.resolve(
          Response.json({
            order,
            decisions: [],
            evidence: [
              {
                id: evidenceId,
                source: 'MANUAL',
                provider_payment_id: null,
                observed_at: '2026-10-24T00:00:00Z',
                signature_valid: false,
                payload: {
                  external_amount: '12.345678',
                  external_network: 'USDTBSC',
                  external_reference: 'external-proof-reference',
                },
              },
            ],
          }),
        )
      : original(input, options),
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: orderId }));
  const proof = within(await screen.findByRole('region', { name: evidenceId }));
  expect(proof.getByText('12.345678')).toBeTruthy();
  expect(proof.getByText('USDTBSC')).toBeTruthy();
  expect(proof.getByText('external-proof-reference')).toBeTruthy();
  const detail = within(screen.getByRole('article', { name: orderId }));
  expect(detail.queryByText('Payment accepted')).toBeNull();
  const form = within(screen.getByRole('form', { name: 'Resolve payment' }));
  await user.type(form.getByLabelText('Reason'), 'Persisted settlement independently checked');
  await user.selectOptions(form.getByLabelText('Evidence ID'), evidenceId);
  await user.click(form.getByRole('button', { name: 'Accept payment' }));
  await detail.findByText('Payment accepted');
  expect(commands[0].body).toMatchObject({
    evidence_id: evidenceId,
    expected_version: 4,
    reason: 'Persisted settlement independently checked',
  });
  expect(commands[0].body.external_payment).toBeUndefined();
});
it('does not submit acceptance with no monetary evidence and preserves the reason for correction', async () => {
  const commands = serve();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: orderId }));
  const form = await screen.findByRole('form', { name: 'Resolve payment' });
  await user.type(within(form).getByLabelText('Reason'), 'Investigating');
  await user.click(within(form).getByRole('button', { name: 'Accept payment' }));
  await within(form).findByRole('alert');
  expect(commands.length).toBe(0);
  expect((within(form).getByLabelText('Reason') as HTMLInputElement).value).toBe('Investigating');
});
it('closes the selected subscription with its own version and reason', async () => {
  const commands = serve();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: subscriptionId }));
  const form = await screen.findByRole('form', { name: 'Close subscription' });
  await user.type(within(form).getByLabelText('Reason'), 'Account closure requested');
  await user.click(within(form).getByRole('button', { name: 'Close subscription' }));
  await screen.findByText('Closed');
  expect(commands[0]).toMatchObject({
    path: `/api/v1/admin/subscriptions/${subscriptionId}/close`,
    body: { expected_version: 5, reason: 'Account closure requested' },
  });
  expect(typeof commands[0].body.idempotency_key).toBe('string');
});
it('clears selected payment evidence immediately when the session changes', async () => {
  serve();
  cleanup();
  const view = render(
    <I18nProvider initialLocale="en">
      <CommerceAdmin auth={auth} />
    </I18nProvider>,
  );
  await userEvent.click(await screen.findByRole('button', { name: orderId }));
  await screen.findByRole('heading', { name: 'Payment evidence' });
  view.rerender(
    <I18nProvider initialLocale="en">
      <CommerceAdmin
        auth={{
          ...auth,
          session_id: 'new-session',
          user: {
            ...auth.user,
            id: userId,
            permissions: ['billing:status:read'],
            roles: ['support'],
          },
        }}
      />
    </I18nProvider>,
  );
  expect(screen.queryByRole('heading', { name: 'Payment evidence' })).toBeNull();
  expect(screen.queryByRole('form', { name: 'Resolve payment' })).toBeNull();
});
it.each([
  ['en', ['Reverify payment', 'Accept payment', 'Reject payment', 'Retry fulfillment']],
  [
    'ru',
    ['Перепроверить платёж', 'Подтвердить платёж', 'Отклонить платёж', 'Повторить применение'],
  ],
] as const)('renders retained administrative decision operations in %s', async (locale, labels) => {
  serve();
  cleanup();
  const fetchHealthy = globalThis.fetch;
  const operations = ['admin:reverify', 'admin:accept', 'admin:reject', 'admin:retry-fulfillment'];
  vi.stubGlobal('fetch', (input: URL, options?: RequestInit) =>
    new URL(String(input)).pathname === `/api/v1/admin/payments/${orderId}` &&
    options?.method === 'GET'
      ? Promise.resolve(
          Response.json({
            order,
            evidence: [],
            decisions: operations.map((operation, index) => ({
              id: `00000000-0000-4000-8000-${(index + 20).toString().padStart(12, '0')}`,
              actor_user_id: userId,
              operation,
              reason: `retained-decision-${index}`,
              created_at: '2026-10-24T00:00:00Z',
              evidence_id: null,
            })),
          }),
        )
      : fetchHealthy(input, options),
  );
  render(
    <I18nProvider initialLocale={locale}>
      <CommerceAdmin auth={{ ...auth, user: { ...auth.user, permissions: ['billing:read'] } }} />
    </I18nProvider>,
  );
  await userEvent.click(await screen.findByRole('button', { name: orderId }));
  for (const [index, label] of labels.entries()) {
    const record = await screen.findByText(
      (_, element) =>
        element?.tagName === 'LI' &&
        element.textContent?.includes(`retained-decision-${index}`) === true,
    );
    expect(record.textContent).toContain(label);
    expect(record.textContent).toContain(userId);
  }
});
