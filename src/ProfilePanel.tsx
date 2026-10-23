import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { ActionButton, ActionForm, Field, Time, value } from './components';
import { useI18n, useText, type Locale } from './i18n';
import { accountMessages, deliveryStatusKey } from './account-resources';
import type {
  ProfileResponse as Account,
  Preferences,
  TelegramStatus,
  TelegramLinkResponse as Link,
  Overview,
} from './generated/businessv1';

export type SafeDelivery = {
  id: string;
  channel: string;
  status: 'pending' | 'leased' | 'retry' | 'sent' | 'failed';
  attempts: number;
  created_at: string;
  delivered_at: string | null;
};

export function ProfilePanel({ onLocale }: { onLocale?: (locale: Locale) => void } = {}) {
  const t = useText(accountMessages);
  const { locale, setLocale, error: errorText } = useI18n();
  const [account, setAccount] = useState<Account>();
  const [overview, setOverview] = useState<Overview>();
  const [failure, setFailure] = useState<unknown>();
  const [telegram, setTelegram] = useState<TelegramStatus>();
  const [link, setLink] = useState<Link>();
  const [history, setHistory] = useState<SafeDelivery[] | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string>();
  const [reauthenticated, setReauthenticated] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void api
      .request<Account>('/api/v1/users/me', { signal: controller.signal })
      .then((data) => {
        if (cancelled) return;
        setAccount(data);
        setLocale(data.profile.website_locale);
        onLocale?.(data.profile.website_locale);
      })
      .catch((error) => {
        if (!cancelled) setFailure(error);
      });
    void api
      .request<Overview>('/api/v1/users/me/overview', { signal: controller.signal })
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch((error) => {
        if (!cancelled) setFailure(error);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [onLocale, setLocale]);
  const refreshTelegram = useCallback(async (signal?: AbortSignal) => {
    const status = await api.request<TelegramStatus>('/api/v1/users/me/telegram', { signal });
    if (signal?.aborted) return;
    setTelegram(status);
    if (status.linked && !status.unlink_pending) setLink(undefined);
    if (!status.linked) setReauthenticated(false);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState === 'visible')
        void refreshTelegram(controller.signal).catch((error) => {
          if (!controller.signal.aborted) setFailure(error);
        });
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refreshTelegram]);
  const linked = telegram?.linked ?? account?.profile.telegram_linked ?? false;
  async function loadHistory(more = false) {
    const page = await api.requestWithMetadata<SafeDelivery[]>(
      `/api/v1/notifications?limit=50${more && historyCursor ? `&cursor=${encodeURIComponent(historyCursor)}` : ''}`,
    );
    setHistory((previous) => (more ? [...(previous ?? []), ...page.data] : page.data));
    setHistoryCursor(page.next_cursor ?? undefined);
  }
  return (
    <section aria-labelledby="profile-heading">
      <h2 id="profile-heading">{t('profileHeading')}</h2>
      <ActionButton
        action={async () => {
          const [updated, composed] = await Promise.all([
            api.request<Account>('/api/v1/users/me'),
            api.request<Overview>('/api/v1/users/me/overview'),
          ]);
          setAccount(updated);
          setOverview(composed);
          setFailure(undefined);
        }}
      >
        {t('refresh')}
      </ActionButton>
      {failure !== undefined && (
        <p className="error" role="alert">
          {errorText(failure)}
        </p>
      )}
      {!account && failure === undefined && <p role="status">{t('loading')}</p>}
      {account && (
        <div className="grid">
          <section className="card">
            <ActionForm
              title={t('profile')}
              submit={t('saveProfile')}
              onSubmit={async (form) => {
                setAccount(
                  await api.request<Account>('/api/v1/users/me', {
                    method: 'PATCH',
                    body: {
                      display_name: value(form, 'display_name') || null,
                      avatar_url: value(form, 'avatar_url') || null,
                      phone_number: value(form, 'phone_number') || null,
                    },
                  }),
                );
              }}
            >
              <p>{account.profile.email}</p>
              <Field
                label={t('displayName')}
                name="display_name"
                defaultValue={account.profile.display_name ?? ''}
                maxLength={100}
                autoComplete="name"
              />
              <Field
                label={t('avatar')}
                name="avatar_url"
                type="url"
                defaultValue={account.profile.avatar_url ?? ''}
                maxLength={2048}
              />
              <Field
                label={t('phone')}
                name="phone_number"
                type="tel"
                defaultValue={account.profile.phone_number ?? ''}
                maxLength={32}
                autoComplete="tel"
              />
            </ActionForm>
          </section>
          <section className="card">
            <ActionForm
              submit={t('saveWebsiteLocale')}
              onSubmit={async (form) => {
                const updated = await api.request<Account>('/api/v1/users/me', {
                  method: 'PATCH',
                  body: { website_locale: value(form, 'website_locale') },
                });
                setAccount(updated);
                setLocale(updated.profile.website_locale);
                onLocale?.(updated.profile.website_locale);
              }}
            >
              <label className="field">
                <span>{t('websiteLocale')}</span>
                <select key={locale} name="website_locale" defaultValue={locale}>
                  <option value="en">{t('english')}</option>
                  <option value="ru">{t('russian')}</option>
                </select>
              </label>
            </ActionForm>
            <ActionForm
              submit={t('saveNotificationLocale')}
              onSubmit={async (form) => {
                setAccount(
                  await api.request<Account>('/api/v1/users/me', {
                    method: 'PATCH',
                    body: { notification_locale: value(form, 'notification_locale') },
                  }),
                );
              }}
            >
              <label className="field">
                <span>{t('notificationLocale')}</span>
                <select
                  name="notification_locale"
                  defaultValue={account.profile.notification_locale}
                >
                  <option value="en">{t('english')}</option>
                  <option value="ru">{t('russian')}</option>
                </select>
              </label>
            </ActionForm>
          </section>
          <section className="card">
            <ActionForm
              title={t('notifications')}
              submit={t('saveNotifications')}
              onSubmit={async (form) => {
                const body: Partial<Preferences> = {};
                for (const key of Object.keys(
                  account.notification_settings,
                ) as (keyof Preferences)[]) {
                  if (key.startsWith('telegram_') && (!account.capabilities.telegram || !linked))
                    continue;
                  body[key] = form.has(key);
                }
                setAccount(
                  await api.request<Account>('/api/v1/users/me/notifications', {
                    method: 'PATCH',
                    body,
                  }),
                );
              }}
            >
              {(Object.keys(account.notification_settings) as (keyof Preferences)[]).map((key) => (
                <label className="check" key={key}>
                  <input
                    name={key}
                    type="checkbox"
                    defaultChecked={account.notification_settings[key]}
                    disabled={
                      key.startsWith('telegram_') && (!account.capabilities.telegram || !linked)
                    }
                  />
                  {t(key)}
                </label>
              ))}
              <p className="muted">{t('mandatory')}</p>
            </ActionForm>
          </section>
          <section className="card">
            <h3>{t('telegram')}</h3>
            {!account.capabilities.telegram ? (
              <p role="status">{t('telegramUnavailable')}</p>
            ) : (
              <>
                <p className={linked ? 'success' : 'muted'}>
                  {linked ? t('telegramLinked') : t('telegramUnlinked')}
                </p>
                {!linked && (
                  <ActionButton
                    action={async () => {
                      const result = await api.request<Link>('/api/v1/users/me/telegram/link', {
                        method: 'POST',
                        body: {},
                      });
                      const url = new URL(result.bot_url);
                      if (
                        url.protocol !== 'https:' ||
                        url.hostname !== 't.me' ||
                        url.username ||
                        url.password
                      )
                        throw new Error('invalid_telegram_url');
                      setLink(result);
                      await refreshTelegram();
                    }}
                  >
                    {t('startLink')}
                  </ActionButton>
                )}
                {link && (
                  <>
                    <p>
                      <a href={link.bot_url} target="_blank" rel="noopener noreferrer">
                        {t('openBot')}
                      </a>
                    </p>
                    <p>{t('linkInstructions')}</p>
                    <p>
                      {t('expires')}: <Time value={link.expires_at} />
                    </p>
                  </>
                )}
                {!linked && telegram?.candidate_ready && (
                  <>
                    <p role="status">{t('candidate')}</p>
                    {link && (
                      <ActionButton
                        action={async () => {
                          setTelegram(
                            await api.request<TelegramStatus>('/api/v1/users/me/telegram/confirm', {
                              method: 'POST',
                              body: { link_token: link.link_token },
                            }),
                          );
                          setLink(undefined);
                        }}
                      >
                        {t('confirmLink')}
                      </ActionButton>
                    )}
                  </>
                )}
                <ActionButton action={() => refreshTelegram()}>{t('refreshTelegram')}</ActionButton>
                {linked && !telegram?.unlink_pending && (
                  <>
                    <ActionForm
                      title={t('reauth')}
                      submit={t('confirmPassword')}
                      onSubmit={async (form) => {
                        const code = value(form, 'code').trim();
                        await api.request('/api/v1/auth/reauth', {
                          method: 'POST',
                          body: { password: value(form, 'password'), ...(code ? { code } : {}) },
                        });
                        setReauthenticated(true);
                      }}
                    >
                      <Field
                        label={t('password')}
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                      />
                      {overview?.account.data?.user.mfa_enabled !== false && (
                        <Field
                          label={t('reauthCode')}
                          name="code"
                          required={overview?.account.data?.user.mfa_enabled === true}
                          autoComplete="one-time-code"
                          maxLength={128}
                        />
                      )}
                    </ActionForm>
                    {reauthenticated && (
                      <ActionButton
                        action={async () => {
                          await api.request('/api/v1/users/me/telegram/unlink', {
                            method: 'POST',
                            body: {},
                          });
                          setTelegram((previous) => ({
                            linked: true,
                            binding_version:
                              previous?.binding_version ?? account.profile.binding_version,
                            candidate_ready: false,
                            link_pending: false,
                            unlink_pending: true,
                          }));
                        }}
                      >
                        {t('unlink')}
                      </ActionButton>
                    )}
                    {!reauthenticated && <p className="muted">{t('reauth')}</p>}
                  </>
                )}
                {telegram?.unlink_pending && <p role="status">{t('unlinkPending')}</p>}
              </>
            )}
          </section>
          <section className="card">
            <h3>{t('overview')}</h3>
            {!overview ? (
              <p>{t('loading')}</p>
            ) : (
              <>
                <dl>
                  {(['account', 'subscriptions', 'orders', 'referrals'] as const).map((key) => (
                    <div key={key}>
                      <dt>{t(key)}</dt>
                      <dd>
                        {overview[key]?.status === 'available'
                          ? t('availableStatus')
                          : overview[key]?.status === 'pending'
                            ? t('pending')
                            : t('unavailable')}
                      </dd>
                    </div>
                  ))}
                </dl>
                {overview.account.status === 'available' && overview.account.data && (
                  <dl>
                    <dt>{t('verification')}</dt>
                    <dd>{t(overview.account.data.user.is_verified ? 'yes' : 'no')}</dd>
                    <dt>{t('mfa')}</dt>
                    <dd>{t(overview.account.data.user.mfa_enabled ? 'yes' : 'no')}</dd>
                  </dl>
                )}
              </>
            )}
          </section>
          <section className="card">
            <h3>{t('history')}</h3>
            <ActionButton action={() => loadHistory()}>{t('loadHistory')}</ActionButton>
            {history?.length === 0 && <p>{t('empty')}</p>}
            <ul className="records">
              {history?.map((item) => (
                <li key={item.id}>
                  <strong>
                    {item.channel}: {t(deliveryStatusKey(item.status))}
                  </strong>
                  <code>{item.id}</code>
                  <span>
                    {t('attempts')}: {item.attempts}
                  </span>
                  <Time value={item.created_at} />
                  {item.delivered_at && <Time value={item.delivered_at} />}
                </li>
              ))}
            </ul>
            {historyCursor && (
              <ActionButton action={() => loadHistory(true)}>{t('more')}</ActionButton>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
