import * as oauth from 'oauth4webapi';

interface Transaction {
  verifier: string;
  state: string;
  nonce: string;
  created: number;
}
interface TransactionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface OidcProof {
  claims: oauth.IDToken;
  userinfo: oauth.UserInfoResponse;
  expiresAt: number;
  refreshed: boolean;
}
const transactionKey = 'sso.oidc.transaction';

/** Public standards client. Persistent browser storage contains only the short-lived PKCE transaction, never tokens. */
export class OidcConsumer {
  private readonly client: oauth.Client = {
    client_id: 'web-demo',
    id_token_signed_response_alg: 'RS256',
  };
  private metadata?: oauth.AuthorizationServer;
  private tokens?: oauth.TokenEndpointResponse;
  private proof?: OidcProof;
  private nonce?: string;
  private refreshing?: Promise<OidcProof>;
  private generation = 0;
  private readonly cleared = new EventTarget();
  onClear(listener: EventListener) {
    this.cleared.addEventListener('clear', listener);
    return () => this.cleared.removeEventListener('clear', listener);
  }
  private assertCurrent(generation: number) {
    if (generation !== this.generation)
      throw new Error('OIDC операция отменена: контекст авторизации изменился');
  }
  private options;
  constructor(
    private issuer = window.location.origin,
    private storage: TransactionStorage = sessionStorage,
    transport: typeof fetch = fetch,
  ) {
    this.options = { [oauth.customFetch]: transport, signal: () => AbortSignal.timeout(15000) };
  }
  private async discover() {
    if (!this.metadata) {
      const issuer = new URL(this.issuer);
      const metadata = await oauth.processDiscoveryResponse(
        issuer,
        await oauth.discoveryRequest(issuer, this.options),
      );
      for (const endpoint of [
        metadata.authorization_endpoint,
        metadata.token_endpoint,
        metadata.jwks_uri,
        metadata.userinfo_endpoint,
      ]) {
        if (!endpoint || new URL(endpoint).origin !== issuer.origin)
          throw new Error('OIDC endpoint вне доверенного issuer');
      }
      if (!metadata.id_token_signing_alg_values_supported?.includes('RS256'))
        throw new Error('Issuer не поддерживает RS256');
      this.metadata = metadata;
    }
    return this.metadata;
  }
  async begin(): Promise<string> {
    this.clear();
    const generation = this.generation;
    const as = await this.discover();
    const transaction: Transaction = {
      verifier: oauth.generateRandomCodeVerifier(),
      state: oauth.generateRandomState(),
      nonce: oauth.generateRandomNonce(),
      created: Date.now(),
    };
    const url = new URL(as.authorization_endpoint!);
    url.search = new URLSearchParams({
      client_id: this.client.client_id,
      redirect_uri: this.issuer + '/oidc/callback',
      response_type: 'code',
      scope: 'openid email profile offline_access',
      code_challenge_method: 'S256',
      code_challenge: await oauth.calculatePKCECodeChallenge(transaction.verifier),
      state: transaction.state,
      nonce: transaction.nonce,
    }).toString();
    this.assertCurrent(generation);
    this.storage.setItem(transactionKey, JSON.stringify(transaction));
    return url.href;
  }
  async complete(callback: URL): Promise<OidcProof> {
    const generation = this.generation;
    const raw = this.storage.getItem(transactionKey);
    this.storage.removeItem(transactionKey);
    if (!raw) throw new Error('OIDC транзакция отсутствует или уже использована. Начните заново.');
    try {
      const tx = JSON.parse(raw) as Transaction;
      if (
        !tx.verifier ||
        !tx.state ||
        !tx.nonce ||
        !Number.isFinite(tx.created) ||
        Date.now() - tx.created > 600000 ||
        tx.created > Date.now() ||
        callback.origin !== this.issuer ||
        callback.pathname !== '/oidc/callback'
      )
        throw new Error('OIDC транзакция истекла или callback недопустим');
      const as = await this.discover();
      this.assertCurrent(generation);
      const params = oauth.validateAuthResponse(as, this.client, callback, tx.state);
      const response = await oauth.authorizationCodeGrantRequest(
        as,
        this.client,
        oauth.None(),
        params,
        this.issuer + '/oidc/callback',
        tx.verifier,
        this.options,
      );
      const tokens = await oauth.processAuthorizationCodeResponse(as, this.client, response, {
        expectedNonce: tx.nonce,
        requireIdToken: true,
      });
      await oauth.validateApplicationLevelSignature(as, response, this.options);
      const claims = oauth.getValidatedIdTokenClaims(tokens)!;
      if (claims.token_use !== 'id') throw new Error('Ожидался ID token, а не access token');
      const userinfo = await oauth.processUserInfoResponse(
        as,
        this.client,
        claims.sub,
        await oauth.userInfoRequest(as, this.client, tokens.access_token, this.options),
      );
      this.assertCurrent(generation);
      this.nonce = tx.nonce;
      this.tokens = tokens;
      return (this.proof = {
        claims,
        userinfo,
        expiresAt: Date.now() + (tokens.expires_in ?? 0) * 1000,
        refreshed: false,
      });
    } catch (error) {
      if (generation === this.generation) this.clear();
      throw error;
    }
  }
  refresh(): Promise<OidcProof> {
    if (!this.refreshing) {
      const request = this.rotate().finally(() => {
        if (this.refreshing === request) this.refreshing = undefined;
      });
      this.refreshing = request;
    }
    return this.refreshing;
  }
  private async rotate(): Promise<OidcProof> {
    if (!this.tokens?.refresh_token || !this.proof)
      throw new Error('Нет активного refresh token. Начните OIDC-вход заново.');
    const generation = this.generation;
    const previous = this.proof.claims;
    const refreshToken = this.tokens.refresh_token;
    const nonce = this.nonce;
    try {
      const as = await this.discover();
      this.assertCurrent(generation);
      const response = await oauth.refreshTokenGrantRequest(
        as,
        this.client,
        oauth.None(),
        refreshToken,
        this.options,
      );
      const tokens = await oauth.processRefreshTokenResponse(as, this.client, response);
      const claims = oauth.getValidatedIdTokenClaims(tokens) ?? previous;
      if (tokens.id_token) {
        await oauth.validateApplicationLevelSignature(as, response, this.options);
        if (
          claims.token_use !== 'id' ||
          claims.sub !== previous.sub ||
          claims.iss !== previous.iss ||
          (claims.aud !== previous.aud &&
            JSON.stringify(claims.aud) !== JSON.stringify(previous.aud)) ||
          (claims.nonce !== undefined && claims.nonce !== nonce) ||
          claims.auth_time !== previous.auth_time
        )
          throw new Error('Идентичность или назначение ID token изменились при refresh');
      }
      const userinfo = await oauth.processUserInfoResponse(
        as,
        this.client,
        previous.sub,
        await oauth.userInfoRequest(as, this.client, tokens.access_token, this.options),
      );
      if (!tokens.refresh_token) throw new Error('Сервер не выполнил rotation refresh token');
      this.assertCurrent(generation);
      this.tokens = tokens;
      return (this.proof = {
        claims,
        userinfo,
        expiresAt: Date.now() + (tokens.expires_in ?? 0) * 1000,
        refreshed: true,
      });
    } catch (error) {
      if (generation === this.generation) this.clear();
      throw error;
    }
  }
  clear(preserveTransaction = false) {
    this.generation++;
    this.tokens = undefined;
    this.proof = undefined;
    this.nonce = undefined;
    this.refreshing = undefined;
    if (!preserveTransaction) this.storage.removeItem(transactionKey);
    this.cleared.dispatchEvent(new Event('clear'));
  }
}
