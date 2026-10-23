import { useCallback, useEffect, useRef, useState } from 'react';
import { api as defaultApi, type ApiClient } from './api';
import type { AuthSession, MfaSetup, Session } from './auth';
import { ActionButton, ActionForm, Field, Time, value } from './components';
import { useI18n, useText } from './i18n';
import { identityMessages } from './identity-resources';
import type { OAuthGrant, OAuthGrantsResponse, OAuthGrantRevoked } from './generated/businessv1';

export function SecurityPanel({
  auth,
  reload,
  client = defaultApi,
}: {
  auth: AuthSession;
  reload: () => Promise<void>;
  client?: ApiClient;
}) {
  const t = useText(identityMessages);
  const { error: describeError } = useI18n();
  const [sessions, setSessions] = useState<Session[]>();
  const [error, setError] = useState<unknown>();
  const [setup, setSetup] = useState<MfaSetup>();
  const [acknowledged, setAcknowledged] = useState(false);
  const request = useRef<AbortController | null>(null);
  const context = useRef(auth.session_id);
  context.current = auth.session_id;
  const loadSessions = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setError(undefined);
    try {
      const result = await client.request<Session[]>('/api/v1/auth/sessions', {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setSessions(result);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure);
    }
  }, [client]);
  useEffect(() => {
    setSessions(undefined);
    setSetup(undefined);
    setAcknowledged(false);
    void loadSessions();
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadSessions();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      request.current?.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [auth.session_id, auth.user.id, loadSessions]);
  const post = (path: string, body: unknown = {}) =>
    client.request('/api/v1/auth/' + path, { method: 'POST', body });
  return (
    <section aria-labelledby="security-heading">
      <h2 id="security-heading">{t('security')}</h2>
      <div className="grid">
        <section className="card">
          <ActionForm
            title={t('reauth')}
            submit={t('confirmIdentity')}
            onSubmit={async (form) => {
              await post('reauth', {
                password: value(form, 'password'),
                ...(value(form, 'code') ? { code: value(form, 'code') } : {}),
              });
              await reload();
              return t('reauthed');
            }}
          >
            <p className="muted">{t('reauthHint')}</p>
            <Field
              label={t('reauthPassword')}
              name="password"
              type="password"
              required
              autoComplete="current-password"
              maxLength={1024}
            />
            {auth.user.mfa_enabled && (
              <Field
                label={t('currentMfa')}
                name="code"
                required
                autoComplete="one-time-code"
                maxLength={128}
              />
            )}
          </ActionForm>
        </section>
        <section className="card">
          <ActionForm
            title={t('changePassword')}
            submit={t('changePassword')}
            onSubmit={async (form) => {
              await post('password/change', {
                current_password: value(form, 'current_password'),
                password: value(form, 'password'),
              });
              await reload();
              return t('passwordChanged');
            }}
          >
            <Field
              label={t('currentPassword')}
              name="current_password"
              type="password"
              required
              autoComplete="current-password"
              maxLength={1024}
            />
            <Field
              label={t('newPassword')}
              name="password"
              type="password"
              required
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
            />
          </ActionForm>
        </section>
        <section className="card">
          <h3>{t('twoFactor')}</h3>
          <p>{t(auth.user.mfa_enabled ? 'mfaEnabled' : 'mfaDisabled')}</p>
          <ActionButton
            action={async () => {
              const sessionId = auth.session_id;
              const result = await client.request<MfaSetup>('/api/v1/auth/mfa/setup', {
                method: 'POST',
                body: {},
              });
              if (context.current !== sessionId) return;
              setSetup(result);
              setAcknowledged(false);
            }}
          >
            {t(auth.user.mfa_enabled ? 'replaceMfa' : 'setupMfa')}
          </ActionButton>
          {setup && (
            <div className="secret-panel">
              <p>{t('secretHint')}</p>
              <code>{setup.secret}</code>
              <details>
                <summary>{t('authenticatorUri')}</summary>
                <code>{setup.otpauth_uri}</code>
              </details>
              <h4>{t('recoveryCodes')}</h4>
              <p>{t('saveCodes')}</p>
              <ul className="codes">
                {setup.recovery_codes.map((code) => (
                  <li key={code}>
                    <code>{code}</code>
                  </li>
                ))}
              </ul>
              <label className="check">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                {t('savedCodes')}
              </label>
              {acknowledged && (
                <ActionForm
                  submit={t('enableMfa')}
                  onSubmit={async (form) => {
                    await post('mfa/enable', { code: value(form, 'code') });
                    setSetup(undefined);
                    await reload();
                  }}
                >
                  <Field
                    label={t('newMfa')}
                    name="code"
                    required
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={8}
                  />
                </ActionForm>
              )}
              <button
                type="button"
                onClick={() => {
                  setSetup(undefined);
                  setAcknowledged(false);
                }}
              >
                {t('hideSecrets')}
              </button>
            </div>
          )}
          {auth.user.mfa_enabled && (
            <ActionForm
              title={t('disableMfa')}
              submit={t('disableMfa')}
              danger
              onSubmit={async (form) => {
                await post('mfa/disable', { code: value(form, 'code') });
                setSetup(undefined);
                await reload();
              }}
            >
              <p className="muted">{t('disableHint')}</p>
              <Field
                label={t('disableCode')}
                name="code"
                required
                autoComplete="one-time-code"
                maxLength={128}
              />
            </ActionForm>
          )}
        </section>
        <section className="card">
          <h3>{t('sessions')}</h3>
          {error !== undefined && (
            <p role="alert" className="error">
              {describeError(error)}
            </p>
          )}
          <ActionButton action={loadSessions}>{t('refreshSessions')}</ActionButton>
          <ActionButton
            danger
            action={async () => {
              await post('sessions/revoke-others');
              await reload();
              await loadSessions();
            }}
          >
            {t('revokeOthers')}
          </ActionButton>
          {!sessions && error === undefined && <p role="status">{t('loading')}</p>}
          {sessions?.length === 0 && <p>{t('noSessions')}</p>}
          <ul className="records">
            {sessions?.map((session) => (
              <li key={session.session_id}>
                <strong>
                  {session.device_name || t('unknown')}{' '}
                  {session.is_current && <span className="badge">{t('current')}</span>}
                </strong>
                <dl>
                  <dt>{t('device')}</dt>
                  <dd>
                    {session.device_label && session.device_label.toLowerCase() !== 'unknown'
                      ? session.device_label
                      : t('unknown')}
                  </dd>
                  <dt>{t('browser')}</dt>
                  <dd>
                    {session.browser && session.browser.toLowerCase() !== 'unknown'
                      ? session.browser
                      : t('unknown')}
                  </dd>
                  <dt>{t('os')}</dt>
                  <dd>
                    {session.os && session.os.toLowerCase() !== 'unknown'
                      ? session.os
                      : t('unknown')}
                  </dd>
                </dl>
                <span>{session.ip_address}</span>
                <span className="muted">{session.user_agent}</span>
                <span>
                  {t('created')}: <Time value={session.created_at} />
                </span>
                <span>
                  {t('activity')}: <Time value={session.last_active_at} />
                </span>
                <span>
                  {t('expires')}: <Time value={session.expires_at} />
                </span>
                <ActionButton
                  danger
                  action={async () => {
                    await client.request(
                      '/api/v1/auth/sessions/' + encodeURIComponent(session.session_id),
                      { method: 'DELETE' },
                    );
                    await reload();
                    if (!session.is_current) await loadSessions();
                  }}
                >
                  {t('revokeSession')}
                </ActionButton>
              </li>
            ))}
          </ul>
          <ActionForm
            submit={t('revokeAll')}
            danger
            onSubmit={async () => {
              await client.request('/api/v1/auth/sessions', { method: 'DELETE' });
              await reload();
            }}
          >
            <label className="check">
              <input type="checkbox" required />
              {t('confirmAll')}
            </label>
          </ActionForm>
        </section>
        <ConnectedApplications key={`${auth.session_id}:${auth.user.id}`} client={client} />
      </div>
    </section>
  );
}

