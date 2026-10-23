import { useEffect, useState } from 'react';
import { ActionButton, Time } from './components';
import { OidcConsumer, type OidcProof } from './oidc';
import { useText } from './i18n';
import { identityMessages } from './identity-resources';
const consumer = new OidcConsumer();
// React development StrictMode may remount effects; a callback must be exchanged exactly once.
let callbackRequest: Promise<OidcProof> | undefined;
export function clearOidcContext(preserveTransaction = false) {
  callbackRequest = undefined;
  consumer.clear(preserveTransaction);
}
export function OidcPanel() {
  const t = useText(identityMessages);
  const [proof, setProof] = useState<OidcProof>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(window.location.pathname === '/oidc/callback');
  useEffect(
    () =>
      consumer.onClear(() => {
        setProof(undefined);
        setPending(false);
        setError('');
        callbackRequest = undefined;
      }),
    [],
  );
  useEffect(() => {
    if (window.location.pathname !== '/oidc/callback') return;
    let active = true;
    callbackRequest ??= consumer.complete(new URL(window.location.href));
    // Remove the one-use code and state from history, including failure paths.
    window.history.replaceState(null, '', '/oidc/callback');
    void callbackRequest
      .then((result) => {
        if (active) setProof(result);
      })
      .catch(() => {
        if (active) setError('oidcFailed');
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="card">
      <h2>{t('oidc')}</h2>
      <p>{t('oidcDescription')}</p>
      <p className="muted">{t('oidcMemory')}</p>
      <ActionButton
        action={async () => {
          callbackRequest = undefined;
          try {
            window.location.assign(await consumer.begin());
          } catch {
            setError('oidcFailed');
          }
        }}
      >
        {t('beginOidc')}
      </ActionButton>
      {pending && <p role="status">{t('checkingOidc')}</p>}
      {error && (
        <p role="alert" className="error">
          {t('oidcFailed')}
        </p>
      )}
      {proof && (
        <>
          <p role="status" className="success">
            {t(proof.refreshed ? 'oidcRefreshed' : 'oidcVerified')}
          </p>
          <dl>
            <dt>{t('issuer')}</dt>
            <dd>{proof.claims.iss}</dd>
            <dt>{t('subject')}</dt>
            <dd>{proof.claims.sub}</dd>
            <dt>{t('audience')}</dt>
            <dd>{String(proof.claims.aud)}</dd>
            <dt>{t('email')}</dt>
            <dd>{String(proof.userinfo.email ?? t('scopeMissing'))}</dd>
            <dt>{t('tokenExpiry')}</dt>
            <dd>
              <Time value={new Date(proof.expiresAt).toISOString()} />
            </dd>
          </dl>
          <details>
            <summary>{t('claims')}</summary>
            <pre>
              {JSON.stringify({ id_token: proof.claims, userinfo: proof.userinfo }, null, 2)}
            </pre>
          </details>
          <ActionButton
            action={async () => {
              try {
                setProof(await consumer.refresh());
                setError('');
              } catch {
                setProof(undefined);
                setError('oidcFailed');
              }
            }}
          >
            {t('refreshOidc')}
          </ActionButton>
          <button type="button" onClick={() => clearOidcContext()}>
            {t('clearOidc')}
          </button>
        </>
      )}
    </section>
  );
}
