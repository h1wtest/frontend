import { useEffect, useState } from 'react';
import { api } from './api';
import type { Profile, Settings, Delivery } from './auth';
import { ActionButton, ActionForm, Field, Time, value } from './components';

export function ProfilePanel() {
  const [profile, setProfile] = useState<Profile>();
  const [history, setHistory] = useState<Delivery[]>([]);
  const [error, setError] = useState('');
  const [link, setLink] = useState<{ bot_url: string; expires_at: string }>();
  async function load() {
    setError('');
    try {
      setProfile(await api.request<Profile>('/api/v1/users/me'));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось загрузить профиль');
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!link) return;
    const refresh = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => window.clearInterval(refresh);
  }, [link]);
  useEffect(() => {
    if (profile?.profile.telegram_id) setLink(undefined);
  }, [profile]);
  return (
    <section aria-labelledby="profile-heading">
      <h2 id="profile-heading">Профиль и уведомления</h2>
      {error && (
        <p role="alert" className="error">
          {error} <ActionButton action={load}>Повторить загрузку</ActionButton>
        </p>
      )}
      {!profile && !error && <p role="status">Загрузка профиля…</p>}
      {profile && (
        <div className="grid">
          <section className="card">
            <ActionForm
              title="Профиль"
              submit="Сохранить профиль"
              onSubmit={async (form) => {
                setProfile(
                  await api.request<Profile>('/api/v1/users/me', {
                    method: 'PATCH',
                    body: {
                      display_name: value(form, 'display_name'),
                      avatar_url: value(form, 'avatar_url'),
                      phone_number: value(form, 'phone_number'),
                    },
                  }),
                );
              }}
            >
              <p>{profile.profile.email}</p>
              <Field
                label="Отображаемое имя"
                name="display_name"
                defaultValue={profile.profile.display_name ?? ''}
                maxLength={100}
                autoComplete="name"
              />
              <Field
                label="URL аватара"
                name="avatar_url"
                type="url"
                defaultValue={profile.profile.avatar_url ?? ''}
                maxLength={2048}
              />
              <Field
                label="Телефон"
                name="phone_number"
                type="tel"
                defaultValue={profile.profile.phone_number ?? ''}
                maxLength={32}
                autoComplete="tel"
              />
            </ActionForm>
          </section>
          <section className="card">
            <ActionForm
              title="Уведомления"
              submit="Сохранить уведомления"
              onSubmit={async (form) => {
                const body: Settings = {
                  email_login_alerts: form.has('email_login_alerts'),
                  email_security_alerts: form.has('email_security_alerts'),
                  telegram_login_alerts:
                    profile.capabilities.telegram && profile.profile.telegram_id
                      ? form.has('telegram_login_alerts')
                      : profile.notification_settings.telegram_login_alerts,
                  telegram_security_alerts:
                    profile.capabilities.telegram && profile.profile.telegram_id
                      ? form.has('telegram_security_alerts')
                      : profile.notification_settings.telegram_security_alerts,
                };
                setProfile(
                  await api.request<Profile>('/api/v1/users/me/notifications', {
                    method: 'PATCH',
                    body,
                  }),
                );
              }}
            >
              {(
                Object.entries({
                  email_login_alerts: 'Email: вход в аккаунт',
                  email_security_alerts: 'Email: безопасность',
                  telegram_login_alerts: 'Telegram: вход в аккаунт',
                  telegram_security_alerts: 'Telegram: безопасность',
                }) as [keyof Settings, string][]
              ).map(([key, label]) => (
                <label className="check" key={`${key}-${profile.notification_settings[key]}`}>
                  <input
                    type="checkbox"
                    name={key}
                    defaultChecked={profile.notification_settings[key]}
                    disabled={
                      key.startsWith('telegram') &&
                      (!profile.capabilities.telegram || !profile.profile.telegram_id)
                    }
                  />
                  {label}
                </label>
              ))}
              {!profile.profile.telegram_id && (
                <p className="muted">Для Telegram сначала подтвердите привязку через бота.</p>
              )}
            </ActionForm>
          </section>
          <section className="card">
            <h3>Telegram</h3>
            {!profile.capabilities.telegram ? (
              <p role="status">
                Канал недоступен: оператор не настроил Telegram Bot API. Имитация доставки не
                используется.
              </p>
            ) : profile.profile.telegram_id ? (
              <p className="success">Подтверждена привязка: {profile.profile.telegram_id}</p>
            ) : (
              <>
                <ActionButton
                  action={async () => {
                    const result = await api.request<{ bot_url: string; expires_at: string }>(
                      '/api/v1/users/me/telegram/link',
                      { method: 'POST', body: {} },
                    );
                    const url = new URL(result.bot_url);
                    if (
                      url.protocol !== 'https:' ||
                      url.hostname !== 't.me' ||
                      url.username ||
                      url.password
                    )
                      throw new Error('Недопустимая ссылка Telegram');
                    setLink(result);
                  }}
                >
                  Создать одноразовую привязку
                </ActionButton>
                {link && (
                  <p>
                    Откройте{' '}
                    <a href={link.bot_url} target="_blank" rel="noopener noreferrer">
                      бота Telegram
                    </a>{' '}
                    и нажмите Start. Срок: <Time value={link.expires_at} />. Статус обновляется
                    автоматически.
                  </p>
                )}
                <ActionButton action={load}>Проверить привязку</ActionButton>
              </>
            )}
          </section>
          <section className="card">
            <h3>История доставки</h3>
            <ActionButton
              action={async () => {
                setHistory(await api.request<Delivery[]>('/api/v1/notifications'));
              }}
            >
              Загрузить историю
            </ActionButton>
            {history.length === 0 ? (
              <p className="muted">Записей не загружено.</p>
            ) : (
              <ul className="records">
                {history.map((item) => (
                  <li key={item.id}>
                    <strong>
                      {item.channel}: {item.status}
                    </strong>
                    <span>Попытки: {item.attempts}</span>
                    <Time value={item.created_at} />
                    {item.last_error && <span className="error">{item.last_error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
