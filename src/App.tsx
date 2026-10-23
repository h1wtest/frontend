import { Fragment, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { safeReturnTo, type AuthSession } from './auth';
import { AccountEntry } from './AccountEntry';
import { AdminPanel } from './AdminPanel';
import { OidcPanel, clearOidcContext } from './OidcPanel';
import { ProfilePanel } from './ProfilePanel';
import { SecurityPanel } from './SecurityPanel';
import { CommercePanel } from './CommercePanel';
import { OverviewPanel } from './OverviewPanel';
import { ReferralPanel } from './ReferralPanel';
import { ConsentPanel } from './ConsentPanel';
import { ActionButton } from './components';
import { useI18n, useText, type Locale } from './i18n';
import { loadPublicConfig, type PublicConfig } from './config';
const messages = {
  skip: { en: 'Skip to content', ru: 'Перейти к содержимому' },
  account: { en: 'Account management', ru: 'Управление учётной записью' },
  logout: { en: 'Sign out', ru: 'Выйти' },
  checking: { en: 'Checking session…', ru: 'Проверка сессии…' },
  retry: { en: 'Retry', ru: 'Повторить' },
  expired: {
    en: 'Your session is missing, expired or revoked. Sign in again.',
    ru: 'Сессия отсутствует, истекла или была отозвана. Войдите снова.',
  },
  sections: { en: 'Sections', ru: 'Разделы' },
  overview: { en: 'Overview', ru: 'Обзор' },
  catalog: { en: 'Catalog', ru: 'Каталог' },
  subscriptions: { en: 'Subscriptions', ru: 'Подписки' },
  payments: { en: 'Payments', ru: 'Платежи' },
  referrals: { en: 'Referrals', ru: 'Реферальная программа' },
  profile: { en: 'Settings', ru: 'Настройки' },
  security: { en: 'Security', ru: 'Безопасность' },
  admin: { en: 'Administration', ru: 'Администрирование' },
  oidc: { en: 'OIDC consumer', ru: 'OIDC-потребитель' },
  login: { en: 'Sign in and register', ru: 'Вход и регистрация' },
  continueQuestion: {
    en: 'Continue signing in to the external OIDC client?',
    ru: 'Продолжить вход во внешний OIDC-клиент?',
  },
  continue: { en: 'Continue authorization', ru: 'Продолжить авторизацию' },
  language: { en: 'Interface language', ru: 'Язык интерфейса' },
  configError: {
    en: 'Public branding configuration is unavailable or invalid. Account APIs remain available.',
    ru: 'Публичная конфигурация оформления недоступна или некорректна. API аккаунта доступны.',
  },
  help: { en: 'Help', ru: 'Помощь' },
  footer: {
    en: 'Secure cookie · CSRF · Server-authoritative access · No automatic wallet charges',
    ru: 'Secure cookie · CSRF · Доступ проверяет сервер · Без автосписания с кошелька',
  },
};
type Tab =
  | 'overview'
  | 'catalog'
  | 'subscriptions'
  | 'payments'
  | 'referrals'
  | 'profile'
  | 'security'
  | 'admin'
  | 'oidc';
export default function App() {
  const { locale, setLocale, error: localError } = useI18n();
  const text = useText(messages);
  const [auth, setAuth] = useState<AuthSession>();
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ cause: unknown }>();
  const [expired, setExpired] = useState(false);
  const [config, setConfig] = useState<PublicConfig>();
  const [configFailed, setConfigFailed] = useState(false);
  const [localeBusy, setLocaleBusy] = useState(false);
  const [localeFailure, setLocaleFailure] = useState<{ cause: unknown }>();
  const [tab, setTab] = useState<Tab>(
    window.location.pathname === '/oidc/callback' ? 'oidc' : 'profile',
  );
  const [resetToken, setResetToken] = useState(
    () => new URLSearchParams(window.location.search).get('token') ?? undefined,
  );
  const [consentId] = useState(() =>
    window.location.pathname === '/oauth/consent'
      ? new URLSearchParams(window.location.search).get('request_id')
      : null,
  );
  const identity = useRef<string | null>();
  const requestSequence = useRef(0);
  useEffect(() => {
    api.setLanguage(locale);
  }, [locale]);
  useEffect(() => {
    const controller = new AbortController();
    void loadPublicConfig(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setConfig(value);
          document.title = value.brand.name;
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setConfigFailed(true);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (resetToken) window.history.replaceState(null, '', window.location.pathname);
  }, [resetToken]);
  const returnTo = safeReturnTo(
    new URLSearchParams(window.location.search).get('return_to'),
    window.location.origin,
  );
  async function reload() {
    const sequence = ++requestSequence.current;
    try {
      const current = await api.request<AuthSession>('/api/v1/auth/me');
      if (sequence !== requestSequence.current) return null;
      if (identity.current !== undefined && identity.current !== current.session_id)
        clearOidcContext(identity.current === null);
      identity.current = current.session_id;
      api.setSession(current.session_id, current.csrf_token);
      setAuth(current);
      setExpired(false);
      setFailure(undefined);
      return current;
    } catch (error) {
      if (sequence !== requestSequence.current) return null;
      if (identity.current !== undefined) clearOidcContext(identity.current === null);
      identity.current = null;
      api.setSession(null);
      setAuth(undefined);
      if (error instanceof ApiError && error.status === 401) return null;
      setFailure({ cause: error });
      throw error;
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    const invalidate = () => {
      requestSequence.current++;
      const hadSession = typeof identity.current === 'string';
      identity.current = null;
      api.setSession(null);
      clearOidcContext(!hadSession);
      setAuth(undefined);
      setExpired(true);
      setLoading(false);
      setLocaleFailure(undefined);
    };
    window.addEventListener('session-expired', invalidate);
    void reload().catch(() => {});
    const check = () => {
      if (document.visibilityState === 'visible') void reload().catch(() => {});
    };
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    const interval = window.setInterval(check, 60000);
    return () => {
      requestSequence.current++;
      window.removeEventListener('session-expired', invalidate);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    if (!auth) return;
    const controller = new AbortController();
    void api
      .request<{ profile: { website_locale?: Locale } }>('/api/v1/users/me', {
        signal: controller.signal,
      })
      .then((profile) => {
        if (!controller.signal.aborted && profile.profile.website_locale)
          setLocale(profile.profile.website_locale);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [auth?.session_id, setLocale]);
  const hasAdmin = auth?.user.permissions.some((permission) =>
    /^(users:|roles:|oauth:|catalog:|billing:|subscriptions:|referrals:|notifications:|audit:)/.test(
      permission,
    ),
  );
  return (
    <>
      <a className="skip" href="#content">
        {text('skip')}
      </a>
      <header>
        <div className="brand">
          {config?.brand.logo_url && (
            <img src={config.brand.logo_url} alt="" width="32" height="32" />
          )}
          <div>
            <h1>{config?.brand.name ?? 'Account Platform'}</h1>
            <p className="muted">{text('account')}</p>
          </div>
        </div>
        <div className="header-actions">
          <label className="language">
            <span>{text('language')}</span>
            <select
              value={locale}
              disabled={localeBusy}
              onChange={async (event) => {
                const next = event.target.value as Locale;
                setLocale(next);
                api.setLanguage(next);
                setLocaleFailure(undefined);
                if (!auth) return;
                const session = auth.session_id;
                setLocaleBusy(true);
                try {
                  await api.request('/api/v1/users/me', {
                    method: 'PATCH',
                    body: { website_locale: next },
                  });
                } catch (error) {
                  if (identity.current === session) setLocaleFailure({ cause: error });
                } finally {
                  setLocaleBusy(false);
                }
              }}
            >
              <option value="en">English</option>
              <option value="ru">Русский</option>
            </select>
          </label>
          {auth && (
            <div className="identity">
              <span>{auth.user.email}</span>
              <ActionButton
                action={async () => {
                  await api.request('/api/v1/auth/logout', { method: 'POST', body: {} });
                  requestSequence.current++;
                  identity.current = null;
                  api.setSession(null);
                  clearOidcContext();
                  setAuth(undefined);
                  setExpired(false);
                  window.history.replaceState(null, '', '/');
                }}
              >
                {text('logout')}
              </ActionButton>
            </div>
          )}
        </div>
      </header>
      <main id="content">
        {configFailed && <p className="muted">{text('configError')}</p>}
        {localeFailure && (
          <p role="alert" className="error">
            {localError(localeFailure.cause)}
          </p>
        )}
        {loading && <p role="status">{text('checking')}</p>}
        {failure && (
          <div role="alert" className="error">
            {localError(failure.cause)} <ActionButton action={reload}>{text('retry')}</ActionButton>
          </div>
        )}
        {expired && !auth && !loading && (
          <p role="status" className="notice">
            {text('expired')}
          </p>
        )}
        {!loading && (
          <>
            <nav className="tabs main-tabs" aria-label={text('sections')}>
              {auth &&
                (
                  [
                    'overview',
                    'catalog',
                    'subscriptions',
                    'payments',
                    'referrals',
                    'profile',
                    'security',
                    ...(hasAdmin ? ['admin'] : []),
                  ] as Tab[]
                ).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-current={tab === key ? 'page' : undefined}
                    onClick={() => setTab(key)}
                  >
                    {text(key)}
                  </button>
                ))}
              <button
                type="button"
                aria-current={tab === 'oidc' ? 'page' : undefined}
                onClick={() => setTab('oidc')}
              >
                {text('oidc')}
              </button>
              {!auth && (
                <button
                  type="button"
                  aria-current={tab !== 'oidc' ? 'page' : undefined}
                  onClick={() => setTab('profile')}
                >
                  {text('login')}
                </button>
              )}
            </nav>
            {resetToken ? (
              <AccountEntry
                resetToken={resetToken}
                authenticated={async () => {
                  await reload();
                }}
                resetComplete={async () => {
                  requestSequence.current++;
                  clearOidcContext();
                  identity.current = null;
                  api.setSession(null);
                  setAuth(undefined);
                  setLoading(true);
                  setResetToken(undefined);
                  await reload();
                }}
              />
            ) : tab === 'oidc' ? (
              <OidcPanel key={auth?.session_id ?? 'anonymous'} />
            ) : auth ? (
              <Fragment key={auth.session_id}>
                {consentId ? (
                  <ConsentPanel requestId={consentId} />
                ) : (
                  <>
                    {returnTo && (
                      <section className="notice">
                        <p>{text('continueQuestion')}</p>
                        <button type="button" onClick={() => window.location.assign(returnTo)}>
                          {text('continue')}
                        </button>
                      </section>
                    )}
                    {tab === 'overview' && <OverviewPanel auth={auth} />}
                    {(tab === 'catalog' || tab === 'subscriptions' || tab === 'payments') && (
                      <CommercePanel auth={auth} section={tab} />
                    )}
                    {tab === 'referrals' && <ReferralPanel />}
                    {tab === 'profile' && <ProfilePanel />}
                    {tab === 'security' && (
                      <SecurityPanel
                        auth={auth}
                        reload={async () => {
                          await reload();
                        }}
                      />
                    )}
                    {tab === 'admin' && <AdminPanel auth={auth} />}
                  </>
                )}
              </Fragment>
            ) : (
              <AccountEntry
                authenticated={async () => {
                  const current = await reload();
                  if (!current) throw new ApiError('unauthenticated', 401, 'unauthenticated');
                  if (returnTo) window.location.assign(returnTo);
                }}
              />
            )}
          </>
        )}
      </main>
      <footer>
        {text('footer')}
        {config?.brand.help_url && (
          <>
            {' '}
            ·{' '}
            <a href={config.brand.help_url} target="_blank" rel="noopener noreferrer">
              {text('help')}
            </a>
          </>
        )}
      </footer>
    </>
  );
}
