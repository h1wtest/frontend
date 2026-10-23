export interface User {
  id: string;
  email: string;
  is_verified: boolean;
  mfa_enabled: boolean;
  mfa_verified?: boolean;
  roles: string[];
  permissions: string[];
}
export interface AuthSession {
  user: User;
  session_id: string;
  csrf_token: string;
  mfa_verified?: boolean;
}
export interface LoginResult {
  status: 'authenticated' | 'mfa_required';
  challenge_id?: string;
  user?: User;
  session_id?: string;
}
export interface Session {
  session_id: string;
  device_name?: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  last_active_at: string;
  is_current: boolean;
}
export interface Settings {
  email_login_alerts: boolean;
  email_security_alerts: boolean;
  telegram_login_alerts: boolean;
  telegram_security_alerts: boolean;
}
export interface Profile {
  profile: {
    user_id: string;
    email: string;
    display_name?: string;
    avatar_url?: string;
    phone_number?: string;
    telegram_id?: string;
  };
  notification_settings: Settings;
  capabilities: { telegram: boolean };
}
export interface MfaSetup {
  secret: string;
  otpauth_uri: string;
  recovery_codes: string[];
}
export interface AdminUser {
  id: string;
  email: string;
  is_verified: boolean;
  is_banned: boolean;
  ban_reason?: string;
  mfa_enabled: boolean;
  created_at: string;
  roles: string[];
}
export interface Audit {
  id: string;
  event_type: string;
  actor_id?: string;
  user_id?: string;
  created_at: string;
}
export interface Delivery {
  id: string;
  user_id: string;
  channel: string;
  status: string;
  attempts: number;
  next_attempt_at?: string;
  last_error?: string;
  created_at: string;
  delivered_at?: string;
}

export function safeReturnTo(value: string | null, origin: string): string | null {
  if (!value || value.includes('\\')) return null;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0 || code === 10 || code === 13) return null;
  }
  try {
    const url = new URL(value, origin);
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.pathname !== '/oauth/authorize' ||
      url.hash
    )
      return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}
export function canAdmin(
  user: Pick<User, 'permissions' | 'roles' | 'mfa_enabled'>,
  permission: string,
): boolean {
  return user.mfa_enabled && user.permissions.includes(permission);
}
