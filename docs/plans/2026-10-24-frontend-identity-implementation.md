# Frontend Identity Implementation Plan

**Goal:** Preserve working authentication and OIDC while delivering localized registration, session management, authoritative OWNER role/client administration and explicit OAuth consent.

**Architecture:** Existing cookie/CSRF ApiClient remains the only transport. Owned screens use shared useText resources and localized stable errors. Role/client commands consume current server versions, explicit reasons, and existing fresh password/MFA reauthentication. No runtime mock data or new dependencies.

**Constraints:** Work only in the isolated frontend. Owned files: AccountEntry.tsx, SecurityPanel.tsx, OidcPanel.tsx and existing matching tests; new IdentityAdmin.tsx, ConsentPanel.tsx, identity-resources.ts and matching tests. Shared auth.ts changes requested from main. No verification, commits, publication, deployment or backend edits; parent runs commands after all slices land.

## 1. Behavioral regressions first
- Extend AccountEntry tests for locale/referral registration, preserved MFA challenge flow, translated errors and locale changes without losing input.
- Extend SecurityPanel tests for actual server expiry/device labels, revoke-others preserving current authority and secret cleanup.
- Add consent tests covering GET metadata, explicit approve/deny POST, callback completion only after success, cross-origin redirect rejection, request/session transitions and localized errors.
- Add OWNER administration tests covering permission gating, current-version role updates, assignments and one-time OAuth secret clearing.

## 2. Existing account/security/OIDC screens
- Route every owned label, helper, action, status and error through identity-resources/useText/useI18n.
- Registration sends locale and optional referral_code; preserve email verification, reset and MFA flows.
- Sessions use backend current marker, browser/OS/device and expires_at; add POST revoke-others; abort and guard stale reads on identity changes, refresh only on visible focus/online.
- Preserve existing PKCE/JWKS consumer and single callback exchange. Never expose raw provider errors.

## 3. Identity administration
- Export IdentityAdmin({auth:AuthSession}). Gate controls by owner invariant plus authoritative permission list; backend remains final authority.
- Read persisted role/permission inventory and current user assignment versions. Update exact permission choices or staff bindings with expected_version/reason; explain existing Security reauthentication prerequisite.
- Create OAuth clients with exact redirect lists, allowed scopes and explicit public/trusted policy. Rotate/revoke against current versions and reasons; show returned secret once and clear explicitly or on actor/context transition.

## 4. Explicit OAuth consent
- Export ConsentPanel({requestId,onComplete?}). Read pending consent in current authenticated session; display client/scopes/expiry and explicit approve/deny actions.
- POST exact backend decision contract. Only accept same-origin authorize continuation; safe callback never substitutes for validation. No redirect on failure.
- Abort stale request metadata and never apply earlier request/session responses.

## Parent verification commands
- npm test -- src/AccountEntry.test.tsx src/SecurityPanel.test.tsx src/ConsentPanel.test.tsx src/IdentityAdmin.test.tsx src/oidc.test.ts
- npm run build
- npm run lint
- Real browser EN/RU, 390px/desktop, keyboard consent approve/deny, stale-session cancellation, fresh-MFA/password role/client mutation, secret hide and revoke-others.

Changelog belongs to main frontend agent. Slice completion report will name paths/interfaces/tests and unexecuted verification.
