// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { Time } from './components';
import { useI18n, useText } from './i18n';
import { identityMessages } from './identity-resources';

type Consent = { request_id: string; client_name: string; scopes: string[]; expires_at: string };
type Props = { requestId: string; onComplete?: (redirectTo: string) => void };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const scopeText = {
  openid: 'scopeOpenid',
  email: 'scopeEmail',
  profile: 'scopeProfile',
  offline_access: 'scopeOffline',
} as const;

export function ConsentPanel(props: Props) {
  return <ConsentRequest key={props.requestId} {...props} />;
}
function ConsentRequest({ requestId, onComplete }: Props) {
  const t = useText(identityMessages);
  const { error: describeError } = useI18n();
  const [consent, setConsent] = useState<Consent>();
  const [error, setError] = useState<unknown>();
  const [unsafe, setUnsafe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [expired, setExpired] = useState(false);
  const active = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    const endSession = () => {
      active.current = false;
      controller.abort();
      mutation.current?.abort();
      setConsent(undefined);
      setError(new ApiError('', 401, 'unauthenticated'));
    };
    window.addEventListener('session-expired', endSession);
    if (!uuid.test(requestId)) setError(new ApiError('', 400, 'invalid_request'));
    else
      void api
        .request<Consent>('/api/v1/auth/oauth/consent/' + requestId, { signal: controller.signal })
        .then((result) => {
          if (active.current && !controller.signal.aborted) {
            if (result.request_id !== requestId) {
              setError(new ApiError('', 400, 'invalid_request'));
              return;
            }
            setConsent(result);
          }
        })
        .catch((failure) => {
          if (active.current && !controller.signal.aborted) setError(failure);
        });
    return () => {
      active.current = false;
      controller.abort();
      mutation.current?.abort();
      window.removeEventListener('session-expired', endSession);
    };
  }, [requestId]);
  useEffect(() => {
    if (!consent) return;
    const delay = Date.parse(consent.expires_at) - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) {
      setExpired(true);
      return;
    }
    const timer = window.setTimeout(() => setExpired(true), Math.min(delay, 2147483647));
    return () => window.clearTimeout(timer);
  }, [consent]);
  async function decide(approved: boolean) {
    if (busy || finished || expired || !consent || !active.current) return;
    setBusy(true);
    setError(undefined);
    setUnsafe(false);
    const controller = new AbortController();
    mutation.current = controller;
    try {
      const result = await api.request<{ redirect_to: string }>(
        '/api/v1/auth/oauth/consent/' + requestId,
        { method: 'POST', body: { approved }, signal: controller.signal },
      );
      if (!active.current || controller.signal.aborted) return;
      const redirect = result.redirect_to;
      const expected = '/oauth/consent/complete/' + requestId;
      // Never let a JSON response turn this privileged browser session into an open redirect.
      // The identity backend completes authorization and owns the final registered-client redirect.
      if (typeof redirect !== 'string' || redirect !== expected) {
        setUnsafe(true);
        setFinished(true);
        return;
      }
      const destination = new URL(redirect, window.location.origin);
      if (destination.origin !== window.location.origin) {
        setUnsafe(true);
        setFinished(true);
        return;
      }
      setFinished(true);
      if (onComplete) onComplete(destination.pathname);
      else window.location.assign(destination.pathname);
    } catch (failure) {
      if (active.current && !controller.signal.aborted) setError(failure);
    } finally {
      if (active.current && !controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="card" aria-labelledby="consent-heading" aria-busy={busy}>
      <h2 id="consent-heading">{t('consent')}</h2>
      {error !== undefined && (
        <p className="error" role="alert">
          {describeError(error)}
        </p>
      )}
      {unsafe && (
        <p className="error" role="alert">
          {t('unsafeRedirect')}
        </p>
      )}
      {!consent && error === undefined && <p role="status">{t('loading')}</p>}
      {consent && (
        <>
          <h3>{consent.client_name}</h3>
          <p>{t('consentHint')}</p>
          <h4>{t('scopes')}</h4>
          <ul>
            {consent.scopes.map((scope) => (
              <li key={scope}>
                <code>{scope}</code>
                {scope in scopeText && <> — {t(scopeText[scope as keyof typeof scopeText])}</>}
              </li>
            ))}
          </ul>
          <p>
            {t('expires')}: <Time value={consent.expires_at} />
          </p>
          {expired && <p role="alert">{t('consentExpired')}</p>}
          {finished && !unsafe && <p role="status">{t('consentComplete')}</p>}
          {!finished && (
            <fieldset disabled={busy || expired}>
              <button type="button" className="primary" onClick={() => void decide(true)}>
                {t('approve')}
              </button>
              <button type="button" onClick={() => void decide(false)}>
                {t('deny')}
              </button>
            </fieldset>
          )}
        </>
      )}
    </section>
  );
}
