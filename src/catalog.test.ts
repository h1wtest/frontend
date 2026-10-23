// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { loadCatalog } from './catalog';
const id = (index: number) => `01900000-0000-7000-8000-${index.toString(16).padStart(12, '0')}`;
afterEach(() => vi.unstubAllGlobals());
it('collects more than 1000 retained revisions across independently empty streams without truncation', async () => {
  const revisions = Array.from({ length: 1001 }, (_, index) => ({
    id: id(index + 10),
    plan_id: id(2),
    version: index + 1,
    state: 'ARCHIVED',
    name: { en: 'History', ru: 'История' },
    description: { en: '', ru: '' },
    features: [],
    offers: [],
  }));
  const seen: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL) => {
      const url = new URL(String(input));
      seen.push(url.pathname);
      const page = url.searchParams.has('cursor')
        ? Number(url.searchParams.get('cursor')?.split(':')[1])
        : 0;
      return Response.json({
        products: page === 0 ? [{ id: id(1), key: 'main' }] : [],
        plans:
          page === 1
            ? [
                {
                  id: id(2),
                  product_id: id(1),
                  key: 'pro',
                  upgrade_rank: 1,
                  current_revision_id: null,
                  version: 1,
                },
              ]
            : [],
        revisions: revisions.slice(page * 100, (page + 1) * 100),
        next_cursor: (page + 1) * 100 < revisions.length ? `opaque:${page + 1}` : null,
      });
    }),
  );
  const result = await loadCatalog('/api/v1/admin/catalog/pages', new AbortController().signal);
  expect(result.revisions).toHaveLength(1001);
  expect(result.plans[0].product_id).toBe(result.products[0].id);
  expect(seen).toHaveLength(11);
  expect(seen.every((path) => path === '/api/v1/admin/catalog/pages')).toBe(true);
});
it('rejects repeated cursors rather than returning partial success or looping', async () => {
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      calls++;
      return Response.json({
        products: [{ id: id(1), key: 'main' }],
        plans: [],
        revisions: [],
        next_cursor: 'repeated',
      });
    }),
  );
  await expect(
    loadCatalog('/api/v1/catalog/pages', new AbortController().signal),
  ).rejects.toMatchObject({ code: 'invalid_response' });
  expect(calls).toBe(2);
});
it('deduplicates immutable IDs when successive pages overlap', async () => {
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      calls++;
      return Response.json({
        products: [{ id: id(1), key: 'main' }],
        plans: [],
        revisions: [],
        next_cursor: calls === 1 ? 'next' : null,
      });
    }),
  );
  const catalog = await loadCatalog('/api/v1/catalog/pages', new AbortController().signal);
  expect(catalog.products).toEqual([{ id: id(1), key: 'main' }]);
  expect(calls).toBe(2);
});
it('aborts traversal before requesting the next page and never returns a partial catalog', async () => {
  const controller = new AbortController();
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      calls++;
      controller.abort();
      return Response.json({ products: [], plans: [], revisions: [], next_cursor: 'next' });
    }),
  );
  await expect(loadCatalog('/api/v1/catalog/pages', controller.signal)).rejects.toBeDefined();
  expect(calls).toBe(1);
});
it('orders accumulated plans by product key then upgrade rank then plan key, not UUID or page order', async () => {
  const makePlan = (index: number, product: number, key: string, rank: number) => ({
    id: id(index),
    product_id: id(product),
    key,
    upgrade_rank: rank,
    current_revision_id: null,
    version: 1,
  });
  let page = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      page++;
      return Response.json(
        page === 1
          ? {
              products: [{ id: id(1), key: 'zeta' }],
              plans: [makePlan(10, 2, 'aaa-pro', 2), makePlan(11, 1, 'basic', 1)],
              revisions: [],
              next_cursor: 'late-product',
            }
          : {
              products: [{ id: id(2), key: 'alpha' }],
              plans: [makePlan(12, 2, 'zzz-basic', 1), makePlan(13, 2, 'bbb-pro', 2)],
              revisions: [],
              next_cursor: null,
            },
      );
    }),
  );
  const catalog = await loadCatalog('/api/v1/catalog/pages', new AbortController().signal);
  expect(catalog.products.map((product) => product.key)).toEqual(['alpha', 'zeta']);
  expect(catalog.plans.map((plan) => plan.id)).toEqual([id(12), id(10), id(13), id(11)]);
});
