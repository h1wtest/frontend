// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from './api';
import type { Locale } from './i18n';
import { loadCatalog, type CatalogCollection } from './catalog';

import type { LocalizedText, Order } from './generated/businessv1';
export type {
  Feature,
  Product,
  Plan,
  Offer,
  PlanRevision,
  OfferSnapshot,
  Subscription,
  PreparedAction,
  PaymentAttempt,
  Order,
  Entitlement,
  ReferralSummary,
  Overview,
} from './generated/businessv1';
export type Localized = LocalizedText;
export type Catalog = CatalogCollection;
export type Page<T> = { items: T[]; next_cursor: string | null };
export type Network = 'USDTTRC20' | 'USDTBSC';
export type Availability<T> = { status: 'available' | 'unavailable' | 'pending'; data: T | null };

export function localized(value: Localized, locale: Locale) {
  return value[locale] || value.en;
}
export function formatMoney(value: string, locale: Locale): string {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return '—';
  const [whole, fraction] = value.split('.');
  return (
    new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 0 }).format(
      BigInt(whole),
    ) + (fraction === undefined ? '' : (locale === 'ru' ? ',' : '.') + fraction)
  );
}
export function assertOwner(value: { user_id: string }, userId: string) {
  if (value.user_id !== userId) throw new ApiError('ownership_mismatch', 403, 'forbidden');
}
export function paymentStage(state: Order['state']) {
  if (state === 'FULFILLED') return 'fulfilled';
  if (state === 'PAYMENT_ACCEPTED' || state === 'FULFILLMENT_PENDING') return 'accepted';
  if (state === 'REVIEW_REQUIRED') return 'review';
  if (state === 'CANCELLED') return 'cancelled';
  if (state === 'EXPIRED') return 'expired';
  return 'pending';
}
export function publishedOffers(catalog: Catalog) {
  return catalog.plans.flatMap((plan) => {
    const revision = catalog.revisions.find(
      (item) =>
        item.id === plan.current_revision_id &&
        item.plan_id === plan.id &&
        item.state === 'PUBLISHED',
    );
    return revision
      ? revision.offers
          .filter((offer) => offer.revision_id === revision.id)
          .map((offer) => ({ plan, revision, offer }))
      : [];
  });
}
export class CommandAttempts {
  private attempts = new Map<string, { payload: string; key: string }>();
  body<T extends Record<string, unknown>>(
    operation: string,
    body: T,
  ): T & { idempotency_key: string } {
    const payload = JSON.stringify(body);
    let attempt = this.attempts.get(operation);
    if (!attempt || attempt.payload !== payload) {
      attempt = { payload, key: crypto.randomUUID() };
      this.attempts.set(operation, attempt);
    }
    return { ...body, idempotency_key: attempt.key };
  }
  complete(operation: string) {
    this.attempts.delete(operation);
  }
}

// Every refresh supersedes its predecessor; offscreen/unmounted views never publish data.
export function useCommerceQuery<T>(
  path: string,
  identity: string,
  validate?: (data: T) => void,
  loadData?: (signal: AbortSignal) => Promise<T>,
) {
  const [state, setState] = useState<{ data?: T; failure?: unknown; loading: boolean }>({
    loading: true,
  });
  const [revision, setRevision] = useState(0);
  const validation = useRef(validate);
  validation.current = validate;
  const loader = useRef(loadData);
  loader.current = loadData;
  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | undefined;
    let sequence = 0;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      controller?.abort();
      controller = new AbortController();
      const current = ++sequence;
      setState((previous) => ({ ...previous, failure: undefined, loading: true }));
      try {
        const data = loader.current
          ? await loader.current(controller.signal)
          : await api.request<T>(path, { signal: controller.signal });
        validation.current?.(data);
        if (!cancelled && current === sequence) setState({ data, loading: false });
      } catch (failure) {
        if (!cancelled && current === sequence && !controller.signal.aborted)
          setState({ failure, loading: false });
      }
    };
    void load();
    const visible = () => {
      if (document.visibilityState !== 'hidden') void load();
    };
    window.addEventListener('focus', visible);
    window.addEventListener('online', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      cancelled = true;
      controller?.abort();
      window.removeEventListener('focus', visible);
      window.removeEventListener('online', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [path, identity, revision]);
  return { ...state, refresh: () => setRevision((value) => value + 1) };
}

export function useCatalogQuery(identity: string) {
  const path = '/api/v1/catalog/pages';
  return useCommerceQuery<Catalog>(path, identity, undefined, (signal) =>
    loadCatalog(path, signal),
  );
}
