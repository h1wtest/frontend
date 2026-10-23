// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from './api';
import type { AuthSession } from './auth';
import { ActionButton, ActionForm, Field, Time, value } from './components';
import { useI18n, useText } from './i18n';
import { commerceMessages } from './commerce-resources';
import {
  CommandAttempts,
  assertOwner,
  formatMoney,
  localized,
  paymentStage,
  publishedOffers,
  useCommerceQuery,
  useCatalogQuery,
} from './commerce';
import type {
  Catalog,
  Entitlement,
  Network,
  Order,
  Page,
  PreparedAction,
  Subscription,
} from './commerce';

type Section = 'catalog' | 'subscriptions' | 'payments';
type Commander = <T>(operation: string, path: string, body: Record<string, unknown>) => Promise<T>;
function useCommands(): Commander {
  const attempts = useRef(new CommandAttempts());
  const active = useRef(true);
  const pending = useRef(new Set<AbortController>());
  useEffect(() => {
    active.current = true;
    const controllers = pending.current;
    return () => {
      active.current = false;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);
  return async <T,>(operation: string, path: string, body: Record<string, unknown>) => {
    const controller = new AbortController();
    pending.current.add(controller);
    try {
      const result = await api.request<T>(path, {
        method: 'POST',
        body: attempts.current.body(operation, body),
        signal: controller.signal,
      });
      if (!active.current || controller.signal.aborted)
        throw new ApiError('auth_context_changed', 0, 'auth_context_changed');
      attempts.current.complete(operation);
      return result;
    } finally {
      pending.current.delete(controller);
    }
  };
}
function QueryFeedback({ loading, failure }: { loading: boolean; failure?: unknown }) {
  const t = useText(commerceMessages);
  const { error } = useI18n();
  return (
    <>
      {loading && <p role="status">{t('loading')}</p>}
      {failure != null && (
        <p role="alert" className="error">
          {error(failure)}
        </p>
      )}
    </>
  );
}
function NetworkChoice({
  network,
  setNetwork,
}: {
  network: Network;
  setNetwork: (network: Network) => void;
}) {
  const t = useText(commerceMessages);
  return (
    <label className="field">
      <span>{t('network')}</span>
      <select value={network} onChange={(event) => setNetwork(event.target.value as Network)}>
        <option value="USDTTRC20">USDT · TRC20</option>
        <option value="USDTBSC">USDT · BSC</option>
      </select>
    </label>
  );
}
function Status({ order }: { order: Order }) {
  const t = useText(commerceMessages);
  return <p className="badge">{t(paymentStage(order.state))}</p>;
}
function OwnOrder({
  id,
  auth,
  command,
  close,
}: {
  id: string;
  auth: AuthSession;
  command: Commander;
  close: () => void;
}) {
  const t = useText(commerceMessages);
  const { locale } = useI18n();
  const query = useCommerceQuery<Order>(
    `/api/v1/orders/${encodeURIComponent(id)}`,
    auth.session_id,
    (order) => assertOwner(order, auth.user.id),
  );
  const order = query.data;
  return (
    <section className="card" aria-label={t('orderId')}>
      <h3>
        {t('orderId')}: <code>{id}</code>
      </h3>
      <div className="actions">
        <button type="button" onClick={query.refresh}>
          {t('refresh')}
        </button>
        <button type="button" onClick={close}>
          {t('close')}
        </button>
      </div>
      <QueryFeedback loading={query.loading} failure={query.failure} />
      {order && (
        <>
          <h4>{localized(order.offer_snapshot.name, locale)}</h4>
          <Status order={order} />
          <dl>
            <dt>{t('amount')}</dt>
            <dd>
              {formatMoney(order.amount, locale)} {order.currency}
            </dd>
            <dt>{t('network')}</dt>
            <dd>{order.payment_attempt.network}</dd>
            <dt>{t('created')}</dt>
            <dd>
              <Time value={order.created_at} />
            </dd>
            {order.payment_attempt.provider_payment_id && (
              <>
                <dt>{t('providerId')}</dt>
                <dd>
                  <code>{order.payment_attempt.provider_payment_id}</code>
                </dd>
              </>
            )}
            {order.payment_attempt.pay_amount && (
              <>
                <dt>{t('payAmount')}</dt>
                <dd>{formatMoney(order.payment_attempt.pay_amount, locale)} USDT</dd>
              </>
            )}
            {order.payment_attempt.pay_address && (
              <>
                <dt>{t('address')}</dt>
                <dd>
                  <code style={{ overflowWrap: 'anywhere' }}>
                    {order.payment_attempt.pay_address}
                  </code>
                </dd>
              </>
            )}
            {order.payment_attempt.actually_paid && (
              <>
                <dt>{t('received')}</dt>
                <dd>{formatMoney(order.payment_attempt.actually_paid, locale)} USDT</dd>
              </>
            )}
            {order.payment_attempt.expires_at && (
              <>
                <dt>{t('expires')}</dt>
                <dd>
                  <Time value={order.payment_attempt.expires_at} />
                </dd>
              </>
            )}
          </dl>
          {order.payment_attempt.state === 'CREATE_UNKNOWN' ? (
            <p role="status">{t('unknownCreate')}</p>
          ) : (
            !order.payment_attempt.pay_address &&
            paymentStage(order.state) === 'pending' && <p>{t('pendingAddress')}</p>
          )}
          {order.payment_attempt.pay_address && paymentStage(order.state) === 'pending' && (
            <p>{t('networkWarning')}</p>
          )}
          {order.payment_attempt.state === 'UNPAID' &&
            !order.accepted_at &&
            (order.state === 'PREPARING' || order.state === 'PAYMENT_PENDING') && (
              <ActionButton
                danger
                action={async () => {
                  const updated = await command<Order>(
                    `cancel-order:${order.id}`,
                    `/api/v1/orders/${encodeURIComponent(order.id)}/cancel`,
                    { expected_version: order.version },
                  );
                  assertOwner(updated, auth.user.id);
                  query.refresh();
                }}
              >
                {t('cancelOrder')}
              </ActionButton>
            )}
        </>
      )}
    </section>
  );
}
function CatalogView({
  auth,
  command,
  open,
}: {
  auth: AuthSession;
  command: Commander;
  open: (id: string) => void;
}) {
  const t = useText(commerceMessages);
  const { locale } = useI18n();
  const query = useCatalogQuery(auth.session_id);
  const [network, setNetwork] = useState<Network>('USDTTRC20');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const offers = query.data ? publishedOffers(query.data) : [];
  return (
    <>
      <button type="button" onClick={query.refresh}>
        {t('refresh')}
      </button>
      <QueryFeedback loading={query.loading} failure={query.failure ?? failure} />
      {!auth.user.is_verified && <p role="status">{t('verify')}</p>}
      <NetworkChoice network={network} setNetwork={setNetwork} />
      <p>{t('networkWarning')}</p>
      {query.data && offers.length === 0 && <p>{t('emptyCatalog')}</p>}
      <div className="grid">
        {offers.map(({ plan, revision, offer }) => (
          <article className="card" key={offer.id}>
            <p className="muted">
              {query.data?.products.find((product) => product.id === plan.product_id)?.key}
            </p>
            <h3>{localized(revision.name, locale)}</h3>
            <p>{localized(revision.description, locale)}</p>
            <ul>
              {revision.features.map((feature) => (
                <li key={feature.key}>{localized(feature.label, locale)}</li>
              ))}
            </ul>
            <p>
              {offer.duration_days} {t('days')} · {formatMoney(offer.price, locale)}{' '}
              {offer.currency}
            </p>
            <button
              className="primary"
              type="button"
              disabled={!auth.user.is_verified || busy}
              onClick={async () => {
                setBusy(true);
                setFailure(undefined);
                try {
                  const order = await command<Order>(`checkout:${offer.id}`, '/api/v1/orders', {
                    offer_id: offer.id,
                    kind: 'INITIAL',
                    network,
                  });
                  assertOwner(order, auth.user.id);
                  open(order.id);
                } catch (error) {
                  setFailure(error);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('buy')}
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
function OrdersView({ auth, open }: { auth: AuthSession; open: (id: string) => void }) {
  const t = useText(commerceMessages);
  const { locale } = useI18n();
  const [cursor, setCursor] = useState('');
  const query = useCommerceQuery<Page<Order>>(
    `/api/v1/orders?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    auth.session_id,
    (page) => page.items.forEach((order) => assertOwner(order, auth.user.id)),
  );
  return (
    <>
      <div className="actions">
        <button type="button" onClick={query.refresh}>
          {t('refresh')}
        </button>
        {cursor && (
          <button type="button" onClick={() => setCursor('')}>
            {t('first')}
          </button>
        )}
      </div>
      <ActionForm
        title={t('recover')}
        submit={t('open')}
        onSubmit={async (form) => {
          open(value(form, 'order_id').trim());
        }}
      >
        <Field label={t('orderId')} name="order_id" required maxLength={128} />
      </ActionForm>
      <QueryFeedback loading={query.loading} failure={query.failure} />
      {query.data && query.data.items.length === 0 && <p>{t('emptyOrders')}</p>}
      <div className="grid">
        {query.data?.items.map((order) => (
          <article className="card" key={order.id}>
            <h3>{localized(order.offer_snapshot.name, locale)}</h3>
            <Status order={order} />
            <p>
              {formatMoney(order.amount, locale)} {order.currency}
            </p>
            <Time value={order.created_at} />
            <p>
              <code>{order.id}</code>
            </p>
            <button type="button" onClick={() => open(order.id)}>
              {t('open')}
            </button>
          </article>
        ))}
      </div>
      {query.data?.next_cursor && (
        <button type="button" onClick={() => setCursor(query.data!.next_cursor!)}>
          {t('more')}
        </button>
      )}
    </>
  );
}
function Access({ subscription, auth }: { subscription: Subscription; auth: AuthSession }) {
  const t = useText(commerceMessages);
  const { locale } = useI18n();
  const query = useCommerceQuery<Entitlement>(
    `/api/v1/subscriptions/${encodeURIComponent(subscription.id)}/entitlement`,
    `${auth.session_id}:${subscription.version}`,
    (data) => {
      if (data.subscription_id !== subscription.id)
        throw new ApiError('forbidden', 403, 'forbidden');
    },
  );
  return (
    <div>
      {query.loading ? (
        <p role="status">{t('loading')}</p>
      ) : query.failure ? (
        <p role="alert">{t('accessUnavailable')}</p>
      ) : (
        query.data && (
          <>
            <p className="badge">{t(query.data.allowed ? 'accessAllowed' : 'accessDenied')}</p>
            <ul>
              {query.data.features.map((feature) => (
                <li key={feature.key}>{localized(feature.label, locale)}</li>
              ))}
            </ul>
            <p>
              {t('accessChecked')}: <Time value={query.data.checked_at} />
            </p>
          </>
        )
      )}
      <button type="button" onClick={query.refresh}>
        {t('refresh')}
      </button>
    </div>
  );
}
function SubscriptionCard({
  subscription: sub,
  catalog,
  auth,
  command,
  refresh,
  open,
}: {
  subscription: Subscription;
  catalog?: Catalog;
  auth: AuthSession;
  command: Commander;
  refresh: () => void;
  open: (id: string) => void;
}) {
  const t = useText(commerceMessages);
  const { locale } = useI18n();
  const choices = catalog
    ? publishedOffers(catalog).filter((item) => item.plan.product_id === sub.product_id)
    : [];
  const [target, setTarget] = useState('');
  const [network, setNetwork] = useState<Network>('USDTTRC20');
  const [quote, setQuote] = useState<PreparedAction>();
  const [now, setNow] = useState(Date.now());
  const selected =
    target ||
    choices.find((item) => item.plan.id !== sub.plan_id)?.offer.id ||
    choices[0]?.offer.id ||
    '';
  const current = sub.current_offer_snapshot;
  const next = sub.next_offer_snapshot;
  const currentRank = current.upgrade_rank;
  const targetChoice = choices.find((item) => item.offer.id === selected);
  const periodEnded = new Date(sub.current_period_end).getTime() <= now;
  const active = sub.state === 'ACTIVE' && !periodEnded;
  const quoteExpired = !!quote && new Date(quote.expires_at).getTime() <= now;
  useEffect(() => {
    if (!quote) return;
    const remaining = new Date(quote.expires_at).getTime() - Date.now();
    if (remaining <= 0) {
      setNow(Date.now());
      return;
    }
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(remaining + 1, 2147483647));
    return () => window.clearTimeout(timer);
  }, [quote]);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState !== 'hidden') setNow(Date.now());
    };
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    let timer: number | undefined;
    const scheduleBoundary = () => {
      const current = Date.now();
      // Invalidate old access even while hidden; the query waits for visibility to read again.
      setNow(current);
      const remaining = new Date(sub.current_period_end).getTime() - current;
      if (remaining > 0)
        timer = window.setTimeout(scheduleBoundary, Math.min(remaining, 2147483647));
    };
    scheduleBoundary();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [sub.current_period_end]);
  const prepare = async (kind: 'renew' | 'upgrade-quote') => {
    if (!auth.user.is_verified) throw new ApiError('email_not_verified', 403, 'email_not_verified');
    const action = await command<PreparedAction>(
      `${kind}:${sub.id}`,
      `/api/v1/subscriptions/${encodeURIComponent(sub.id)}/${kind}`,
      {
        expected_version: sub.version,
        offer_id: kind === 'renew' ? (sub.next_offer_id ?? sub.offer_id) : selected,
      },
    );
    assertOwner(action, auth.user.id);
    if (
      action.subscription_id !== sub.id ||
      action.product_id !== sub.product_id ||
      action.subscription_version !== sub.version ||
      action.kind !== (kind === 'renew' ? 'RENEW' : 'UPGRADE') ||
      action.offer_snapshot.offer_id !==
        (kind === 'renew' ? (sub.next_offer_id ?? sub.offer_id) : selected)
    )
      throw new ApiError('version_conflict', 409, 'version_conflict');
    setQuote(action);
    setNow(Date.now());
  };
  const change = async (operation: 'cancel' | 'resume' | 'downgrade') => {
    const updated = await command<Subscription>(
      `${operation}:${sub.id}`,
      `/api/v1/subscriptions/${encodeURIComponent(sub.id)}/${operation}`,
      {
        expected_version: sub.version,
        ...(operation === 'downgrade' ? { offer_id: selected } : {}),
      },
    );
    assertOwner(updated, auth.user.id);
    setQuote(undefined);
    refresh();
  };
  const stateKey =
    sub.state === 'ACTIVE'
      ? 'active'
      : sub.state === 'CLOSED'
        ? 'closed'
        : sub.state === 'EXPIRED'
          ? 'expired'
          : 'subscriptionPending';
  return (
    <article className="card">
      <h3>{localized(current.name, locale)}</h3>
      <p className="badge">{t(stateKey)}</p>
      <p>
        <code>{sub.id}</code>
      </p>
      <dl>
        <dt>{t('currentPlan')}</dt>
        <dd>
          {localized(current.name, locale)} · {current.duration_days} {t('days')} ·{' '}
          {formatMoney(current.price, locale)} USDT
        </dd>
        <dt>{t('paidPeriod')}</dt>
        <dd>
          <Time value={sub.current_period_start} /> — <Time value={sub.current_period_end} />
        </dd>
        <dt>{t('nextPlan')}</dt>
        <dd>
          {next
            ? `${localized(next.name, locale)} · ${next.duration_days} ${t('days')}`
            : (sub.next_offer_id ?? t('noChange'))}
        </dd>
      </dl>
      <h4>{t('features')}</h4>
      <ul>
        {sub.features.map((feature) => (
          <li key={feature.key}>{localized(feature.label, locale)}</li>
        ))}
      </ul>
      {sub.pending_period && (
        <div>
          <h4>{t('pendingPeriod')}</h4>
          <p>{localized(sub.pending_period.offer_snapshot.name, locale)}</p>
          <Time value={sub.pending_period.period_start} /> —{' '}
          <Time value={sub.pending_period.period_end} />
        </div>
      )}
      {sub.cancel_at_period_end && <p>{t('ends')}</p>}
      <Access key={`${sub.current_period_end}:${periodEnded}`} subscription={sub} auth={auth} />
      <p>{t('noDebit')}</p>
      {active && (
        <>
          <div className="actions">
            <ActionButton action={() => change(sub.cancel_at_period_end ? 'resume' : 'cancel')}>
              {t(sub.cancel_at_period_end ? 'resume' : 'cancel')}
            </ActionButton>
            {auth.user.is_verified && (
              <ActionButton action={() => prepare('renew')}>{t('renew')}</ActionButton>
            )}
          </div>
          {!auth.user.is_verified && <p>{t('verify')}</p>}
          {choices.length > 0 && (
            <>
              <label className="field">
                <span>{t('target')}</span>
                <select
                  value={selected}
                  onChange={(event) => {
                    setTarget(event.target.value);
                    setQuote(undefined);
                  }}
                >
                  {choices.map(({ offer, revision }) => (
                    <option key={offer.id} value={offer.id}>
                      {localized(revision.name, locale)} · {offer.duration_days} {t('days')} ·{' '}
                      {formatMoney(offer.price, locale)} USDT
                    </option>
                  ))}
                </select>
              </label>
              <div className="actions">
                {auth.user.is_verified &&
                  targetChoice &&
                  (currentRank === undefined || targetChoice.plan.upgrade_rank > currentRank) && (
                    <ActionButton action={() => prepare('upgrade-quote')}>
                      {t('upgrade')}
                    </ActionButton>
                  )}
                {targetChoice &&
                  (currentRank === undefined || targetChoice.plan.upgrade_rank < currentRank) && (
                    <ActionButton action={() => change('downgrade')}>{t('downgrade')}</ActionButton>
                  )}
              </div>
            </>
          )}
        </>
      )}
      {quote && (
        <section aria-label={t('quote')}>
          <h4>{t('quote')}</h4>
          <p>{localized(quote.offer_snapshot.name, locale)}</p>
          <p>
            {formatMoney(quote.amount, locale)} {quote.currency}
          </p>
          <p>
            {t('expires')}: <Time value={quote.expires_at} />
          </p>
          {quoteExpired ? (
            <p role="alert">{t('quoteExpired')}</p>
          ) : (
            <>
              <NetworkChoice network={network} setNetwork={setNetwork} />
              <p>{t('networkWarning')}</p>
              <ActionButton
                action={async () => {
                  if (new Date(quote.expires_at).getTime() <= Date.now()) {
                    setNow(Date.now());
                    throw new ApiError('quote_expired', 409, 'quote_expired');
                  }
                  const order = await command<Order>(
                    `checkout-action:${quote.id}`,
                    '/api/v1/orders',
                    {
                      action_id: quote.id,
                      offer_id: quote.offer_snapshot.offer_id,
                      kind: quote.kind,
                      subscription_id: sub.id,
                      expected_version: quote.subscription_version,
                      network,
                    },
                  );
                  assertOwner(order, auth.user.id);
                  open(order.id);
                  setQuote(undefined);
                  refresh();
                }}
              >
                {t('confirm')}
              </ActionButton>
            </>
          )}
        </section>
      )}
    </article>
  );
}
function SubscriptionsView({
  auth,
  command,
  open,
}: {
  auth: AuthSession;
  command: Commander;
  open: (id: string) => void;
}) {
  const t = useText(commerceMessages);
  const [cursor, setCursor] = useState('');
  const query = useCommerceQuery<Page<Subscription>>(
    `/api/v1/subscriptions?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    auth.session_id,
    (page) => page.items.forEach((sub) => assertOwner(sub, auth.user.id)),
  );
  const catalog = useCatalogQuery(auth.session_id);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          query.refresh();
          catalog.refresh();
        }}
      >
        {t('refresh')}
      </button>
      <QueryFeedback loading={query.loading} failure={query.failure} />
      <QueryFeedback loading={false} failure={catalog.failure} />
      {query.data?.items.length === 0 && <p>{t('emptySubscriptions')}</p>}
      <div className="grid">
        {query.data?.items.map((sub) => (
          <SubscriptionCard
            key={`${sub.id}:${sub.version}`}
            subscription={sub}
            catalog={catalog.data}
            auth={auth}
            command={command}
            refresh={query.refresh}
            open={open}
          />
        ))}
      </div>
      {cursor && (
        <button type="button" onClick={() => setCursor('')}>
          {t('first')}
        </button>
      )}
      {query.data?.next_cursor && (
        <button type="button" onClick={() => setCursor(query.data!.next_cursor!)}>
          {t('more')}
        </button>
      )}
    </>
  );
}
function CommerceSession({ auth, section }: { auth: AuthSession; section: Section }) {
  const t = useText(commerceMessages);
  const command = useCommands();
  const [orderId, setOrderId] = useState<string>();
  return (
    <section aria-label={t(section)}>
      <h2>{t(section)}</h2>
      {orderId && (
        <OwnOrder
          key={orderId}
          id={orderId}
          auth={auth}
          command={command}
          close={() => setOrderId(undefined)}
        />
      )}
      {section === 'catalog' ? (
        <CatalogView auth={auth} command={command} open={setOrderId} />
      ) : section === 'subscriptions' ? (
        <SubscriptionsView auth={auth} command={command} open={setOrderId} />
      ) : (
        <OrdersView auth={auth} open={setOrderId} />
      )}
    </section>
  );
}
export function CommercePanel({ auth, section }: { auth: AuthSession; section: Section }) {
  return (
    <CommerceSession
      key={`${auth.user.id}:${auth.session_id}:${section}`}
      auth={auth}
      section={section}
    />
  );
}
