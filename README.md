# SSO frontend

React/TypeScript account and administrative UI, served exclusively through the same-origin HTTPS gateway (`https://localhost:8448`). The repository is the real API client, not a demonstration shell. Requires the identity, profile, notification and admin services described in the approved platform remediation specification.

## Reproducible build

Node **22.22.1**, npm **11.19.0**; exact direct dependencies and npm lockfile. Maintained standards client `oauth4webapi` **3.8.8**, Vite **8.3.5**, Vitest **5.0.5**. Run from Linux/WSL:

```sh
npm ci --ignore-scripts
npm test
npm run build
docker build -t sso-frontend:local .
```

If WSL inherits a Windows `npm` on PATH, use the native Linux node explicitly: `node /mnt/c/nvm4w/nodejs/node_modules/npm/bin/npm-cli.js ci --ignore-scripts`, `node node_modules/vitest/vitest.mjs run`, `node node_modules/typescript/bin/tsc`, `node node_modules/vite/bin/vite.js build`. Do not let a Windows npm process choose platform-specific packages for a Linux build.

Container bases are pinned by immutable multi-platform digests (Node 22.22.1 Alpine3.23; nginx-unprivileged 1.30 Alpine). Container serves port **8080** as UID/GID 101. Gateway service port 80 must target 8080. Mount `/tmp` writable when running with a read-only root filesystem; nginx writes PID/temp files there. `GET /health/live` checks nginx, `/health/ready` requires the built index. TLS terminates at the gateway. Frontend itself does not proxy backend routes: a gateway routing error produces HTTP 404, not a successful HTML response masquerading as JSON.

`npm run dev` is for component development only. Start the local platform gateway first, then run `SSO_CA_FILE=../platform-infra/.local/ca.crt npm run dev` from this repository (or supply an absolute CA PEM path). The CA file is required only by the development server, not tests, builds or preview. Development `/api`, `/oauth` and `/.well-known` requests proxy to the actual `https://localhost:8448` gateway with explicit CA and hostname verification, bounded timeouts and no TLS bypass. The proxy changes the upstream Host but preserves the browser Origin: it does not bypass server Origin/CSRF checks or rewrite Secure cookies. Read-only discovery is available at `http://localhost:3000/.well-known/openid-configuration`; its issuer remains `https://localhost:8448`. Complete cookie mutations/OIDC acceptance must use the real HTTPS gateway, configured issuer and registered callback, not insecure Vite port 3000. The test suite uses local HTTP fixtures only at the outbound transport boundary, real API client/form components, and cryptographically signed RSA identity tokens with a real JWKS endpoint; it is not a substitute for deployed integration acceptance.

## User-visible behavior

- Registration and email code confirmation, password login with MFA challenge, TOTP or one-use recovery code, authoritative session bootstrap and server logout.
- Forgot/reset password and reauthentication before password change/MFA setup/enable/disable. Active MFA replacement does not pretend setup alone has changed the factor. New recovery codes appear once in the setup view and are never persisted by the SPA.
- Profile, notification preferences, genuine Telegram link creation with capability/verified-binding guards and live profile refresh. Without bot credentials, Telegram is explicitly unavailable.
- List/revoke individual sessions or all sessions including current. HTTP 401 clears the authenticated UI; focus/visibility and a visible-tab interval refresh authoritative session state.
- Administrative user search, ban/unban, audit, delivery state, authorized failed-job replay, and metadata-only event quarantine/replay (invalid events remain quarantined with a visible server error). Explicit per-operation permissions, enabled MFA and `mfa_verified` guard entry; backend enforcement remains authoritative. No cloud/demo controls.
- Compact dark layout, keyboard focus/labels/status messages, 390px responsive forms and readable async errors.

## Browser security

Browser auth uses `sso_session` HttpOnly/Secure cookies. No access/refresh tokens enter localStorage, the DOM, URLs or application logs. Mutations bootstrap `/api/v1/auth/csrf` and send `X-CSRF-Token`; requests use same-origin credentials, reject redirects and expire after 15 seconds. Cookies and session ownership are enforced by identity, not the SPA. `return_to` accepts only the exact same-origin `/oauth/authorize` path, rejecting other origins, credentials, fragments, backslashes and control characters. This continues the real standard login redirect without an open redirect.

nginx delivers a restrictive CSP: external same-origin scripts/styles/connect only, no inline/eval, no objects/frames, no third-party resources, and no referrer. React renders server content as text. Do not relax this policy to make injected scripts work. Avatar URL is stored as profile data, never rendered as arbitrary remote content.

The static frontend disables inherited nginx access logs: default combined logging would expose recovery-token queries. Request-level native error logs also go to `/dev/null`, because nginx appends unsanitized request URIs on filesystem/request errors and cannot redact them via `log_format`. Process/configuration startup failures remain available on stderr. Sanitized request access logs and status telemetry belong to the gateway, without duplicate raw-URI logging at this layer.

