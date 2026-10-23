import { useEffect, useState } from 'react';
import { api as defaultApi, type ApiClient } from './api';
import type { AuthSession, MfaSetup, Session } from './auth';
import { ActionButton, ActionForm, Field, Time, value } from './components';

export function SecurityPanel({
  auth,
  reload,
  client = defaultApi,
}: {
  auth: AuthSession;
  reload: () => Promise<void>;
  client?: ApiClient;
}) {
  const api = client;
  const [sessions, setSessions] = useState<Session[]>();
  const [error, setError] = useState('');
  const [setup, setSetup] = useState<MfaSetup>();
  const [acknowledged, setAcknowledged] = useState(false);
  async function loadSessions() {
    setError('');
    try {
      setSessions(await api.request<Session[]>('/api/v1/auth/sessions'));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Ошибка загрузки сессий');
    }
  }
  useEffect(() => {
    void loadSessions();
  }, []);
  return (
    <section aria-labelledby="security-heading">
      <h2 id="security-heading">Безопасность</h2>
      <div className="grid">
        <section className="card">
          <ActionForm
            title="Повторное подтверждение личности"
            submit="Подтвердить личность"
            onSubmit={async (form) => {
              await api.request('/api/v1/auth/reauth', {
                method: 'POST',
                body: {
                  password: value(form, 'password'),
                  ...(value(form, 'code') ? { code: value(form, 'code') } : {}),
                },
              });
              await reload();
              return 'Личность подтверждена. Разрешены чувствительные действия в течение ограниченного времени.';
            }}
          >
            <p className="muted">
              Перед сменой пароля или MFA подтвердите текущий пароль
              {auth.user.mfa_enabled ? ' и текущий MFA' : ''}.
            </p>
            <Field
              label="Текущий пароль для подтверждения"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              maxLength={1024}
            />
            {auth.user.mfa_enabled && (
              <Field
                label="Текущий код MFA или резервный код"
                name="code"
                required
                autoComplete="one-time-code"
                maxLength={128}
              />
            )}
          </ActionForm>
        </section>
        <section className="card">
          <ActionForm
            title="Смена пароля"
            submit="Изменить пароль"
            onSubmit={async (form) => {
              await api.request('/api/v1/auth/password/change', {
                method: 'POST',
                body: {
                  current_password: value(form, 'current_password'),
                  password: value(form, 'password'),
                },
              });
              await reload();
              return 'Пароль изменён.';
            }}
          >
            <Field
              label="Текущий пароль"
              name="current_password"
              type="password"
              required
              autoComplete="current-password"
              maxLength={1024}
            />
            <Field
              label="Новый пароль"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
            />
          </ActionForm>
        </section>
        <section className="card">
          <h3>Двухфакторная аутентификация</h3>
          <p>
            MFA {auth.user.mfa_enabled ? 'включена' : 'не включена'}. Настройка не заменяет
            действующий фактор до подтверждения.
          </p>
          <ActionButton
            action={async () => {
              setSetup(
                await api.request<MfaSetup>('/api/v1/auth/mfa/setup', { method: 'POST', body: {} }),
              );
              setAcknowledged(false);
            }}
          >
            {auth.user.mfa_enabled ? 'Подготовить замену MFA' : 'Настроить MFA'}
          </ActionButton>
          {setup && (
            <div className="secret-panel">
              <p>Добавьте секрет в приложение-аутентификатор. Не передавайте его другим.</p>
              <code>{setup.secret}</code>
              <details>
                <summary>URI для приложения-аутентификатора</summary>
                <code>{setup.otpauth_uri}</code>
              </details>
              <h4>Одноразовые резервные коды</h4>
              <p>Сохраните их сейчас в надёжном месте: повторно они не отображаются.</p>
              <ul className="codes">
                {setup.recovery_codes.map((code) => (
                  <li key={code}>
                    <code>{code}</code>
                  </li>
                ))}
              </ul>
              <label className="check">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                Я сохранил резервные коды
              </label>
              {acknowledged && (
                <ActionForm
                  submit="Включить подготовленную MFA"
                  onSubmit={async (form) => {
                    await api.request('/api/v1/auth/mfa/enable', {
                      method: 'POST',
                      body: { code: value(form, 'code') },
                    });
                    setSetup(undefined);
                    await reload();
                  }}
                >
                  <Field
                    label="Код нового приложения MFA"
                    name="code"
                    required
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={8}
                  />
                </ActionForm>
              )}
              <button type="button" onClick={() => setSetup(undefined)}>
                Скрыть секреты
              </button>
            </div>
          )}
          {auth.user.mfa_enabled && (
            <ActionForm
              title="Отключение MFA"
              submit="Отключить MFA"
              danger
              onSubmit={async (form) => {
                await api.request('/api/v1/auth/mfa/disable', {
                  method: 'POST',
                  body: { code: value(form, 'code') },
                });
                setSetup(undefined);
                await reload();
              }}
            >
              <p className="muted">
                Требуется свежее подтверждение личности выше. Используйте новый код, а не уже
                использованный при подтверждении.
              </p>
              <Field
                label="Код MFA для отключения"
                name="code"
                required
                autoComplete="one-time-code"
                maxLength={128}
              />
            </ActionForm>
          )}
        </section>
        <section className="card">
          <h3>Активные сессии</h3>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <ActionButton action={loadSessions}>Обновить сессии</ActionButton>
          {!sessions && !error && <p role="status">Загрузка сессий…</p>}
          {sessions?.length === 0 && <p>Активных сессий нет.</p>}
          <ul className="records">
            {sessions?.map((session) => (
              <li key={session.session_id}>
                <strong>
                  {session.device_name || 'Неизвестное устройство'}{' '}
                  {session.is_current && <span className="badge">Текущая</span>}
                </strong>
                <span>{session.ip_address}</span>
                <span className="muted">{session.user_agent}</span>
                <span>
                  Создана: <Time value={session.created_at} />
                </span>
                <span>
                  Активность: <Time value={session.last_active_at} />
                </span>
                <ActionButton
                  danger
                  action={async () => {
                    await api.request(
                      '/api/v1/auth/sessions/' + encodeURIComponent(session.session_id),
                      { method: 'DELETE' },
                    );
                    await reload();
                    await loadSessions();
                  }}
                >
                  Отозвать сессию
                </ActionButton>
              </li>
            ))}
          </ul>
          <ActionForm
            submit="Отозвать все сессии, включая текущую"
            danger
            onSubmit={async () => {
              await api.request('/api/v1/auth/sessions', { method: 'DELETE' });
              await reload();
            }}
          >
            <label className="check">
              <input type="checkbox" required />
              Подтверждаю выход на всех устройствах
            </label>
          </ActionForm>
        </section>
      </div>
    </section>
  );
}
