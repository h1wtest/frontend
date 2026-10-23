// SPDX-License-Identifier: MIT
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { canAdmin, type AuthSession } from './auth';
import { ActionButton, ActionForm, Field, Time, value } from './components';
import { useI18n, useText } from './i18n';
import { accountMessages } from './account-resources';
import {
  useReferralRequests,
  type ReferralCommand,
  type Page,
  type Payout,
  type ReferralSummary,
} from './ReferralPanel';
import type { RateHistory as RateEntry } from './generated/businessv1';

type Rate = { rate_bps: number; version: number; effective_at: string };
type Partner = Omit<ReferralSummary, 'rate_bps'> & {
  rate_bps: number | null;
  override_rate_bps: number | null;
  rate_version: number;
};
const root = '/api/v1/admin/referrals';

function RateHistory({ path }: { path: string }) {
  const t = useText(accountMessages);
  const [rows, setRows] = useState<RateEntry[]>();
  const [cursor, setCursor] = useState<string | null>(null);
  const { generation, invalidate, read } = useReferralRequests();
  const historyGeneration = useRef(-1);
  async function load(more = false) {
    if (more && (!cursor || historyGeneration.current !== generation.current)) return;
    if (!more) invalidate();
    const current = generation.current;
    const page = await read('history', (signal) =>
      api.request<Page<RateEntry>>(
        `${path}?limit=50${more && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { signal },
      ),
    );
    if (!page || current !== generation.current) return;
    historyGeneration.current = current;
    setRows((previous) =>
      more
        ? [
            ...(previous ?? []),
            ...page.items.filter((item) => !previous?.some((row) => row.id === item.id)),
          ]
        : page.items,
    );
    setCursor(page.next_cursor);
  }
  return (
    <div>
      <ActionButton action={() => load()}>{t('rateHistory')}</ActionButton>
      {rows?.length === 0 && <p>{t('empty')}</p>}
      <ul className="records">
        {rows?.map((row) => (
          <li key={row.id}>
            <span>{row.rate_bps ?? t('useGlobal')}</span>
            <span>
              {t('version')}: {row.version}
            </span>
            <Time value={row.effective_at} />
            <code>{row.actor_id ?? t('system')}</code>
            <p>{row.reason}</p>
          </li>
        ))}
      </ul>
      {cursor && <ActionButton action={() => load(true)}>{t('more')}</ActionButton>}
    </div>
  );
}
function PartnerCard({
  partner,
  writable,
  update,
  command,
  reload,
}: {
  partner: Partner;
  writable: boolean;
  update: (partner: Partner) => void;
  command: ReferralCommand;
  reload: () => Promise<void>;
}) {
  const t = useText(accountMessages);
  const [global, setGlobal] = useState(partner.override_rate_bps === null);
  return (
    <li>
      <strong>{partner.code}</strong>
      <code>{partner.user_id}</code>
      <span>
        {t('available')}: {partner.available} USDT
      </span>
      <span>
        {t('debt')}: {partner.debt} USDT
      </span>
      <span>
        {t('rate')}: {partner.rate_bps ?? t('unavailable')}
      </span>
      {writable && (
        <ActionForm
          title={t('overrideRate')}
          submit={t('saveOverride')}
          onSubmit={async (form) => {
            const result = await command<{
              rate_bps: number | null;
              version: number;
              effective_at: string;
            }>(
              `rate:partner:${partner.user_id}`,
              `${root}/partners/${encodeURIComponent(partner.user_id)}/rate`,
              {
                rate_bps: global ? null : Number(value(form, 'rate_bps')),
                expected_version: partner.rate_version,
                reason: value(form, 'reason'),
              },
              'PUT',
            );
            update({
              ...partner,
              override_rate_bps: result.rate_bps,
              rate_bps: result.rate_bps,
              rate_version: result.version,
            });
            if (result.rate_bps === null) await reload();
          }}
        >
          <label className="check">
            <input
              type="checkbox"
              checked={global}
              onChange={(event) => setGlobal(event.target.checked)}
            />
            {t('useGlobal')}
          </label>
          <Field
            label={t('rate')}
            name="rate_bps"
            type="number"
            min={0}
            max={10000}
            step={1}
            required={!global}
            disabled={global}
            defaultValue={partner.override_rate_bps ?? partner.rate_bps ?? ''}
          />
          <Field label={t('reason')} name="reason" required maxLength={500} />
        </ActionForm>
      )}
      <RateHistory
        key={partner.rate_version}
        path={`${root}/partners/${encodeURIComponent(partner.user_id)}/rate/history`}
      />
    </li>
  );
}
function PayoutDecision({
  payout,
  update,
  command,
}: {
  payout: Payout;
  update: (payout: Payout) => void;
  command: ReferralCommand;
}) {
  const t = useText(accountMessages);
  const [decision, setDecision] = useState<'PAID' | 'REJECTED'>('PAID');
  return (
    <ActionForm
      submit={t('recordDecision')}
      onSubmit={async (form) => {
        const body = {
          decision,
          expected_version: payout.version,
          reason: value(form, 'reason'),
          ...(decision === 'PAID'
            ? {
                reference: value(form, 'reference'),
                paid_at: new Date(value(form, 'paid_at')).toISOString(),
              }
            : {}),
        };
        update(
          await command<Payout>(
            `payout:decision:${payout.id}`,
            `${root}/payouts/${encodeURIComponent(payout.id)}/decision`,
            body,
          ),
        );
      }}
    >
      <label className="field">
        <span>{t('decision')}</span>
        <select
          value={decision}
          onChange={(event) => setDecision(event.target.value as 'PAID' | 'REJECTED')}
        >
          <option value="PAID">{t('paidDecision')}</option>
          <option value="REJECTED">{t('rejectDecision')}</option>
        </select>
      </label>
      <Field label={t('decisionReason')} name="reason" required maxLength={500} />
      {decision === 'PAID' && (
        <>
          <Field label={t('externalReference')} name="reference" required maxLength={500} />
          <Field label={t('paidAt')} name="paid_at" type="datetime-local" required />
        </>
      )}
    </ActionForm>
  );
}
export function ReferralAdmin({ auth }: { auth: AuthSession }) {
  return <ReferralAdminSession key={`${auth.session_id}:${auth.user.id}`} auth={auth} />;
}

function ReferralAdminSession({ auth }: { auth: AuthSession }) {
  const t = useText(accountMessages);
  const { error: errorText } = useI18n();
  const readable = canAdmin(auth.user, 'referrals:read');
  const ratesWritable = canAdmin(auth.user, 'referrals:rates:write');
  const decidable = canAdmin(auth.user, 'referrals:payouts:decide');
  const [rate, setRate] = useState<Rate>();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [partnerCursor, setPartnerCursor] = useState<string | null>(null);
  const [payoutCursor, setPayoutCursor] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>();
  const { generation, invalidate, read, command } = useReferralRequests();
  const historyGeneration = useRef(-1);
  const load = useCallback(async () => {
    invalidate();
    const current = generation.current;
    try {
      const result = await read('refresh', (signal) =>
        Promise.all([
          api.request<Rate>(`${root}/rate`, { signal }),
          api.request<Page<Partner>>(`${root}/partners?limit=50`, { signal }),
          api.request<Page<Payout>>(`${root}/payouts?limit=50`, { signal }),
        ]),
      );
      if (!result || current !== generation.current) return;
      const [global, partnerPage, payoutPage] = result;
      historyGeneration.current = current;
      setRate(global);
      setPartners(partnerPage.items);
      setPartnerCursor(partnerPage.next_cursor);
      setPayouts(payoutPage.items);
      setPayoutCursor(payoutPage.next_cursor);
      setFailure(undefined);
    } catch (error) {
      if (current === generation.current) setFailure(error);
    }
  }, [generation, invalidate, read]);
  useEffect(() => {
    if (!readable) {
      invalidate();
      return;
    }
    const visible = () => {
      if (document.visibilityState !== 'hidden') void load();
    };
    visible();
    window.addEventListener('focus', visible);
    window.addEventListener('online', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      invalidate();
      window.removeEventListener('focus', visible);
      window.removeEventListener('online', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [invalidate, load, readable]);
  function invalidateCursors() {
    setPartnerCursor(null);
    setPayoutCursor(null);
  }
  if (!readable) return <p role="alert">{t('forbidden')}</p>;
  return (
    <section aria-labelledby="referral-admin-heading">
      <h2 id="referral-admin-heading">{t('referralAdmin')}</h2>
      <p className="notice">{t('manualPayout')}</p>
      <ActionButton action={() => load()}>{t('refresh')}</ActionButton>
      {failure !== undefined && (
        <p role="alert" className="error">
          {errorText(failure)}
        </p>
      )}
      {!rate && failure === undefined && <p role="status">{t('loading')}</p>}
      <div className="grid">
        <section className="card">
          <h3>{t('globalRate')}</h3>
          {rate && (
            <>
              <p>
                {t('rate')}: {rate.rate_bps}
              </p>
              <Time value={rate.effective_at} />
              <p className="muted">{t('bpsHint')}</p>
              {ratesWritable && (
                <ActionForm
                  submit={t('publishRate')}
                  onSubmit={async (form) => {
                    const updated = await command<Rate>(
                      'rate:global',
                      `${root}/rate`,
                      {
                        rate_bps: Number(value(form, 'rate_bps')),
                        expected_version: rate.version,
                        reason: value(form, 'reason'),
                      },
                      'PUT',
                    );
                    invalidateCursors();
                    setRate(updated);
                  }}
                >
                  <Field
                    label={t('rate')}
                    name="rate_bps"
                    type="number"
                    min={0}
                    max={10000}
                    step={1}
                    defaultValue={rate.rate_bps}
                    required
                  />
                  <Field label={t('reason')} name="reason" required maxLength={500} />
                </ActionForm>
              )}
            </>
          )}
          <RateHistory key={rate?.version} path={`${root}/rate/history`} />
        </section>
        <section className="card">
          <h3>{t('partners')}</h3>
          {rate && partners.length === 0 && <p>{t('empty')}</p>}
          <ul className="records">
            {partners.map((partner) => (
              <PartnerCard
                key={partner.user_id}
                partner={partner}
                writable={ratesWritable}
                command={command}
                reload={load}
                update={(updated) => {
                  invalidateCursors();
                  setPartners((previous) =>
                    previous.map((row) => (row.user_id === updated.user_id ? updated : row)),
                  );
                }}
              />
            ))}
          </ul>
          {partnerCursor && (
            <ActionButton
              action={async () => {
                if (historyGeneration.current !== generation.current) return;
                const current = generation.current;
                const page = await read('partner-page', (signal) =>
                  api.request<Page<Partner>>(
                    `${root}/partners?limit=50&cursor=${encodeURIComponent(partnerCursor)}`,
                    { signal },
                  ),
                );
                if (!page || current !== generation.current) return;
                setPartners((previous) => [
                  ...previous,
                  ...page.items.filter(
                    (item) => !previous.some((row) => row.user_id === item.user_id),
                  ),
                ]);
                setPartnerCursor(page.next_cursor);
              }}
            >
              {t('more')}
            </ActionButton>
          )}
        </section>
        <section className="card">
          <h3>{t('payouts')}</h3>
          {rate && payouts.length === 0 && <p>{t('empty')}</p>}
          <ul className="records">
            {payouts.map((payout) => (
              <li key={payout.id}>
                <strong>
                  {payout.amount} {payout.currency}
                </strong>
                <span>{t(payout.state)}</span>
                <code>{payout.id}</code>
                <code>{payout.user_id}</code>
                <span>
                  {payout.network}: {payout.address}
                </span>
                <Time value={payout.created_at} />
                {payout.reason && <p>{payout.reason}</p>}
                {payout.reference && <code>{payout.reference}</code>}
                {payout.paid_at && <Time value={payout.paid_at} />}
                {payout.state === 'PENDING' && decidable ? (
                  <PayoutDecision
                    payout={payout}
                    command={command}
                    update={(updated) => {
                      invalidateCursors();
                      setPayouts((previous) =>
                        previous.map((row) => (row.id === updated.id ? updated : row)),
                      );
                    }}
                  />
                ) : (
                  payout.state !== 'PENDING' && <p className="muted">{t('immutableDecision')}</p>
                )}
              </li>
            ))}
          </ul>
          {payoutCursor && (
            <ActionButton
              action={async () => {
                if (historyGeneration.current !== generation.current) return;
                const current = generation.current;
                const page = await read('payout-page', (signal) =>
                  api.request<Page<Payout>>(
                    `${root}/payouts?limit=50&cursor=${encodeURIComponent(payoutCursor)}`,
                    { signal },
                  ),
                );
                if (!page || current !== generation.current) return;
                setPayouts((previous) => [
                  ...previous,
                  ...page.items.filter((item) => !previous.some((row) => row.id === item.id)),
                ]);
                setPayoutCursor(page.next_cursor);
              }}
            >
              {t('more')}
            </ActionButton>
          )}
        </section>
      </div>
    </section>
  );
}
