// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from './api';
import type { AuthSession } from './auth';
import type { Order, Page, Subscription } from './commerce';
import type { Compensation, PaymentEvidencePayload } from './generated/businessv1';
import { CommandAttempts } from './commerce';
import { ActionButton, ActionForm, Field, Time, value } from './components';
import { useI18n, useText } from './i18n';
import { adminCommerceMessages as messages, adminStatusKeys } from './admin-commerce-resources';

const payments = '/api/v1/admin/payments';
const subscriptions = '/api/v1/admin/subscriptions';
type Evidence = {
  id: string;
  source: string;
  provider_payment_id: string | null;
  observed_at: string;
  signature_valid: boolean;
  payload: PaymentEvidencePayload;
};
type Decision = {
  id: string;
  actor_user_id: string;
  operation: string;
  reason: string;
  created_at: string;
  evidence_id: string | null;
};
type PaymentDetail = { order: Order; evidence: Evidence[]; decisions: Decision[] };

// Every read is abortable; visible browser events refresh without a timer.
function useAdminRead<T>(path: string | null, revision: number) {
  const [data, setData] = useState<T | null>(null);
  const [failure, setFailure] = useState<unknown>();
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [eventVersion, setEventVersion] = useState(0);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === 'visible') setEventVersion((n) => n + 1);
    };
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  useEffect(() => {
    if (!path) {
      setData(null);
      setFailure(undefined);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setData(null);
    setFailure(undefined);
    api
      .request<T>(path, { signal: controller.signal })
      .then((result) => {
        if (!cancelled) {
          setLoadedPath(path);
          setData(result);
        }
      })
      .catch((cause) => {
        if (!cancelled) setFailure(cause);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [path, revision, eventVersion]);
  return { data: loadedPath === path ? data : null, failure };
}

export function CommerceAdmin({ auth }: { auth: AuthSession }) {
  return (
    <CommerceWorkspace
      key={`${auth.session_id}:${auth.user.permissions.join(',')}:${auth.user.roles.join(',')}`}
      auth={auth}
    />
  );
}
function CommerceWorkspace({ auth }: { auth: AuthSession }) {
  const t = useText(messages);
  return (
    <>
      {auth.user.permissions.some(
        (permission) => permission === 'billing:read' || permission === 'billing:status:read',
      ) && <PaymentAdmin auth={auth} />}
      {auth.user.permissions.includes('subscriptions:read') && <SubscriptionAdmin auth={auth} />}
      {!auth.user.permissions.some(
        (permission) =>
          permission === 'billing:read' ||
          permission === 'billing:status:read' ||
          permission === 'subscriptions:read',
      ) && <p role="alert">{t('forbidden')}</p>}
    </>
  );
}
function PaymentAdmin({ auth }: { auth: AuthSession }) {
  const t = useText(messages);
  const { error } = useI18n();
  const canResolve = auth.user.permissions.includes('billing:resolve');
  const canReadEvidence = auth.user.permissions.includes('billing:read');
  const [state, setState] = useState('');
  const [cursor, setCursor] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState('');
  const [resolved, setResolved] = useState<Order | null>(null);
  const list = useAdminRead<Page<Order>>(
    `${payments}?limit=50&state=${encodeURIComponent(state)}&cursor=${encodeURIComponent(cursor)}`,
    refresh,
  );
  const detail = useAdminRead<PaymentDetail>(
    selected && canReadEvidence ? `${payments}/${encodeURIComponent(selected)}` : null,
    refresh,
  );
  const safeStatus = useAdminRead<Order>(
    selected && !canReadEvidence ? `${payments}/${encodeURIComponent(selected)}/status` : null,
    refresh,
  );
  const currentOrder = detail.data?.order ?? safeStatus.data;
  const order =
    resolved?.id === selected && (!currentOrder || resolved.version >= currentOrder.version)
      ? resolved
      : currentOrder;
  return (
    <section aria-label={t('payments')}>
      <h2>{t('payments')}</h2>
      <label className="field">
        <span>{t('status')}</span>
        <select
          value={state}
          onChange={(event) => {
            setState(event.target.value);
            setCursor('');
          }}
        >
          <option value="">{t('all')}</option>
          {[
            'PREPARING',
            'PAYMENT_PENDING',
            'PAYMENT_ACCEPTED',
            'FULFILLMENT_PENDING',
            'FULFILLED',
            'REVIEW_REQUIRED',
            'CANCELLED',
            'EXPIRED',
          ].map((status) => (
            <option key={status} value={status}>
              {t(adminStatusKeys[status] ?? 'unknown')}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => setRefresh((n) => n + 1)}>
        {t('refresh')}
      </button>
      {list.failure ? (
        <p role="alert">{error(list.failure)}</p>
      ) : !list.data ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <>
          {list.data.items.length === 0 && <p>{t('empty')}</p>}
          <ul>
            {list.data.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(item.id);
                    setResolved(null);
                  }}
                >
                  {item.id}
                </button>{' '}
                · {t(adminStatusKeys[item.state] ?? 'unknown')} · {item.amount} {item.currency}
              </li>
            ))}
          </ul>
          {list.data.next_cursor && (
            <button type="button" onClick={() => setCursor(list.data!.next_cursor!)}>
              {t('more')}
            </button>
          )}
        </>
      )}
      {detail.failure !== undefined && <p role="alert">{error(detail.failure)}</p>}
      {safeStatus.failure !== undefined && <p role="alert">{error(safeStatus.failure)}</p>}
      {selected && !order && !detail.failure && !safeStatus.failure && (
        <p role="status">{t('loading')}</p>
      )}
      {order && (
        <article className="card" aria-label={order.id}>
          <h3>{order.id}</h3>
          <dl>
            <dt>{t('status')}</dt>
            <dd>{t(adminStatusKeys[order.state] ?? 'unknown')}</dd>
            <dt>{t('version')}</dt>
            <dd>{order.version}</dd>
            <dt>{t('user')}</dt>
            <dd>{order.user_id}</dd>
            <dt>{t('amount')}</dt>
            <dd>
              {order.amount} {order.currency}
            </dd>
            <dt>{t('created')}</dt>
            <dd>
              <Time value={order.created_at} />
            </dd>
            <dt>{t('attempt')}</dt>
            <dd>{t(adminStatusKeys[order.payment_attempt.state] ?? 'unknown')}</dd>
            <dt>{t('paymentId')}</dt>
            <dd>{order.payment_attempt.provider_payment_id ?? '—'}</dd>
            <dt>{t('network')}</dt>
            <dd>{order.payment_attempt.network}</dd>
          </dl>
          {canReadEvidence && detail.data && (
            <>
              <h4>{t('evidence')}</h4>
              <p>{t('manualNote')}</p>
              {detail.data.evidence.length === 0 && <p>{t('empty')}</p>}
              {detail.data.evidence.map((evidence) => (
                <EvidenceView key={evidence.id} evidence={evidence} />
              ))}
              {canResolve && (
                <PaymentResolution
                  key={order.id}
                  order={order}
                  evidence={detail.data.evidence}
                  resolved={setResolved}
                />
              )}
              <h4>{t('decisions')}</h4>
              <ul>
                {detail.data.decisions.map((decision) => (
                  <li key={decision.id}>
                    {t(adminStatusKeys[decision.operation] ?? 'unknown')} · {decision.reason} ·{' '}
                    {t('actor')}: {decision.actor_user_id} · <Time value={decision.created_at} />
                    {decision.evidence_id && (
                      <>
                        {' '}
                        · {t('evidenceId')}: {decision.evidence_id}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </article>
      )}
    </section>
  );
}
function EvidenceView({ evidence }: { evidence: Evidence }) {
  const t = useText(messages);
  const fields = {
    payment_id: 'paymentId',
    order_id: 'providerOrder',
    price_amount: 'priceAmount',
    price_currency: 'priceCurrency',
    pay_currency: 'payCurrency',
    pay_amount: 'payAmount',
    actually_paid: 'actuallyPaid',
    parent_payment_id: 'rootPayment',
    external_amount: 'externalAmount',
    external_network: 'network',
    external_reference: 'externalReference',
  } as const;
  return (
    <section className="card" aria-label={evidence.id}>
      <dl>
        <dt>{t('evidenceId')}</dt>
        <dd>{evidence.id}</dd>
        <dt>{t('source')}</dt>
        <dd>{t(adminStatusKeys[evidence.source] ?? 'unknown')}</dd>
        <dt>{t('observed')}</dt>
        <dd>
          <Time value={evidence.observed_at} />
        </dd>
        <dt>{t('signature')}</dt>
        <dd>{t(evidence.signature_valid ? 'yes' : 'no')}</dd>
        {(Object.keys(fields) as (keyof typeof fields)[]).map((field) => {
          const amountOrReference = evidence.payload[field];
          return typeof amountOrReference === 'string' ? (
            <div key={field}>
              <dt>{t(fields[field])}</dt>
              <dd>{amountOrReference}</dd>
            </div>
          ) : null;
        })}
      </dl>
    </section>
  );
}
function PaymentResolution({
  order,
  evidence,
  resolved,
}: {
  order: Order;
  evidence: Evidence[];
  resolved: (order: Order) => void;
}) {
  const t = useText(messages);
  const { error } = useI18n();
  const [acceptance, setAcceptance] = useState('saved');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [success, setSuccess] = useState(false);
  const requests = useRef(new Map<string, string>());
  const positiveEvidence = evidence.filter((item) =>
    [
      item.payload.actually_paid,
      item.source === 'MANUAL' ? item.payload.price_amount : null,
      item.source === 'MANUAL' ? item.payload.external_amount : null,
    ].some(
      (amount) => typeof amount === 'string' && /^\d+\.\d+$/.test(amount) && /[1-9]/.test(amount),
    ),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const operation = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
    if (!operation) return;
    const body: Record<string, unknown> = {
      expected_version: order.version,
      reason: value(form, 'reason').trim(),
    };
    if (!body.reason) {
      setFailure(new ApiError('', 400, 'invalid_request'));
      return;
    }
    if (operation === 'accept') {
      if (acceptance === 'external') {
        const amount = value(form, 'amount');
        const reference = value(form, 'reference').trim();
        if (!/^\d+\.\d{6}$/.test(amount) || !/[1-9]/.test(amount) || !reference) {
          setFailure(new ApiError('', 422, 'invalid_evidence'));
          return;
        }
        body.external_payment = { amount, network: value(form, 'network'), reference };
      } else {
        const id = value(form, 'evidence');
        if (!id) {
          setFailure(new ApiError('', 422, 'invalid_evidence'));
          return;
        }
        body.evidence_id = id;
      }
    }
    const signature = JSON.stringify([operation, body]);
    if (!requests.current.has(signature)) requests.current.set(signature, crypto.randomUUID());
    body.idempotency_key = requests.current.get(signature);
    setBusy(true);
    setFailure(null);
    setSuccess(false);
    try {
      resolved(
        await api.request<Order>(`${payments}/${encodeURIComponent(order.id)}/${operation}`, {
          method: 'POST',
          body,
        }),
      );
      setSuccess(true);
    } catch (cause) {
      setFailure(cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form aria-label={t('resolve')} aria-busy={busy} onSubmit={submit}>
      <h4>{t('resolve')}</h4>
      <fieldset disabled={busy}>
        <Field label={t('reason')} name="reason" required maxLength={2000} />
        <label className="field">
          <span>{t('acceptanceEvidence')}</span>
          <select value={acceptance} onChange={(event) => setAcceptance(event.target.value)}>
            <option value="saved">{t('savedEvidence')}</option>
            <option value="external">{t('external')}</option>
          </select>
        </label>
        {acceptance === 'saved' ? (
          <label className="field">
            <span>{t('evidenceId')}</span>
            <select name="evidence">
              <option value="">{t('chooseEvidence')}</option>
              {positiveEvidence.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id} · {t(adminStatusKeys[item.source] ?? 'unknown')}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <Field
              label={t('externalAmount')}
              name="amount"
              inputMode="decimal"
              pattern="[0-9]+[.][0-9]{6}"
            />
            <label className="field">
              <span>{t('network')}</span>
              <select name="network">
                <option value="USDTTRC20">USDT TRC20</option>
                <option value="USDTBSC">USDT BSC</option>
              </select>
            </label>
            <Field label={t('externalReference')} name="reference" maxLength={2000} />
          </>
        )}
        <div className="actions">
          {(['reverify', 'accept', 'reject', 'retry-fulfillment'] as const).map((operation) => (
            <button
              key={operation}
              type="submit"
              name="operation"
              value={operation}
              className={operation === 'reject' ? 'danger' : ''}
            >
              {t(adminStatusKeys[operation])}
            </button>
          ))}
        </div>
      </fieldset>
      {failure ? (
        <p role="alert">{error(failure)}</p>
      ) : (
        success && <p role="status">{t('saved')}</p>
      )}
    </form>
  );
}
function SubscriptionAdmin({ auth }: { auth: AuthSession }) {
  const t = useText(messages);
  const { error, locale } = useI18n();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [closed, setClosed] = useState<Subscription | null>(null);
  const attempts = useRef(new CommandAttempts());
  const list = useAdminRead<Page<Subscription>>(
    `${subscriptions}?limit=50${query}&cursor=${encodeURIComponent(cursor)}`,
    refresh,
  );
  const detail = useAdminRead<Subscription>(
    selected ? `${subscriptions}/${encodeURIComponent(selected)}` : null,
    refresh,
  );
  const item =
    closed?.id === selected && (!detail.data || closed.version >= detail.data.version)
      ? closed
      : detail.data;
  return (
    <section aria-label={t('subscriptions')}>
      <h2>{t('subscriptions')}</h2>
      <ActionForm
        title={t('filter')}
        submit={t('filter')}
        onSubmit={async (form) => {
          setCursor('');
          setQuery(
            `&user_id=${encodeURIComponent(value(form, 'user'))}&product_id=${encodeURIComponent(value(form, 'product'))}`,
          );
        }}
      >
        <Field label={t('user')} name="user" />
        <Field label={t('productId')} name="product" />
      </ActionForm>
      <button type="button" onClick={() => setRefresh((n) => n + 1)}>
        {t('refresh')}
      </button>
      {list.failure ? (
        <p role="alert">{error(list.failure)}</p>
      ) : !list.data ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <>
          {list.data.items.length === 0 && <p>{t('empty')}</p>}
          <ul>
            {list.data.items.map((subscription) => (
              <li key={subscription.id}>
                {auth.user.permissions.includes('subscriptions:compensate') && (
                  <label>
                    <input
                      type="checkbox"
                      checked={chosen.includes(subscription.id)}
                      onChange={(event) =>
                        setChosen((ids) =>
                          event.target.checked
                            ? [...ids, subscription.id]
                            : ids.filter((id) => id !== subscription.id),
                        )
                      }
                    />
                    {t('select')} {subscription.id}
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelected(subscription.id);
                    setClosed(null);
                  }}
                >
                  {subscription.id}
                </button>{' '}
                · {t(adminStatusKeys[subscription.state] ?? 'unknown')} ·{' '}
                <Time value={subscription.current_period_end} />
              </li>
            ))}
          </ul>
          {list.data.next_cursor && (
            <button type="button" onClick={() => setCursor(list.data!.next_cursor!)}>
              {t('more')}
            </button>
          )}
        </>
      )}
      {detail.failure !== undefined && <p role="alert">{error(detail.failure)}</p>}
      {selected && !item && !detail.failure && <p role="status">{t('loading')}</p>}
      {item && (
        <article className="card">
          <h3>{item.id}</h3>
          <dl>
            <dt>{t('status')}</dt>
            <dd>{t(adminStatusKeys[item.state] ?? 'unknown')}</dd>
            <dt>{t('user')}</dt>
            <dd>{item.user_id}</dd>
            <dt>{t('productId')}</dt>
            <dd>{item.product_id}</dd>
            <dt>{t('plan')}</dt>
            <dd>{item.plan_id}</dd>
            <dt>{t('revision')}</dt>
            <dd>{item.revision_id}</dd>
            <dt>{t('version')}</dt>
            <dd>{item.version}</dd>
            <dt>{t('periodStart')}</dt>
            <dd>
              <Time value={item.current_period_start} />
            </dd>
            <dt>{t('periodEnd')}</dt>
            <dd>
              <Time value={item.current_period_end} />
            </dd>
            <dt>{t('cancelAtEnd')}</dt>
            <dd>{t(item.cancel_at_period_end ? 'yes' : 'no')}</dd>
            <dt>{t('nextOffer')}</dt>
            <dd>{item.next_offer_id ?? '—'}</dd>
          </dl>
          <section aria-label={t('offers')}>
            <h4>{t('offers')}</h4>
            <p>
              {item.current_offer_snapshot.name[locale]} ·{' '}
              {item.current_offer_snapshot.duration_days} {t('days')} ·{' '}
              {item.current_offer_snapshot.price} {item.current_offer_snapshot.currency}
            </p>
          </section>
          {item.next_offer_snapshot && (
            <section aria-label={t('nextOffer')}>
              <h4>{t('nextOffer')}</h4>
              <p>
                {item.next_offer_snapshot.name[locale]} · {item.next_offer_snapshot.duration_days}{' '}
                {t('days')} · {item.next_offer_snapshot.price} {item.next_offer_snapshot.currency}
              </p>
            </section>
          )}
          <ul>
            {item.features.map((feature) => (
              <li key={feature.key}>{feature.label[locale]}</li>
            ))}
          </ul>
          {item.pending_period && (
            <section>
              <h4>{t('pendingPeriod')}</h4>
              <p>{item.pending_period.offer_snapshot.name[locale]}</p>
              <Time value={item.pending_period.period_start} /> —{' '}
              <Time value={item.pending_period.period_end} />
            </section>
          )}
          {auth.user.permissions.includes('subscriptions:close') && item.state !== 'CLOSED' && (
            <ActionForm
              key={`${item.id}:${item.version}`}
              title={t('close')}
              submit={t('close')}
              danger
              onSubmit={async (form) => {
                setClosed(
                  await api.request<Subscription>(
                    `${subscriptions}/${encodeURIComponent(item.id)}/close`,
                    {
                      method: 'POST',
                      body: attempts.current.body(`close:${item.id}`, {
                        expected_version: item.version,
                        reason: value(form, 'reason'),
                      }),
                    },
                  ),
                );
                setRefresh((n) => n + 1);
              }}
            >
              <Field label={t('reason')} name="reason" required maxLength={2000} />
            </ActionForm>
          )}
        </article>
      )}
      {auth.user.permissions.includes('subscriptions:compensate') && (
        <CompensationAdmin selected={chosen} />
      )}
    </section>
  );
}
function CompensationAdmin({ selected }: { selected: string[] }) {
  const t = useText(messages);
  const [batch, setBatch] = useState<Compensation | null>(null);
  const [lookup, setLookup] = useState('');
  const [refresh, setRefresh] = useState(0);
  const read = useAdminRead<Compensation>(
    lookup ? `${subscriptions}/compensations/${encodeURIComponent(lookup)}` : null,
    refresh,
  );
  const { error } = useI18n();
  useEffect(() => {
    if (read.data) setBatch(read.data);
  }, [read.data]);
  const previewRequests = useRef(new Map<string, string>());
  const applyRequests = useRef(new Map<string, string>());
  return (
    <section>
      <ActionForm
        title={t('compensation')}
        submit={t('freeze')}
        onSubmit={async (form) => {
          if (!selected.length) throw new ApiError('', 400, 'invalid_request');
          const body = {
            subscription_ids: [...selected].sort(),
            days: Number(value(form, 'days')),
            reason: value(form, 'reason'),
          };
          const signature = JSON.stringify(body);
          if (!previewRequests.current.has(signature))
            previewRequests.current.set(signature, crypto.randomUUID());
          const next = await api.request<Compensation>(`${subscriptions}/compensations/preview`, {
            method: 'POST',
            body: { ...body, operation_id: previewRequests.current.get(signature) },
          });
          setLookup('');
          setBatch(next);
        }}
      >
        <p>
          {selected.length} {t('subscriptions')}
        </p>
        <Field label={t('days')} name="days" type="number" min={1} max={3650} step={1} required />
        <Field label={t('reason')} name="reason" required maxLength={2000} />
      </ActionForm>
      <ActionForm
        title={t('loadBatch')}
        submit={t('loadBatch')}
        onSubmit={async (form) => {
          setLookup(value(form, 'id'));
          setRefresh((n) => n + 1);
        }}
      >
        <Field label={t('batchId')} name="id" required />
      </ActionForm>
      {read.failure !== undefined && <p role="alert">{error(read.failure)}</p>}
      {lookup && !read.data && !read.failure && <p role="status">{t('loading')}</p>}
      {batch && (
        <article className="card">
          <h3>{t('frozen')}</h3>
          <p>
            {t('batchId')}: {batch.id} · {t(adminStatusKeys[batch.state] ?? 'unknown')} ·{' '}
            {t('version')}: {batch.version}
          </p>
          <p>
            {batch.days} {t('days')} · {batch.reason}
          </p>
          <p>
            {t('recipientCount')}: {batch.recipient_count} · {t('totalDays')}: {batch.total_days}
          </p>
          <p>{t('frozenNote')}</p>
          <ul>
            {batch.recipients.map((recipient) => (
              <li key={recipient.subscription_id}>
                {recipient.subscription_id} · {t('expectedVersion')}: {recipient.expected_version} ·{' '}
                <strong>{t(adminStatusKeys[recipient.state] ?? 'unknown')}</strong> ·{' '}
                {t('resultVersion')}: {recipient.result_version ?? '—'}
              </li>
            ))}
          </ul>
          {batch.state === 'PREVIEW' && (
            <ActionButton
              action={async () => {
                const signature = `${batch.id}:${batch.version}`;
                if (!applyRequests.current.has(signature))
                  applyRequests.current.set(signature, crypto.randomUUID());
                const next = await api.request<Compensation>(
                  `${subscriptions}/compensations/${encodeURIComponent(batch.id)}/apply`,
                  {
                    method: 'POST',
                    body: {
                      expected_version: batch.version,
                      idempotency_key: applyRequests.current.get(signature),
                      reason: batch.reason,
                    },
                  },
                );
                setLookup('');
                setBatch(next);
              }}
            >
              {t('apply')}
            </ActionButton>
          )}
        </article>
      )}
    </section>
  );
}
