import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminPanel } from './AdminPanel';
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
describe('administrative permission and MFA boundaries', () => {
  it('does not expose destructive controls just because the user has an admin role', () => {
    const html = renderToStaticMarkup(<AdminPanel auth={session} />);
    expect(html).toContain('Доступ запрещён');
    expect(html).not.toContain('Найти пользователей');
  });
  it('blocks a permission-bearing account without verified MFA', () => {
    const auth: AuthSession = {
      ...session,
      mfa_verified: false,
      user: { ...session.user, permissions: ['users:read', 'users:write'], mfa_verified: false },
    };
    const html = renderToStaticMarkup(<AdminPanel auth={auth} />);
    expect(html).toContain('свежее подтверждение личности');
    expect(html).not.toContain('Найти пользователей');
  });
  it('shows only the expressly authorized administrative read areas', () => {
    const auth: AuthSession = {
      ...session,
      user: { ...session.user, permissions: ['users:read'] },
    };
    const html = renderToStaticMarkup(<AdminPanel auth={auth} />);
    expect(html).toContain('Найти пользователей');
    expect(html).not.toContain('Обновить аудит');
    expect(html).not.toContain('Обновить доставки');
  });
});
