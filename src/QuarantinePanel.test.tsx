// SPDX-License-Identifier: MIT
import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuarantinePanel } from './QuarantinePanel';
import { I18nProvider } from './i18n';
import type { AuthSession } from './auth';
it('offers metadata loading but no replay controls without explicit replay permission', () => {
  const auth: AuthSession = {
    user: {
      id: 'support',
      email: 'support@example.test',
      roles: ['support'],
      permissions: ['notifications:read'],
      mfa_enabled: true,
      is_verified: true,
    },
    session_id: 's',
    csrf_token: 'csrf',
    mfa_verified: true,
  };
  const html = renderToStaticMarkup(
    <I18nProvider initialLocale="en">
      <QuarantinePanel auth={auth} />
    </I18nProvider>,
  );
  expect(html).toContain('Refresh quarantine');
  expect(html).not.toContain('Replay event');
  expect(html).not.toContain('corrected_event');
});
