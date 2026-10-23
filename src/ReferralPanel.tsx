// SPDX-License-Identifier: MIT
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from './api';
import { ActionButton, ActionForm, Field, Time, value } from './components';
import { useI18n, useText } from './i18n';
import { accountMessages } from './account-resources';
import { CommandAttempts } from './commerce';

export type { ReferralSummary, Payout } from './generated/businessv1';
import type { ReferralSummary, Payout } from './generated/businessv1';
export type Page<T> = { items: T[]; next_cursor: string | null };

export type ReferralCommand = <T>(
  operation: string,
  path: string,
  body: Record<string, unknown>,
  method?: 'POST' | 'PUT',
) => Promise<T>;

// A financial reply fences every older read, including pages from the previous history.
export function useReferralRequests() {
  const active = useRef(true);
  const generation = useRef(0);
  const reads = useRef(new Map<string, AbortController>());
  const mutations = useRef(new Set<AbortController>());
  const attempts = useRef(new CommandAttempts());
  const commandFacts = useRef(new Map<string, { intent: string; body: Record<string, unknown> }>());
  const invalidate = useCallback(() => {
    generation.current++;
    reads.current.forEach((controller) => controller.abort());
    reads.current.clear();
  }, []);
  useEffect(() => {
    active.current = true;
    const pending = mutations.current;
    return () => {
      active.current = false;
      invalidate();
      pending.forEach((controller) => controller.abort());
      pending.clear();
    };
  }, [invalidate]);
  const read = useCallback(
    async <T,>(name: string, load: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
      reads.current.get(name)?.abort();
      const controller = new AbortController();
      reads.current.set(name, controller);
      const current = generation.current;
      try {
        const result = await load(controller.signal);
        if (active.current && !controller.signal.aborted && current === generation.current)
          return result;
      } catch (error) {
        if (active.current && !controller.signal.aborted && current === generation.current)
          throw error;
      } finally {
        if (reads.current.get(name) === controller) reads.current.delete(name);
      }
    },
    [],
  );
  const command = useCallback<ReferralCommand>(
    async <T,>(
      operation: string,
      path: string,
      body: Record<string, unknown>,
      method: 'POST' | 'PUT' = 'POST',
    ) => {
      const controller = new AbortController();
      mutations.current.add(controller);
      // A refresh may advance expected_version after a lost reply; that is not a user edit.
      const intent = JSON.stringify({
        path,
        method,
        body: { ...body, expected_version: undefined },
      });
      let facts = commandFacts.current.get(operation);
      if (!facts || facts.intent !== intent) {
        facts = { intent, body };
        commandFacts.current.set(operation, facts);
      }
      try {
        const result = await api.request<T>(path, {
          method,
          body: attempts.current.body(operation, facts.body),
          signal: controller.signal,
        });
        if (!active.current || controller.signal.aborted)
          throw new ApiError('auth_context_changed', 0, 'auth_context_changed');
        attempts.current.complete(operation);
        commandFacts.current.delete(operation);
        invalidate();
        return result;
      } finally {
        mutations.current.delete(controller);
      }
    },
    [invalidate],
  );
  return { generation, invalidate, read, command };
}

