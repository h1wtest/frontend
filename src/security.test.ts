import { describe, expect, it } from 'vitest';
import { safeReturnTo, canAdmin } from './auth';

describe('authorization navigation', () => {
  it('never redirects a login to another origin or a script URL', () => {
    for (const value of [
      'https://evil.test/oauth/authorize',
      '//evil.test/x',
      'javascript:alert(1)',
      '/\\evil.test',
      '/oauth/authorize\n',
      '/oauth/authorize\t',
      '/oauth/authorize\f',
      '/oauth/authorize?state=unsafe\u007f',
      '/oauth/authorize?state=unsafe\u001f',
      '/oauth/authorize?state=unsafe\u0000',
      '%2f%2fevil.test',
      '/%2f%2fevil.test',
      'https://user:secret@sso.test/oauth/authorize',
      '/oauth/authorize#https://evil.test',
    ]) {
      expect(safeReturnTo(value, 'https://sso.test')).toBeNull();
    }
  });
  it('preserves the complete same-origin authorization query', () => {
    expect(
      safeReturnTo('/oauth/authorize?client_id=web-demo&state=a%2Bb', 'https://sso.test'),
    ).toBe('/oauth/authorize?client_id=web-demo&state=a%2Bb');
    expect(safeReturnTo('https://sso.test/oauth/authorize?state=abc', 'https://sso.test')).toBe(
      '/oauth/authorize?state=abc',
    );
  });
  it('requires the explicit permission rather than a role label', () => {
    expect(canAdmin({ roles: ['admin'], permissions: [], mfa_enabled: true }, 'users:read')).toBe(
      false,
    );
    expect(
      canAdmin({ roles: [], permissions: ['users:read'], mfa_enabled: true }, 'users:read'),
    ).toBe(true);
    expect(
      canAdmin({ roles: [], permissions: ['users:read'], mfa_enabled: false }, 'users:read'),
    ).toBe(false);
  });
});
