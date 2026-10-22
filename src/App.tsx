import React, { useState, useEffect } from 'react';

interface UserProfile {
  user_id: string;
  email: string;
  display_name?: string | null;
  telegram_id?: string | null;
}

interface NotificationSettings {
  email_login_alerts: boolean;
  email_security_alerts: boolean;
  email_news_digests: boolean;
  telegram_login_alerts: boolean;
}

interface SessionItem {
  session_id: string;
  ip_address: string;
  user_agent: string;
  device_name?: string | null;
  is_current: boolean;
  last_active_at: string;
}

interface MfaSetupData {
  secret: string;
  qr_code_url: string;
  recovery_codes: string[];
}

interface SsoResult {
  code: string | null;
  codeVerifier: string;
  tokenResponse: Record<string, unknown>;
  decodedIdToken: Record<string, unknown> | null;
  userinfo: Record<string, unknown>;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'login' | 'register' | 'profile' | 'sso'>('login');
  const [token, setToken] = useState<string | null>(localStorage.getItem('access_token'));
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Login & Register Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaPendingToken, setMfaPendingToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  // Email Verification State
  const [pendingVerifyUserId, setPendingVerifyUserId] = useState<string | null>(null);
  const [pendingVerifyEmail, setPendingVerifyEmail] = useState<string>('');
  const [emailVerifyCode, setEmailVerifyCode] = useState<string>('');

  // Profile State
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [telegramId, setTelegramId] = useState('');

  // Sessions State
  const [sessions, setSessions] = useState<SessionItem[]>([]);

  // 2FA Setup State
  const [mfaSetup, setMfaSetup] = useState<MfaSetupData | null>(null);
  const [confirmTotpCode, setConfirmTotpCode] = useState('');

  // SSO Demo State
  const [ssoResult, setSsoResult] = useState<SsoResult | null>(null);

  useEffect(() => {
    if (token) {
      loadProfile();
      loadSessions();
      setActiveTab('profile');
    }
  }, [token]);

