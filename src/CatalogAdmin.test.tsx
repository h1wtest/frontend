// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CatalogAdmin } from './CatalogAdmin';
import { I18nProvider } from './i18n';
import type { AuthSession } from './auth';

const revisionId = '00000000-0000-4000-8000-000000000001';
const planId = '00000000-0000-4000-8000-000000000002';
const productId = '00000000-0000-4000-8000-000000000003';
const offerId = '00000000-0000-4000-8000-000000000004';
const auth: AuthSession = {
  session_id: 'admin',
  csrf_token: 'csrf',
  user: {
    id: '00000000-0000-4000-8000-000000000005',
    email: 'a@example.test',
    is_verified: true,
    mfa_enabled: true,
    roles: ['admin'],
    permissions: ['catalog:read', 'catalog:write', 'catalog:publish'],
  },
};
const revision = {
  id: revisionId,
  plan_id: planId,
  version: 7,
  state: 'DRAFT',
  name: { en: 'Pro', ru: 'Про' },
  description: { en: 'Access', ru: 'Доступ' },
  features: [{ key: 'export', label: { en: 'Export', ru: 'Экспорт' } }],
  offers: [
    {
      id: offerId,
      revision_id: revisionId,
      duration_days: 30,
      price: '12.345678',
      currency: 'USDT',
    },
  ],
};
const catalog = {
  products: [{ id: productId, key: 'main' }],
  plans: [
    {
      id: planId,
      product_id: productId,
      key: 'pro',
      upgrade_rank: 1,
      current_revision_id: null,
      version: 3,
    },
  ],
  revisions: [revision],
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function serve(state = 'DRAFT') {
  const commands: { path: string; body: Record<string, unknown> }[] = [];
  let current = { ...revision, state };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/csrf')) return Response.json({ csrf_token: 'csrf' });
      if (!options?.method || options.method === 'GET')
        return Response.json({ ...catalog, revisions: [current], next_cursor: null });
      const body = JSON.parse(String(options.body));
      commands.push({ path, body });
      if (path.endsWith('/publish')) {
        current = { ...current, state: 'PUBLISHED', version: 9 };
        return Response.json(current);
      }
      current = {
        ...current,
        name: body.name,
        description: body.description,
        features: body.features,
        offers: body.offers.map((offer: object) => ({ ...offer, revision_id: revisionId })),
        version: 8,
      };
      return Response.json(current);
    }),
  );
  render(
    <I18nProvider initialLocale="en">
      <CatalogAdmin auth={auth} />
    </I18nProvider>,
  );
  return commands;
}
it('saves both languages and exact decimal offer text with the draft version, then publishes the returned version', async () => {
  const commands = serve();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Pro.*Draft/ }));
  const editor = await screen.findByRole('form', { name: 'Edit draft' });
  const price = within(editor).getByLabelText('Price (USDT)');
  await user.clear(price);
  await user.type(price, '8999999.999999');
  await user.click(within(editor).getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Changes saved.');
  expect(commands[0].body).toMatchObject({
    expected_version: 7,
    name: { en: 'Pro', ru: 'Про' },
    offers: [{ id: offerId, duration_days: 30, price: '8999999.999999', currency: 'USDT' }],
  });
  await user.click(screen.getByRole('button', { name: 'Publish revision' }));
  const detail = within(screen.getByRole('article', { name: 'Revision' }));
  await detail.findByText('Published · Version 9');
  expect(detail.queryByRole('form', { name: 'Edit draft' })).toBeNull();
  expect(detail.queryByRole('button', { name: 'Save draft' })).toBeNull();
  expect(detail.queryByRole('button', { name: 'Publish revision' })).toBeNull();
  expect(detail.getByRole('button', { name: 'Archive revision' })).toBeTruthy();
  expect(commands[1].body.expected_version).toBe(8);
  expect(typeof commands[1].body.idempotency_key).toBe('string');
});
it('never exposes editing or saving for a published immutable revision', async () => {
  serve('PUBLISHED');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Pro.*Published/ }));
  await screen.findByText(
    'Published revisions are immutable. Create a new draft to change an offer.',
  );
  expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Archive revision' })).toBeTruthy();
});
it('keeps catalog read access independent from publish permission', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ ...catalog, next_cursor: null })),
  );
  render(
    <I18nProvider initialLocale="en">
      <CatalogAdmin auth={{ ...auth, user: { ...auth.user, permissions: ['catalog:read'] } }} />
    </I18nProvider>,
  );
  await userEvent.click(await screen.findByRole('button', { name: /Pro.*Draft/ }));
  expect(screen.queryByRole('button', { name: 'Publish revision' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
});
it('renders Russian revision copy without changing the immutable publication branch', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        ...catalog,
        revisions: [{ ...revision, state: 'PUBLISHED' }],
        next_cursor: null,
      }),
    ),
  );
  render(
    <I18nProvider initialLocale="ru">
      <CatalogAdmin auth={auth} />
    </I18nProvider>,
  );
  await userEvent.click(await screen.findByRole('button', { name: /Про.*Опубликовано/ }));
  await screen.findByText(
    'Опубликованные версии неизменяемы. Для изменения предложения создайте черновик.',
  );
  expect(screen.getByRole('button', { name: 'Архивировать версию' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Сохранить черновик' })).toBeNull();
});
it('shows a stable conflict message rather than raw backend details when publishing a stale version', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/csrf')) return Response.json({ csrf_token: 'csrf' });
      if (options?.method === 'POST')
        return Response.json(
          { code: 'version_conflict', error: 'PRIVATE_PROVIDER_DETAIL' },
          { status: 409 },
        );
      return Response.json({ ...catalog, next_cursor: null });
    }),
  );
  render(
    <I18nProvider initialLocale="en">
      <CatalogAdmin auth={auth} />
    </I18nProvider>,
  );
  await userEvent.click(await screen.findByRole('button', { name: /Pro.*Draft/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Publish revision' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('This record changed.');
  expect(screen.queryByText('PRIVATE_PROVIDER_DETAIL')).toBeNull();
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeTruthy();
});
