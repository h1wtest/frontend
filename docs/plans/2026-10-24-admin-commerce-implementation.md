# Administrative catalog and commerce implementation plan

**Goal:** Implement the approved real catalog/payment/subscription administration UI using exact owner APIs, with bilingual accessible forms and permission-gated safe SUPPORT reads.

**Architecture:** Two exported React components (`CatalogAdmin({auth})`, `CommerceAdmin({auth})`) consume the shared secure API client and i18n. Catalog owns draft editor state; commerce owns payment review and frozen compensation state. Money remains decimal text throughout. Backend remains authorization and concurrency authority.

**Constraints:** Only new `src/CatalogAdmin.tsx`, `src/CommerceAdmin.tsx`, `src/admin-commerce-resources.ts`, matching tests and this scoped plan. No dependencies, backend changes, verification, commits or deployment. Parent owns changelog and shared files. Approved design: platform-infra/docs/superpowers/specs/2026-10-24-generic-subscription-platform-design.md. Exact routes: local generic catalog/billing/subscription API inventories.

## Sequence

1. Author behavioral tests before production code. Catalog tests cover DRAFT editable / PUBLISHED immutable, localized offer editing with decimal preservation and CAS publishing. Commerce tests cover safe SUPPORT reads without evidence or financial controls, reason/version/idempotency payment decisions including explicit external evidence, rejection/retry/reverify branches, and frozen compensation recipient conflicts.
2. Add EN/RU resource dictionary for every visible label, status and safe unknown-state fallback. Errors route through shared stable-code localization; never render provider error text or arbitrary payload JSON.
3. Implement catalog collection read, product and plan creation, plan rank edit, clone/new draft, bilingual fields/features/offers, save/preview/publish/archive. Each mutation uses required expected_version and stable request idempotency. Published revisions have no edit controls. Product/plan identity mutation/deletion is limited to the authoritative API inventory; clarify missing CRUD routes with catalog owner instead of inventing endpoints.
4. Implement payment filtered cursor list/detail, allowlisted structured evidence and decision history only for authorized finance reviewers, explicit saved-evidence/manual settlement selection, reasoned reverify/accept/reject/retry commands. No transfer/refund calls.
5. Implement subscription filtered cursor list/detail, reasoned close, selected-recipient compensation preview, immutable frozen preview IDs/versions and explicit apply, durable compensation lookup, per-recipient terminal/conflict/ineligible results.
6. All collection/detail reads use AbortController and cancelled guards; visible focus/online/visibility events refresh without background polling. Session-keyed component state prevents account switching from retaining evidence or previews. Document consumer exports/tests and parent commands in local report; parent updates changelog.

## Important request examples

```ts
// Money is not parsed.
{ expected_version: revision.version, name: {en, ru}, description: {en, ru},
  features, offers: [{id, duration_days: 30, price: '12.345678', currency: 'USDT'}],
  idempotency_key: crypto.randomUUID() }
// Explicit external settlement, never a transfer.
{ expected_version: order.version, reason, idempotency_key,
  external_payment: { amount: '12.345678', network: 'USDTTRC20', reference } }
// Frozen compensation uses server-returned batch version; selection changes cannot rewrite recipients.
{ expected_version: compensation.version, reason, idempotency_key }
```

## Parent verification (not executed by this worker)

From frontend: `npm test -- src/CatalogAdmin.test.tsx src/CommerceAdmin.test.tsx`; then integration-owner full frontend tests/typecheck/build/lint and browser journeys in EN/RU at desktop and 390px, including forbidden/stale version/account switch/offline recovery. No passing claim until parent executes.
