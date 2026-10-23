import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminPanel } from './AdminPanel';
import { I18nProvider } from './i18n';
import type { AuthSession } from './auth';
const session: AuthSession = {
  user: {
    id: 'user-1',
    email: 'admin@example.test',
    is_verified: true,
    roles: ['admin'],
    permissions: [],
    mfa_enabled: true,
    mfa_verified: true,
  },
  session_id: 'session-1',
  csrf_token: 'csrf',
  mfa_verified: true,
};
const markup = (auth: AuthSession) =>
  renderToStaticMarkup(
    <I18nProvider initialLocale="ru">
      <AdminPanel auth={auth} />
    </I18nProvider>,
  );
describe('administrative permission and MFA boundaries', () => {
  it('does not expose destructive controls just because the user has an admin role', () => {
    const html = markup(session);
    expect(html).toContain('Доступ запрещён');
    expect(html).not.toContain('Найти пользователей');
  });
  it('blocks a permission-bearing account without verified MFA', () => {
    const auth = {
      ...session,
      mfa_verified: false,
      user: { ...session.user, permissions: ['users:read', 'users:write'], mfa_verified: false },
    };
    const html = markup(auth);
    expect(html).toContain('свежее подтверждение личности');
    expect(html).not.toContain('Найти пользователей');
  });
  it('shows only the expressly authorized administrative read areas', () => {
    const html = markup({ ...session, user: { ...session.user, permissions: ['users:read'] } });
    expect(html).toContain('Найти пользователей');
    expect(html).not.toContain('Обновить аудит');
    expect(html).not.toContain('Опубликовать');
    expect(html).not.toContain('OAuth');
  });
  it('does not expose financial or role mutations to support permissions', () => {
    const html = markup({
      ...session,
      user: {
        ...session.user,
        roles: ['support'],
        permissions: [
          'users:read',
          'users:sessions:revoke',
          'subscriptions:read',
          'billing:read',
          'notifications:read',
        ],
      },
    });
    expect(html).not.toContain('Принять оплату');
    expect(html).not.toContain('Изменить права');
    expect(html).not.toContain('Изменить ставку');
  });
});