Password-reset links render even while an account is signed in; their token is removed from history immediately and the document also declares `no-referrer`. An authoritative session change remounts all account-scoped panels, discarding the previous account's profile/admin caches and MFA setup secrets. Logout, expiry and session changes clear the OIDC context. Generation ownership prevents an outstanding authorization/refresh response from restoring tokens after they were cleared. The consumer additionally requires the platform's `token_use: id` claim on every newly issued ID token, rejecting a signed access JWT substituted into the ID-token field.

API responses and pending CSRF bootstrap belong to the session that started them: delayed failures cannot expire a newer account or run an old queued mutation with its credentials. Password-reset completion discards scoped UI/OIDC state and rechecks the actual cookie session. Resetting another account does not claim to log out an unrelated live session; resetting the current account returns to login after the server confirms its revocation.

## Actual OIDC consumer

Open **OIDC-потребитель → Начать OIDC-вход**, logged in or logged out. Public client **web-demo**, exact callback **https://localhost:8448/oidc/callback**. The library performs discovery with exact issuer verification, state, PKCE S256, nonce, RS256 algorithm pinning, ID token issuer/audience/timestamps, **explicit JWKS signature verification**, and matching UserInfo `sub`. The proof view shows validated public claims, not raw tokens. Refresh is a real `refresh_token` grant with rotation, signature/claim and subject continuity checks. Refresh calls are single-flight; any failure clears tokens. Fresh ID tokens on refresh cannot change authenticated subject/issuer/audience/auth_time/nonce. An omitted refresh ID token retains the already validated identity and verifies UserInfo again.

Only a 10-minute, consumed-once PKCE/state/nonce transaction crosses the authorization redirect in sessionStorage; tokens remain in memory. Reloading the proof page intentionally discards tokens and requires a new authorization. Callback query is removed from browser history, including errors. No unsigned JWT decoder or client secret is shipped.

## Integration acceptance (controller-owned)

Controller-reported local verification on 2026-10-23:

- ESLint with zero warnings, Prettier check, **28/28 behavioral tests across seven files**, TypeScript and Vite production build passed. Docker build and read-only/nonroot execution with restrictive CSP passed.
- Actual integrated browser: user login, profile update persisted across reload, delivery history, security screen, non-admin administrative denial and logout. Admin password plus TOTP login, user search, audit and delivery views were exercised.
- Actual logged-out OIDC flow: start → same-origin `return_to` login → `/oidc/callback` → oauth4webapi RS256/JWKS identity proof; refresh rotation and explicit credential clearing were exercised. No JavaScript errors were observed in these scenarios.
- Actual 390px viewport with a long email: logout remained one line with measured dimensions **68.8 × 38.5 px**, without horizontal overflow, after the CSS correction was deployed.

These observations do not claim every registration/recovery/MFA UI branch was visually exercised. Registration, password reset and MFA API acceptance are separate controller evidence, not a substitute for missing visual branches. The browser used an isolated test certificate policy: a globally trusted local CA was **not** installed; strict Python CA verification is separate evidence. Standalone static-container checks alone never establish integrated user-flow acceptance. Real Telegram remains an external gate without a supplied bot token and private test chat. No production acceptance or deployment is claimed.

## CI

The repository verification workflow uses SHA-pinned checkout/setup-node, locked installs, ESLint JavaScript/TypeScript recommended correctness rules plus React hook-order enforcement (`npm run lint`), deterministic Prettier validation (`npm run format:check`), behavioral tests, TypeScript/production build, npm dependency vulnerability gate, secret scan and an immutable commit-SHA local container build plus container CVE scan. All quality tools are exact-version locked. Use `npm run format` for an intentional one-time formatting update; CI only checks, never rewrites. No image push, deployment or cloud operation is configured. Security reports are not uploaded as artifacts.
Push, PR and manual-dispatch runs use the same verification path. Complete Git history is scanned first with digest-pinned Gitleaks and redacted output; checkout credentials are not persisted. Both CI and the Docker builder explicitly install npm 11.19.0 rather than relying on Node 22.22.1's bundled npm 10.9.4. Trivy is digest-pinned; its raw working-tree secret report stays in the disposable runner directory rather than logs or uploaded artifacts. First publication uses push/PR checks because manual dispatch requires the workflow to exist on the default branch.
The digest-pinned Nginx runtime receives signed Alpine v3.24 security packages at exact versions: `musl` and `musl-utils` **1.2.6-r3**, `zlib` **1.3.2-r1**. Alpine's security database maps these revisions to CVE-2026-107891 and CVE-2026-85091. Package installation runs as root only during the image build; the final process remains uid/gid 101. Missing pinned packages fail the build; no findings, metadata or inventories are removed. The final-image vulnerability gate evaluates all severities.
