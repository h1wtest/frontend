import { useEffect, useState } from 'react';
import { ActionButton, Time } from './components';
import { OidcConsumer, type OidcProof } from './oidc';
const consumer = new OidcConsumer();
// React development StrictMode may remount effects; a callback must be exchanged exactly once.
let callbackRequest: Promise<OidcProof> | undefined;
export function clearOidcContext(preserveTransaction = false) {
  callbackRequest = undefined;
  consumer.clear(preserveTransaction);
}
export function OidcPanel() {
  const [proof, setProof] = useState<OidcProof>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(window.location.pathname === '/oidc/callback');
  useEffect(
    () =>
      consumer.onClear(() => {
        setProof(undefined);
        setPending(false);
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
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : 'OIDC проверка не пройдена');
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
      <h2>OIDC: стандартный потребитель</h2>
      <p>
        Публичный клиент <code>web-demo</code>, Authorization Code + PKCE S256. Реальная проверка
        discovery, подписи RS256 через JWKS, issuer, audience, nonce, state и subject UserInfo
        библиотекой oauth4webapi.
      </p>
      <p className="muted">
        Access/refresh tokens хранятся только в памяти этой вкладки, не отображаются и исчезнут при
        перезагрузке. В sessionStorage сохраняется лишь одноразовая транзакция PKCE на 10 минут.
      </p>
      <ActionButton
        action={async () => {
          callbackRequest = undefined;
          window.location.assign(await consumer.begin());
        }}
      >
        Начать OIDC-вход
      </ActionButton>
      {pending && <p role="status">Проверка callback, подписи и UserInfo…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {proof && (
        <>
          <p role="status" className="success">
            {proof.refreshed
              ? 'Refresh rotation и повторная проверка выполнены.'
              : 'OIDC подтверждён: подпись и claims проверены.'}
          </p>
          <dl>
            <dt>Issuer</dt>
            <dd>{proof.claims.iss}</dd>
            <dt>Subject</dt>
            <dd>{proof.claims.sub}</dd>
            <dt>Audience</dt>
            <dd>{String(proof.claims.aud)}</dd>
            <dt>Email</dt>
            <dd>{String(proof.userinfo.email ?? 'Scope не предоставлен')}</dd>
            <dt>Срок access token</dt>
            <dd>
              <Time value={new Date(proof.expiresAt).toISOString()} />
            </dd>
          </dl>
          <details>
            <summary>Проверенные публичные claims</summary>
            <pre>
              {JSON.stringify({ id_token: proof.claims, userinfo: proof.userinfo }, null, 2)}
            </pre>
          </details>
          <ActionButton
            action={async () => {
              try {
                setProof(await consumer.refresh());
                setError('');
              } catch (error) {
                setProof(undefined);
                throw error;
              }
            }}
          >
            Проверить refresh rotation
          </ActionButton>
          <button type="button" onClick={() => clearOidcContext()}>
            Удалить OIDC-токены из памяти
          </button>
        </>
      )}
    </section>
  );
}
