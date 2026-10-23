// SPDX-License-Identifier: MIT
import { api, ApiError } from './api';
import type { Product, Plan, PlanRevision } from './generated/businessv1';
// Each response is schema checked independently; the complete retained history has no page-size cap.
export interface CatalogCollection {
  products: Product[];
  plans: Plan[];
  revisions: PlanRevision[];
}
type CatalogPath = '/api/v1/catalog/pages' | '/api/v1/admin/catalog/pages';
export async function loadCatalog(
  path: CatalogPath,
  signal: AbortSignal,
): Promise<CatalogCollection> {
  const products = new Map<string, Product>();
  const plans = new Map<string, Plan>();
  const revisions = new Map<string, PlanRevision>();
  const visited = new Set<string>();
  let cursor: string | null = null;
  do {
    signal.throwIfAborted();
    const page: CatalogCollection & { next_cursor: string | null } = await api.request(
      `${path}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      { signal },
    );
    signal.throwIfAborted();
    for (const product of page.products) products.set(product.id, product);
    for (const plan of page.plans) plans.set(plan.id, plan);
    for (const revision of page.revisions) revisions.set(revision.id, revision);
    cursor = page.next_cursor;
    if (cursor !== null) {
      if (!cursor || visited.has(cursor))
        throw new ApiError('invalid_response', 502, 'invalid_response');
      visited.add(cursor);
    }
  } while (cursor !== null);
  return {
    products: [...products.values()].sort((left, right) => left.key.localeCompare(right.key)),
    plans: [...plans.values()].sort(
      (left, right) =>
        (products.get(left.product_id)?.key ?? left.product_id).localeCompare(
          products.get(right.product_id)?.key ?? right.product_id,
        ) ||
        left.upgrade_rank - right.upgrade_rank ||
        left.key.localeCompare(right.key),
    ),
    revisions: [...revisions.values()].map((revision) => ({
      ...revision,
      offers: [...revision.offers].sort((left, right) => left.duration_days - right.duration_days),
    })),
  };
}