export function ReferralPanel() {
  const t = useText(accountMessages);
  const { error: errorText } = useI18n();
  const [summary, setSummary] = useState<ReferralSummary>();
  const [summaryCurrent, setSummaryCurrent] = useState(true);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>();
  const { generation, invalidate, read, command } = useReferralRequests();
  const historyGeneration = useRef(-1);
  const refresh = useCallback(async () => {
    invalidate();
    const current = generation.current;
    try {
      const result = await read('refresh', (signal) =>
        Promise.all([
          api.request<ReferralSummary>('/api/v1/referrals', { signal }),
          api.request<Page<Payout>>('/api/v1/referrals/payouts?limit=50', { signal }),
        ]),
      );
      if (!result || current !== generation.current) return;
      const [account, page] = result;
      historyGeneration.current = generation.current;
      setSummary(account);
      setSummaryCurrent(true);
      setPayouts(page.items);
      setCursor(page.next_cursor);
      setFailure(undefined);
    } catch (error) {
      if (current === generation.current) setFailure(error);
    }
  }, [generation, invalidate, read]);
  useEffect(() => {
    const load = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    load();
    window.addEventListener('focus', load);
    window.addEventListener('online', load);
    document.addEventListener('visibilitychange', load);
    return () => {
      window.removeEventListener('focus', load);
      window.removeEventListener('online', load);
      document.removeEventListener('visibilitychange', load);
    };
  }, [refresh]);
  async function updateSummary() {
    setCursor(null);
    // Do not retain a pre-command balance if the authoritative refresh is unavailable.
    setSummaryCurrent(false);
    const current = generation.current;
    try {
      const account = await read('summary', (signal) =>
        api.request<ReferralSummary>('/api/v1/referrals', { signal }),
      );
      if (account && current === generation.current) {
        setSummary(account);
        setSummaryCurrent(true);
        setFailure(undefined);
      }
    } catch (error) {
      if (current === generation.current) setFailure(error);
    }
  }
  return (
    <section aria-labelledby="referral-heading">
      <h2 id="referral-heading">{t('referrals')}</h2>
      {failure !== undefined && (
        <p role="alert" className="error">
          {errorText(failure)}
        </p>
      )}
      <ActionButton action={() => refresh()}>{t('refresh')}</ActionButton>
      {!summary && failure === undefined && <p role="status">{t('loading')}</p>}
      {summary && (
        <div className="grid">
          <section className="card">
            <h3>{t('referralCode')}</h3>
            <code>{summary.code}</code>
            <Field label={t('referralLink')} value={summary.referral_url} readOnly />
            {summaryCurrent && (
              <dl>
                {(['earned', 'reserved', 'paid', 'available', 'debt'] as const).map((key) => (
                  <div key={key}>
                    <dt>{t(key)}</dt>
                    <dd>{summary[key]} USDT</dd>
                  </div>
                ))}
                <dt>{t('rate')}</dt>
                <dd>{summary.rate_bps}</dd>
              </dl>
            )}
            <p className="muted">{t('bpsHint')}</p>
          </section>
          <section className="card">
            <p className="notice">{t('manualPayout')}</p>
            <fieldset disabled={!summaryCurrent}>
              <ActionForm
                submit={t('requestPayout')}
                onSubmit={async (form) => {
                  const payout = await command<Payout>(
                    'payout:create',
                    '/api/v1/referrals/payouts',
                    {
                      network: value(form, 'network'),
                      address: value(form, 'address'),
                    },
                  );
                  setPayouts((previous) => [
                    payout,
                    ...previous.filter((item) => item.id !== payout.id),
                  ]);
                  await updateSummary();
                }}
              >
                <label className="field">
                  <span>{t('network')}</span>
                  <select name="network" required>
                    {summary.payout_networks.map((network) => (
                      <option key={network} value={network}>
                        {network.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <Field
                  label={t('address')}
                  name="address"
                  required
                  maxLength={200}
                  autoComplete="off"
                />
              </ActionForm>
            </fieldset>
          </section>
          <section className="card">
            <h3>{t('payouts')}</h3>
            {payouts.length === 0 && <p>{t('empty')}</p>}
            <ul className="records">
              {payouts.map((item) => (
                <li key={item.id}>
                  <strong>
                    {item.amount} {item.currency}
                  </strong>
                  <span>{t(item.state)}</span>
                  <code>{item.id}</code>
                  <span>
                    {item.network}: {item.address}
                  </span>
                  <Time value={item.created_at} />
                  {item.reason && <p>{item.reason}</p>}
                  {item.reference && <code>{item.reference}</code>}
                  {item.paid_at && <Time value={item.paid_at} />}
                  {item.state === 'PENDING' && (
                    <ActionButton
                      action={async () => {
                        const updated = await command<Payout>(
                          `payout:cancel:${item.id}`,
                          `/api/v1/referrals/payouts/${encodeURIComponent(item.id)}/cancel`,
                          { expected_version: item.version },
                        );
                        setPayouts((previous) =>
                          previous.map((row) => (row.id === updated.id ? updated : row)),
                        );
                        await updateSummary();
                      }}
                    >
                      {t('cancelPayout')}
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
            {cursor && (
              <ActionButton
                action={async () => {
                  if (historyGeneration.current !== generation.current) return;
                  const current = generation.current;
                  const page = await read('payout-page', (signal) =>
                    api.request<Page<Payout>>(
                      `/api/v1/referrals/payouts?limit=50&cursor=${encodeURIComponent(cursor)}`,
                      { signal },
                    ),
                  );
                  if (!page || current !== generation.current) return;
                  setPayouts((previous) => [
                    ...previous,
                    ...page.items.filter((item) => !previous.some((row) => row.id === item.id)),
                  ]);
                  setCursor(page.next_cursor);
                }}
              >
                {t('more')}
              </ActionButton>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
