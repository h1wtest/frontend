// SPDX-License-Identifier: MIT
import type { ReactNode } from 'react';
import { ApiError } from './api';
import type { AuthSession } from './auth';
import { Time } from './components';
import { useI18n, useText } from './i18n';
import { commerceMessages } from './commerce-resources';
import { assertOwner, formatMoney, localized, paymentStage, useCommerceQuery } from './commerce';
import type { Availability, Overview } from './commerce';

function AvailableSection<T>({
  name,
  section,
  children,
}: {
  name: string;
  section: Availability<T>;
  children: (data: T) => ReactNode;
}) {
  const t = useText(commerceMessages);
  return (
    <section className="card" aria-label={name}>
      <h3>{name}</h3>
      {section.status !== 'available' || section.data == null ? (
        <p role="status">{t('unavailable')}</p>
      ) : (
        children(section.data)
      )}
    </section>
  );
}
function OverviewSession({ auth }: { auth: AuthSession }) {
  const t = useText(commerceMessages);
  const { locale, error } = useI18n();
  const query = useCommerceQuery<Overview>(
    '/api/v1/users/me/overview',
    auth.session_id,
    (overview) => {
      if (
        overview.account.status === 'available' &&
        overview.account.data &&
        (overview.account.data.user.id !== auth.user.id ||
          overview.account.data.session_id !== auth.session_id)
      )
        throw new ApiError('forbidden', 403, 'forbidden');
      if (overview.orders.status === 'available' && overview.orders.data)
        overview.orders.data.items.forEach((item) => assertOwner(item, auth.user.id));
      if (overview.subscriptions.status === 'available' && overview.subscriptions.data)
        overview.subscriptions.data.items.forEach((item) => assertOwner(item, auth.user.id));
      if (overview.referrals.status === 'available' && overview.referrals.data)
        assertOwner(overview.referrals.data, auth.user.id);
    },
  );
  const overview = query.data;
  return (
    <section aria-label={t('overview')}>
      <h2>{t('overview')}</h2>
      <button type="button" onClick={query.refresh}>
        {t('refresh')}
      </button>
      {query.loading && <p role="status">{t('loading')}</p>}
      {query.failure != null && (
        <p role="alert" className="error">
          {error(query.failure)}
        </p>
      )}
      {overview && (
        <div className="grid">
          <AvailableSection name={t('account')} section={overview.account}>
            {({ user }) => (
              <>
                <p>{user.email}</p>
                <p>{t(user.is_verified ? 'verified' : 'unverified')}</p>
                <p>{t(user.mfa_enabled ? 'mfaOn' : 'mfaOff')}</p>
              </>
            )}
          </AvailableSection>
          <AvailableSection name={t('subscriptions')} section={overview.subscriptions}>
            {(page) => (
              <>
                {page.items.length === 0 ? (
                  <p>{t('emptySubscriptions')}</p>
                ) : (
                  <ul>
                    {page.items.map((sub) => (
                      <li key={sub.id}>
                        <p>{localized(sub.current_offer_snapshot.name, locale)}</p>
                        <p>
                          {t(
                            sub.state === 'ACTIVE'
                              ? 'active'
                              : sub.state === 'EXPIRED'
                                ? 'expired'
                                : sub.state === 'CLOSED'
                                  ? 'closed'
                                  : 'subscriptionPending',
                          )}
                        </p>
                        <p>
                          {t('paidPeriod')}: <Time value={sub.current_period_start} /> —{' '}
                          <Time value={sub.current_period_end} />
                        </p>
                        {sub.cancel_at_period_end && <p>{t('ends')}</p>}
                        {sub.next_offer_snapshot && (
                          <p>
                            {t('nextPlan')}: {localized(sub.next_offer_snapshot.name, locale)}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {page.next_cursor && <p>{t('partial')}</p>}
              </>
            )}
          </AvailableSection>
          <AvailableSection name={t('payments')} section={overview.orders}>
            {(page) => (
              <>
                {page.items.length === 0 ? (
                  <p>{t('emptyOrders')}</p>
                ) : (
                  <ul>
                    {page.items.map((order) => (
                      <li key={order.id}>
                        <p>{localized(order.offer_snapshot.name, locale)}</p>
                        <p>
                          {formatMoney(order.amount, locale)} {order.currency}
                        </p>
                        <p>{t(paymentStage(order.state))}</p>
                        <p>
                          <code>{order.id}</code>
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                {page.next_cursor && <p>{t('partial')}</p>}
              </>
            )}
          </AvailableSection>
          <AvailableSection name={t('referrals')} section={overview.referrals}>
            {(referral) => (
              <dl>
                <dt>{t('code')}</dt>
                <dd>
                  <code>{referral.code}</code>
                </dd>
                <dt>{t('availableBalance')}</dt>
                <dd>{formatMoney(referral.available, locale)} USDT</dd>
                <dt>{t('debt')}</dt>
                <dd>{formatMoney(referral.debt, locale)} USDT</dd>
              </dl>
            )}
          </AvailableSection>
        </div>
      )}
    </section>
  );
}
export function OverviewPanel({ auth }: { auth: AuthSession }) {
  return <OverviewSession key={`${auth.user.id}:${auth.session_id}`} auth={auth} />;
}
