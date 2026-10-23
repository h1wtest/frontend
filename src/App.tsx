import { Fragment, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { safeReturnTo, type AuthSession } from './auth';
import { AccountEntry } from './AccountEntry';
import { AdminPanel } from './AdminPanel';
import { OidcPanel, clearOidcContext } from './OidcPanel';
import { ProfilePanel } from './ProfilePanel';
import { SecurityPanel } from './SecurityPanel';
import { ActionButton } from './components';

type Tab = 'profile' | 'security' | 'admin' | 'oidc';
export default function App() {
  const [auth, setAuth] = useState<AuthSession>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [tab, setTab] = useState<Tab>(
    window.location.pathname === '/oidc/callback' ? 'oidc' : 'profile',
  );
  const [resetToken, setResetToken] = useState(
    () => new URLSearchParams(window.location.search).get('token') ?? undefined,
  );
  const identity = useRef<string | null>();
  const requestSequence = useRef(0);
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
      setError('');
      return current;
    } catch (error) {
      if (sequence !== requestSequence.current) return null;
      if (identity.current !== undefined) clearOidcContext(identity.current === null);
      identity.current = null;
      api.setSession(null);
      setAuth(undefined);
      if (error instanceof ApiError && error.status === 401) {
        return null;
      } else {
        setError(error instanceof Error ? error.message : 'Сервис авторизации недоступен');
        throw error;
      }
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
    };
    window.addEventListener('session-expired', invalidate);
    void reload().catch(() => {});
    const check = () => {
      if (document.visibilityState === 'visible') void reload().catch(() => {});
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    const interval = window.setInterval(check, 60000);
    return () => {
      window.removeEventListener('session-expired', invalidate);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(interval);
    };
  }, []);
  return (
    <>
      <a className="skip" href="#content">
        Перейти к содержимому
      </a>
      <header>
        <div>
          <h1>SSO Platform</h1>
          <p className="muted">Управление учётной записью</p>
        </div>
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
                window.location.assign('/');
              }}
            >
              Выйти
            </ActionButton>
          </div>
        )}
      </header>
      <main id="content">
        {loading && <p role="status">Проверка сессии…</p>}
        {error && (
          <div role="alert" className="error">
            {error} <ActionButton action={reload}>Повторить</ActionButton>
          </div>
        )}
        {expired && !auth && !loading && (
          <p role="status" className="notice">
            Сессия отсутствует, истекла или была отозвана. Войдите снова.
          </p>
        )}
        {!loading && (
          <>
            <nav className="tabs main-tabs" aria-label="Разделы">
              {auth && (
                <>
                  {(
                    [
                      ['profile', 'Профиль'],
                      ['security', 'Безопасность'],
                      ['admin', 'Администрирование'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      aria-current={tab === key ? 'page' : undefined}
                      onClick={() => setTab(key)}
                    >
                      {label}
                    </button>
                  ))}
                </>
              )}
              <button
                type="button"
                aria-current={tab === 'oidc' ? 'page' : undefined}
                onClick={() => setTab('oidc')}
              >
                OIDC-потребитель
              </button>
              {!auth && (
                <button
                  type="button"
                  aria-current={tab !== 'oidc' ? 'page' : undefined}
                  onClick={() => setTab('profile')}
                >
                  Вход и регистрация
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
                {returnTo && (
                  <section className="notice">
                    <p>Продолжить вход во внешний OIDC-клиент?</p>
                    <button type="button" onClick={() => window.location.assign(returnTo)}>
                      Продолжить авторизацию
                    </button>
                  </section>
                )}
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
              </Fragment>
            ) : (
              <AccountEntry
                authenticated={async () => {
                  const current = await reload();
                  if (!current) throw new Error('Сессия не подтверждена. Войдите снова.');
                  if (returnTo) window.location.assign(returnTo);
                }}
              />
            )}
          </>
        )}
      </main>
      <footer>
        Только реальные серверные операции · Secure cookie / CSRF · Без bearer-токенов в
        localStorage
      </footer>
    </>
  );
}
