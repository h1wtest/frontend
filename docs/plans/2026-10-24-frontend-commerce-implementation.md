# Frontend Commerce Implementation Plan

**Goal:** Implement the approved own-account catalog, paid subscription, checkout/history and partially available overview UI.

**Architecture:** `commerce.ts` owns exact public DTOs, decimal-string display, abortable visible queries and stable command-attempt identity. `CommercePanel.tsx` owns user purchase, payment recovery and subscription command/quote UI. `OverviewPanel.tsx` renders the profile-owned bounded overview without substituting unavailable dependencies. `commerce-resources.ts` contains EN/RU UI copy. Shared API/session/i18n/components/styles remain frontend owner files.

**Constraints:** Frontend directory only; React/TypeScript existing dependencies; no build/test/lint/format execution or git operations; no runtime mocks; CSRF/cookie/generation-secure default API; money never Number arithmetic; permission/ownership checked authoritatively by services; no hidden polling; no optimistic paid access.

## Task 1 — behavioral regressions before implementation
Create `src/commerce.test.ts`, `src/CommercePanel.test.tsx`, and `src/OverviewPanel.test.tsx`. Tests catch: decimal precision loss; command retry key rotation; catalog offering stale/nonpublished revisions; unverified purchase; accepted payment confused with fulfillment; foreign-owner response rendered; late account/session query responses rendered; quote amount/body substitution; partial overview failure fabricated as zero/empty. Use real React panels/API and controlled HTTP transport fixtures, not source assertions.

## Task 2 — exact owner DTOs and query/attempt behavior
Create `src/commerce.ts`: catalog/billing/subscription DTOs follow exact local inventories; checkout includes optional prepared `action_id` as confirmed by billing/subscription owners. Query refreshes on visible focus/online/manual interaction, aborts on cleanup, prevents stale responses. Stable idempotency key survives ambiguous failure for identical command body; a changed command is a distinct attempt. Format arbitrary exact decimal strings via BigInt integer grouping and localized separators without float conversion.

## Task 3 — customer commerce panels
Create localized resources and keyed own-session `CommercePanel({auth,section})`. Catalog lists only current published offers; checkout network is explicit. Orders have paginated history, own-ID recovery and authoritative detail refresh, safe address/amount/expiry/provider IDs, accepted-versus-fulfilled labels, independently-unpaid cancellation only. Subscriptions show current paid period/features/next offer/pending paid period, authoritative entitlement, cancel/resume, renewal of next scheduled/current offer via prepared action then checkout, server-generated upgrade quote then confirmed checkout, and scheduled downgrade. Mutations carry versions and stable keys; failures remain localized stable codes.

## Task 4 — profile-owned overview
Create `OverviewPanel({auth})`; GET `/api/v1/users/me/overview` only. Available account data is identity-me; collections are `{items,next_cursor}`; referral data is exact owner account. Render per-section unavailable independently, nullable data never fake empty. Show first bounded page with continuation note rather than claim total counts. Owner mismatch fails closed.

## Integration handoff
Frontend owner updates existing changelog and integrates named exports/navigation/shared style. Parent runs `npm test -- src/commerce.test.ts src/CommercePanel.test.tsx src/OverviewPanel.test.tsx`, then full tests/build/lint/format checks after every slice lands. This worker authors but does not execute verification.