  const showMsg = (text: string, type: 'success' | 'error' = 'success') => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 6000);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка регистрации');
      
      setPendingVerifyUserId(data.user_id);
      setPendingVerifyEmail(data.email);
      showMsg('Код подтверждения отправлен на почту. Проверьте Mailpit (localhost:8025).');
    } catch (err: unknown) {
      showMsg(formatError(err), 'error');
    }
  };

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingVerifyUserId) return;
    try {
      const res = await fetch('/api/v1/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: pendingVerifyUserId,
          code: emailVerifyCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Неверный код подтверждения');
      
      showMsg('Почта успешно подтверждена! Теперь вы можете войти в аккаунт.');
      setPendingVerifyUserId(null);
      setEmailVerifyCode('');
      setActiveTab('login');
    } catch (err: unknown) {
      showMsg(formatError(err), 'error');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, device_name: 'React Web Client' }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'email_not_verified') {
          setPendingVerifyUserId(data.user_id);
          setPendingVerifyEmail(data.email);
          setActiveTab('register');
          throw new Error('Почта не подтверждена. Введите 6-значный код из письма.');
        }
        throw new Error(data.error || 'Ошибка входа');
      }

      if (data.status === 'mfa_required') {
        setMfaPendingToken(data.pre_auth_token);
        showMsg('В аккаунте включен 2FA. Введите 6-значный код или резервный ключ.');
        return;
      }

      setToken(data.tokens.access_token);
      localStorage.setItem('access_token', data.tokens.access_token);
      showMsg('Успешный вход!');
    } catch (err: unknown) {
      showMsg(formatError(err), 'error');
    }
  };

  const handleVerifyMfaLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaPendingToken) return;
    try {
      const res = await fetch('/api/v1/auth/mfa/verify-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pre_auth_token: mfaPendingToken,
          code: mfaCode,
          device_name: 'React Web Client',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Неверный код 2FA');

      setToken(data.tokens.access_token);
      localStorage.setItem('access_token', data.tokens.access_token);
      setMfaPendingToken(null);
      setMfaCode('');
      showMsg('2FA подтвержден. Вход выполнен!');
    } catch (err: unknown) {
      showMsg(formatError(err), 'error');
    }
  };

  const loadProfile = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/v1/users/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data.profile);
        setSettings(data.notification_settings);
        setDisplayName(data.profile.display_name || '');
        setTelegramId(data.profile.telegram_id || '');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadSessions = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/v1/auth/sessions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      const res = await fetch('/api/v1/users/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ display_name: displayName, telegram_id: telegramId }),
      });
      if (!res.ok) throw new Error('Не удалось обновить профиль');
      showMsg('Профиль успешно обновлен!');
      loadProfile();
    } catch (err: unknown) {
      showMsg(formatError(err), 'error');
    }
  };

  const handleToggleNotification = async (key: keyof NotificationSettings, value: boolean) => {
    if (!token || !settings) return;
    try {
      const updated = { ...settings, [key]: value };
      const res = await fetch('/api/v1/users/me/notifications', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ [key]: value }),
      });
      if (res.ok) {
        setSettings(updated);
        showMsg('Настройки уведомлений сохранены');
      }
    } catch (err: unknown) {
      showMsg(formatError(err), 'error');
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/v1/auth/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        showMsg('Сессия успешно завершена');
        loadSessions();
      }
    } catch (err: unknown) {
      showMsg(formatError(err), 'error');
    }
  };

  const handleRevokeAllSessions = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/v1/auth/sessions', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        showMsg('Все другие сессии завершены');
        loadSessions();
      }
    } catch (err: unknown) {
      showMsg(formatError(err), 'error');
    }
  };

  const handleStartMfaSetup = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/v1/auth/mfa/setup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка настройки 2FA');
      setMfaSetup(data);
    } catch (err: unknown) {
      showMsg(formatError(err), 'error');
    }
  };

  const handleConfirmMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      const res = await fetch('/api/v1/auth/mfa/enable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: confirmTotpCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Неверный код TOTP');
      showMsg('2FA успешно активирован!');
      setMfaSetup(null);
      setConfirmTotpCode('');
    } catch (err: unknown) {
      showMsg(formatError(err), 'error');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    setToken(null);
    setProfile(null);
    setSessions([]);
    setActiveTab('login');
    showMsg('Вы вышли из системы');
  };

  // Live PKCE OAuth 2.1 Demo Flow
  const handleRunSsoDemo = async () => {
    if (!token) {
      showMsg('Для демонстрации SSO сначала войдите в систему', 'error');
      return;
    }
    try {
      // 1. Generate PKCE verifier and challenge
      const randomBytes = new Uint8Array(32);
      window.crypto.getRandomValues(randomBytes);
      const codeVerifier = btoa(String.fromCharCode(...randomBytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const encoder = new TextEncoder();
      const data = encoder.encode(codeVerifier);
      const hash = await window.crypto.subtle.digest('SHA-256', data);
      const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      // 2. Call /oauth/authorize
      const authUrl = `/oauth/authorize?client_id=trade_helper_frontend&redirect_uri=http://localhost:3000/callback&response_type=code&scope=openid%20profile%20email&code_challenge=${codeChallenge}&code_challenge_method=S256&state=demo_state_999`;
      const authRes = await fetch(authUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const authData = await authRes.json();
      if (!authRes.ok) throw new Error(authData.error || 'Authorize failed');

      const redirectUrl = new URL(authData.redirect_url);
      const code = redirectUrl.searchParams.get('code');

      // 3. Exchange code for tokens at /oauth/token
      const tokenRes = await fetch('/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: 'trade_helper_frontend',
          redirect_uri: 'http://localhost:3000/callback',
          code,
          code_verifier: codeVerifier,
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenData.error || 'Token exchange failed');

      // Decode ID Token
      let decodedIdToken = null;
      if (tokenData.id_token) {
        decodedIdToken = JSON.parse(atob(tokenData.id_token.split('.')[1]));
      }

      // 4. Call /oauth/userinfo
      const userinfoRes = await fetch('/oauth/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userinfoData = await userinfoRes.json();

      setSsoResult({
        code,
        codeVerifier,
        tokenResponse: tokenData,
        decodedIdToken,
        userinfo: userinfoData,
      });

      showMsg('OAuth 2.1 / OIDC вход успешно выполнен!');
    } catch (err: unknown) {
      showMsg(formatError(err), 'error');
    }
  };

  return (
    <div className="container">
      <div className="header">
        <h1>Identity & SSO Platform</h1>
        <div>
          {token ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="badge badge-success">Авторизован</span>
              <button className="btn btn-danger" onClick={handleLogout}>
                Выйти
              </button>
            </div>
          ) : (
            <span className="badge">Гостевой режим</span>
          )}
        </div>
      </div>

      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      <div className="tabs">
        {!token && (
          <>
            <button
              className={`tab-btn ${activeTab === 'login' ? 'active' : ''}`}
              onClick={() => setActiveTab('login')}
            >
              Вход
            </button>
            <button
              className={`tab-btn ${activeTab === 'register' ? 'active' : ''}`}
              onClick={() => setActiveTab('register')}
            >
              Регистрация
            </button>
          </>
        )}
        {token && (
          <button
            className={`tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            Личный Кабинет
          </button>
        )}
        <button
          className={`tab-btn ${activeTab === 'sso' ? 'active' : ''}`}
          onClick={() => setActiveTab('sso')}
        >
          Демо SSO (OAuth 2.1)
        </button>
      </div>

      {/* ===================== TAB: LOGIN ===================== */}
      {activeTab === 'login' && !token && (
        <div className="card">
          <h2>Вход в систему</h2>
          {!mfaPendingToken ? (
            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  className="input"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alex@example.com"
                />
              </div>
              <div className="form-group">
                <label>Пароль</label>
                <input
                  type="password"
                  className="input"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <button type="submit" className="btn btn-primary">
                Войти
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyMfaLogin}>
              <div className="alert alert-success">
                Введите 6-значный код из Google Authenticator или 10-значный резервный код:
              </div>
              <div className="form-group">
                <label>Код подтверждения 2FA</label>
                <input
                  type="text"
                  className="input"
                  required
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  placeholder="123456 или ABCD1234EF"
                />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" className="btn btn-primary">
                  Подтвердить вход
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setMfaPendingToken(null)}
                >
                  Назад
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ===================== TAB: REGISTER ===================== */}
      {activeTab === 'register' && !token && (
        <div className="card">
          {!pendingVerifyUserId ? (
            <>
              <h2>Регистрация нового пользователя</h2>
              <form onSubmit={handleRegister}>
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    className="input"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="newuser@domain.com"
                  />
                </div>
                <div className="form-group">
                  <label>Пароль (минимум 8 символов)</label>
                  <input
                    type="password"
                    className="input"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                <button type="submit" className="btn btn-primary">
                  Зарегистрироваться
                </button>
              </form>
            </>
          ) : (
            <>
              <h2>Подтверждение электронной почты</h2>
              <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '16px' }}>
                Мы отправили 6-значный код на <strong style={{ color: 'var(--text)' }}>{pendingVerifyEmail}</strong>.
                Введите его ниже (или посмотрите во входящих на <code>localhost:8025</code>):
              </p>
              <form onSubmit={handleVerifyEmail}>
                <div className="form-group">
                  <label>Одноразовый код из письма (6 цифр)</label>
                  <input
                    type="text"
                    className="input"
                    required
                    maxLength={6}
                    value={emailVerifyCode}
                    onChange={(e) => setEmailVerifyCode(e.target.value)}
                    placeholder="123456"
                    style={{ fontSize: '20px', letterSpacing: '4px', textAlign: 'center', width: '220px' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" className="btn btn-primary">
                    Подтвердить почту
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setPendingVerifyUserId(null)}
                  >
                    Изменить email
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      )}

      {/* ===================== TAB: PROFILE & ЛК ===================== */}
      {activeTab === 'profile' && token && (
        <>
          <div className="card">
            <h2>Профиль пользователя</h2>
            <p style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '16px' }}>
              Email: <strong style={{ color: 'var(--text)' }}>{profile?.email}</strong> (ID: {profile?.user_id})
            </p>
            <form onSubmit={handleUpdateProfile} className="grid-2">
              <div className="form-group">
                <label>Отображаемое имя (Display Name)</label>
                <input
                  type="text"
                  className="input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Алексей Смирнов"
                />
              </div>
              <div className="form-group">
                <label>Telegram Username</label>
                <input
                  type="text"
                  className="input"
                  value={telegramId}
                  onChange={(e) => setTelegramId(e.target.value)}
                  placeholder="@telegram_handle"
                />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <button type="submit" className="btn btn-primary">
                  Сохранить профиль
                </button>
              </div>
            </form>
          </div>

          <div className="card">
            <h2>Настройки уведомлений</h2>
            {settings && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settings.email_login_alerts}
                    onChange={(e) => handleToggleNotification('email_login_alerts', e.target.checked)}
                  />
                  <span>Email-алерты о входе в аккаунт с новых устройств</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settings.email_security_alerts}
                    onChange={(e) => handleToggleNotification('email_security_alerts', e.target.checked)}
                  />
                  <span>Критические алерты безопасности на email</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settings.email_news_digests}
                    onChange={(e) => handleToggleNotification('email_news_digests', e.target.checked)}
                  />
                  <span>Email-рассылка новостей и дайджестов</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settings.telegram_login_alerts}
                    onChange={(e) => handleToggleNotification('telegram_login_alerts', e.target.checked)}
                  />
                  <span>Telegram-уведомления о входе</span>
                </label>
              </div>
            )}
          </div>

          <div className="card">
            <h2>Двухфакторная аутентификация (MFA / 2FA)</h2>
            {!mfaSetup ? (
              <div>
                <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '14px' }}>
                  Защитите свой аккаунт с помощью Google Authenticator или любого совместимого TOTP-приложения.
                </p>
                <button className="btn btn-success" onClick={handleStartMfaSetup}>
                  Подключить 2FA
                </button>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: '14px', marginBottom: '8px' }}>
                  1. Добавьте секретный ключ в Authenticator (или откройте URL в приложении):
                </p>
                <pre style={{ marginBottom: '12px' }}>{mfaSetup.secret}</pre>
                <p style={{ fontSize: '13px', color: 'var(--muted)' }}>
                  Ссылка URI: <code>{mfaSetup.qr_code_url}</code>
                </p>

                <p style={{ fontSize: '14px', marginTop: '16px', marginBottom: '8px' }}>
                  2. <strong>Сохраните эти 10 одноразовых кодов восстановления:</strong>
                </p>
                <div className="recovery-codes">
                  {mfaSetup.recovery_codes.map((code, idx) => (
                    <div key={idx} className="recovery-code-box">
                      {code}
                    </div>
                  ))}
                </div>

                <form onSubmit={handleConfirmMfa} style={{ marginTop: '16px' }}>
                  <div className="form-group">
                    <label>3. Введите 6 цифр из приложения для активации:</label>
                    <input
                      type="text"
                      className="input"
                      required
                      value={confirmTotpCode}
                      onChange={(e) => setConfirmTotpCode(e.target.value)}
                      placeholder="123456"
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="submit" className="btn btn-primary">
                      Активировать 2FA
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setMfaSetup(null)}
                    >
                      Отмена
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2>Активные сессии</h2>
              <button className="btn btn-danger" onClick={handleRevokeAllSessions}>
                Завершить все другие сессии
              </button>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Устройство</th>
                  <th>IP адрес</th>
                  <th>Статус</th>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.session_id}>
                    <td>{s.device_name || s.user_agent}</td>
                    <td>{s.ip_address}</td>
                    <td>
                      {s.is_current ? (
                        <span className="badge badge-success">Текущее</span>
                      ) : (
                        <span className="badge">Активна</span>
                      )}
                    </td>
                    <td>
                      {!s.is_current && (
                        <button
                          className="btn btn-danger"
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                          onClick={() => handleRevokeSession(s.session_id)}
                        >
                          Завершить
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ===================== TAB: SSO DEMO ===================== */}
      {activeTab === 'sso' && (
        <div className="card">
          <h2>Демо: Вход через Наш ID (OAuth 2.1 / OIDC Core)</h2>
          <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '16px' }}>
            Эта вкладка имитирует сторонний сайт, который нажал кнопку <strong>«Войти через Наш ID»</strong>.
            Происходит генерация PKCE challenge, вызов <code>/oauth/authorize</code>, получение кода и обмен на
            токены и OIDC <code>id_token</code>.
          </p>
          <button className="btn btn-primary" onClick={handleRunSsoDemo}>
            Запустить живой вход через SSO (PKCE Flow)
          </button>

          {ssoResult && (
            <div style={{ marginTop: '20px' }}>
              <h3 style={{ fontSize: '16px', marginBottom: '8px', color: 'var(--success)' }}>
                ✓ SSO авторизация завершена успешно!
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' }}>
                1. Одноразовый auth_code: <code>{ssoResult.code}</code>
              </p>
              <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '8px' }}>
                2. Проверенный PKCE code_verifier: <code>{ssoResult.codeVerifier}</code>
              </p>

              <h4 style={{ fontSize: '14px', marginTop: '12px', marginBottom: '4px' }}>
                Расшифрованный OIDC ID Token:
              </h4>
              <pre>{JSON.stringify(ssoResult.decodedIdToken, null, 2)}</pre>

              <h4 style={{ fontSize: '14px', marginTop: '12px', marginBottom: '4px' }}>
                Данные из эндпоинта /oauth/userinfo:
              </h4>
              <pre>{JSON.stringify(ssoResult.userinfo, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
