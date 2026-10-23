# Account, referrals and notifications frontend implementation plan

**Goal:** Deliver approved EN/RU account settings, two-sided Telegram binding, safe notification operations and manual referral payout workflows using real owner APIs.

**Architecture:** Four named React components consume the existing cookie/CSRF/generation-safe client and shared localized forms. `account-resources.ts` owns this slice's bilingual labels. Public money remains six-place decimal text; permissions only shape controls, never replace backend authorization.

**Constraints:** Edit only ProfilePanel.tsx, ReferralPanel.tsx, ReferralAdmin.tsx, NotificationAdmin.tsx, account-resources.ts and matching tests. Main frontend owner integrates navigation, i18n, transport PUT and changelog. No dependencies, commits, publication, transfers or verification commands. Existing approved design is authoritative. Tests are authored first; integration owner executes them after all slices land.

## 1. Behavioral regressions first

Create ProfilePanel.test.tsx exercising a private-chat candidate remaining unlinked until website confirmation, unlink remaining linked until bot confirmation, separate website/notification locales and preservation of unsaved form values across language changes. Create ReferralPanel.test.tsx exercising full-available-balance reservation using exact decimal strings, network/address-only request and pending cancellation with expected version. Create ReferralAdmin.test.tsx exercising support read-only controls, reason-required rate changes and immutable paid decisions with external reference/date. Create NotificationAdmin.test.tsx exercising read-only admission, atomic EN/RU template publication and failed-only reason-required replay. Use existing Vitest/jsdom/Testing Library with HTTP boundary fixtures and the real ApiClient.

## 2. Account/settings

Replace obsolete Telegram-ID implicit linking and timer polling in ProfilePanel. Consume GET/PATCH /api/v1/users/me, PATCH /notifications, GET /overview, POST /telegram/link, GET /telegram, POST /telegram/confirm and /unlink. Preserve draft fields independently of server refresh; website locale changes persist independently of notification locale. ProfilePanel({onLocale?}) remains callable without props. Use AbortController/cancelled guards for unmounted reads and visible focus/online/manual status refresh. Notification history renders only safe IDs/channel/status/attempt/timestamps, not provider last_error.

## 3. Own referrals

Implement ReferralPanel() against GET /api/v1/referrals and paginated /payouts. Show own code/link, earned/reserved/paid/available/debt and basis-point rate without money arithmetic. POST payout sends network/address/idempotency_key; cancellation sends expected_version/idempotency_key. Explicitly state payouts are manual and no funds are transferred by this UI.

## 4. Referral administration

Implement ReferralAdmin({auth}) with referrals:read admission, referrals:rates:write rate controls and referrals:payouts:decide decisions. Consume global rate, paginated partners/payouts and historical-rate owner API. Rates use bounded integer bps and expected versions, nullable override restores global. Decisions require reason; PAID additionally requires external reference and UTC paid_at. Display immutable final decisions and never expose a transfer action.

## 5. Notification administration

Implement NotificationAdmin({auth}) admitted by notifications:read. Render safe delivery metadata with failed-only replay gated by notifications:replay and required reason. Edit both EN/RU template locales and atomically publish with expected_version via PUT, gated by notifications:templates:write. Keep unsaved template forms during website language switches.

## Integration handoff

Exports: ProfilePanel({onLocale?: (locale: 'en'|'ru') => void}), ReferralPanel(), ReferralAdmin({auth: AuthSession}), NotificationAdmin({auth: AuthSession}). All use default api and shared useText/useI18n. Record changed paths, exact consumer dependencies and authored regressions in local://generic-frontend-account-referral-report.md. Main owner runs `npm test -- src/ProfilePanel.test.tsx src/ReferralPanel.test.tsx src/ReferralAdmin.test.tsx src/NotificationAdmin.test.tsx`, then integrated build/lint/format checks. No checks are executed in this slice.