function ConnectedApplications({ client }: { client: ApiClient }) {
  const t = useText(identityMessages);
  const { error: describeError } = useI18n();
  const [grants, setGrants] = useState<OAuthGrant[]>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const sequence = useRef(0);
  const pending = useRef<AbortController>();
  const revocations = useRef(new Set<AbortController>());
  const load = useCallback(
    async (next: string | null = null) => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      const generation = ++sequence.current;
      setBusy(true);
      setFailure(undefined);
      try {
        const page = await client.request<OAuthGrantsResponse>(
          `/api/v1/auth/oauth/grants?limit=50${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
          { signal: controller.signal },
        );
        if (!active.current || controller.signal.aborted || generation !== sequence.current) return;
        setGrants((previous) =>
          next
            ? [
                ...(previous ?? []),
                ...page.items.filter(
                  (item) => !previous?.some((current) => current.client_id === item.client_id),
                ),
              ]
            : page.items,
        );
        setCursor(page.next_cursor);
      } catch (cause) {
        if (active.current && !controller.signal.aborted && generation === sequence.current)
          setFailure(cause);
      } finally {
        if (active.current && generation === sequence.current) setBusy(false);
      }
    },
    [client],
  );
  useEffect(() => {
    active.current = true;
    void load();
    const commands = revocations.current;
    return () => {
      active.current = false;
      sequence.current++;
      pending.current?.abort();
      commands.forEach((controller) => controller.abort());
      commands.clear();
    };
  }, [load]);
  return (
    <section className="card" aria-label={t('connectedApps')}>
      <h3>{t('connectedApps')}</h3>
      <ActionButton action={() => load()}>{t('refreshApps')}</ActionButton>
      {busy && <p role="status">{t('loadingApps')}</p>}
      {failure !== undefined && (
        <p className="error" role="alert">
          {describeError(failure)}
        </p>
      )}
      {grants?.length === 0 && !failure && !busy && <p>{t('noConnectedApps')}</p>}
      <ul className="records">
        {grants?.map((grant) => (
          <li key={grant.client_id}>
            <strong>{grant.client_name}</strong>
            <code>{grant.client_id}</code>
            <span>{grant.scopes.join(', ')}</span>
            <span>{t(grant.trusted_first_party ? 'trustedGrant' : 'consentGrant')}</span>
            <span>
              {t('grantedAt')}: <Time value={grant.granted_at} />
            </span>
            <span>
              {t('lastUsedAt')}: <Time value={grant.last_used_at} />
            </span>
            <ActionButton
              danger
              action={async () => {
                const controller = new AbortController();
                revocations.current.add(controller);
                try {
                  const result = await client.request<OAuthGrantRevoked>(
                    '/api/v1/auth/oauth/grants/' + encodeURIComponent(grant.client_id),
                    { method: 'DELETE', signal: controller.signal },
                  );
                  if (!active.current || controller.signal.aborted) return;
                  if (result.client_id !== grant.client_id || result.revoked !== true)
                    throw new Error('invalid_grant_revocation');
                  sequence.current++;
                  pending.current?.abort();
                  setGrants((previous) =>
                    previous?.filter((item) => item.client_id !== result.client_id),
                  );
                  setCursor(null);
                  await load();
                } finally {
                  revocations.current.delete(controller);
                }
              }}
            >
              {t('revokeApp')}
            </ActionButton>
          </li>
        ))}
      </ul>
      {cursor && <ActionButton action={() => load(cursor)}>{t('loadMoreApps')}</ActionButton>}
    </section>
  );
}
