import { useState } from 'react';
import { api } from './api';
import { canAdmin, type AdminUser, type Audit, type AuthSession, type Delivery } from './auth';
import { ActionButton, ActionForm, Field, Time, value } from './components';

interface Quarantine {
  id: string;
  owner: 'notification' | 'profile' | 'audit';
  topic: string;
  partition: number;
  offset: number;
  reason: string;
  created_at: string;
  replayed_at: string | null;
}
export function AdminPanel({ auth }: { auth: AuthSession }) {
  const [users, setUsers] = useState<AdminUser[]>();
  const [audit, setAudit] = useState<Audit[]>();
  const [deliveries, setDeliveries] = useState<Delivery[]>();
  const [quarantine, setQuarantine] = useState<Quarantine[]>();
  const [query, setQuery] = useState('');
  const allowed = (permission: string) => canAdmin(auth.user, permission);
  const verified = auth.mfa_verified ?? auth.user.mfa_verified ?? false;
  async function search(next = query) {
    const result = await api.request<AdminUser[]>(
      '/api/v1/admin/users?query=' + encodeURIComponent(next),
    );
    setUsers(result);
    setQuery(next);
  }
  async function loadQuarantine() {
    const records = await Promise.all(
      ['notification', 'profile', 'audit'].map((owner) =>
        api.request<Quarantine[]>('/api/v1/admin/quarantine?owner=' + owner),
      ),
    );
    setQuarantine(records.flat());
  }
  if (
    !auth.user.permissions.some((permission) =>
      ['users:read', 'audit:read', 'deliveries:read'].includes(permission),
    )
  )
    return (
      <section className="card">
        <h2>Администрирование</h2>
        <p role="alert">Доступ запрещён: у аккаунта нет административных разрешений.</p>
      </section>
    );
  if (!auth.user.mfa_enabled || !verified)
    return (
      <section className="card">
        <h2>Администрирование</h2>
        <p role="alert">
          Для административных действий требуется включённая MFA и свежее подтверждение личности.
          Откройте «Безопасность», настройте MFA и выполните повторное подтверждение.
        </p>
      </section>
    );
  return (
    <section>
      <h2>Администрирование</h2>
      <p className="muted">
        Каждый запрос дополнительно проверяет действующую сессию, полномочия и MFA на сервере.
      </p>
      <div className="grid">
        {allowed('users:read') && (
          <section className="card">
            <ActionForm
              title="Пользователи"
              submit="Найти пользователей"
              onSubmit={async (form) => {
                await search(value(form, 'query'));
                return 'Поиск завершён.';
              }}
            >
              <Field label="Поиск по email или ID" name="query" type="search" maxLength={254} />
            </ActionForm>
            {users?.length === 0 && <p>Пользователи не найдены.</p>}
            <ul className="records">
              {users?.map((user) => (
                <li key={user.id}>
                  <strong>{user.email}</strong>
                  <code>{user.id}</code>
                  <span>
                    {user.is_banned ? 'Заблокирован' : 'Активен'} · Email{' '}
                    {user.is_verified ? 'подтверждён' : 'не подтверждён'} · MFA{' '}
                    {user.mfa_enabled ? 'включена' : 'выключена'}
                  </span>
                  <span>Роли: {user.roles.join(', ') || '—'}</span>
                  <Time value={user.created_at} />
                  {user.ban_reason && <p>{user.ban_reason}</p>}
                  {allowed('users:write') &&
                    (user.is_banned ? (
                      <ActionButton
                        action={async () => {
                          await api.request(
                            '/api/v1/admin/users/' + encodeURIComponent(user.id) + '/unban',
                            { method: 'POST', body: {} },
                          );
                          await search();
                        }}
                      >
                        Разблокировать
                      </ActionButton>
                    ) : (
                      <ActionForm
                        submit="Заблокировать пользователя"
                        danger
                        onSubmit={async (form) => {
                          await api.request(
                            '/api/v1/admin/users/' + encodeURIComponent(user.id) + '/ban',
                            { method: 'POST', body: { reason: value(form, 'reason') } },
                          );
                          await search();
                        }}
                      >
                        <Field
                          label={`Причина блокировки ${user.email}`}
                          name="reason"
                          required
                          maxLength={500}
                        />
                        <label className="check">
                          <input type="checkbox" required />
                          Подтверждаю блокировку и отзыв сессий
                        </label>
                      </ActionForm>
                    ))}
                </li>
              ))}
            </ul>
          </section>
        )}
        {allowed('audit:read') && (
          <section className="card">
            <h3>Аудит</h3>
            <ActionButton
              action={async () => setAudit(await api.request<Audit[]>('/api/v1/admin/audit'))}
            >
              Обновить аудит
            </ActionButton>
            {audit?.length === 0 && <p>Записей нет.</p>}
            <ul className="records">
              {audit?.map((item) => (
                <li key={item.id}>
                  <strong>{item.event_type}</strong>
                  <code>{item.id}</code>
                  <span>Инициатор: {item.actor_id ?? 'Система'}</span>
                  <span>Пользователь: {item.user_id ?? '—'}</span>
                  <Time value={item.created_at} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {allowed('deliveries:read') && (
          <section className="card">
            <h3>Доставка уведомлений</h3>
            <ActionButton
              action={async () =>
                setDeliveries(await api.request<Delivery[]>('/api/v1/admin/deliveries'))
              }
            >
              Обновить доставки
            </ActionButton>
            {deliveries?.length === 0 && <p>Доставок нет.</p>}
            <ul className="records">
              {deliveries?.map((item) => (
                <li key={item.id}>
                  <strong>
                    {item.channel}: {item.status}
                  </strong>
                  <code>{item.id}</code>
                  <span>Пользователь: {item.user_id}</span>
                  <span>Попыток: {item.attempts}</span>
                  <span>
                    Создано: <Time value={item.created_at} />
                  </span>
                  <span>
                    Следующая попытка: <Time value={item.next_attempt_at} />
                  </span>
                  {item.last_error && <p className="error">{item.last_error}</p>}
                  {allowed('deliveries:replay') && item.status === 'failed' && (
                    <ActionForm
                      submit="Повторить доставку"
                      onSubmit={async () => {
                        await api.request(
                          '/api/v1/admin/deliveries/' + encodeURIComponent(item.id) + '/replay',
                          { method: 'POST', body: {} },
                        );
                        setDeliveries(await api.request<Delivery[]>('/api/v1/admin/deliveries'));
                      }}
                    >
                      <label className="check">
                        <input type="checkbox" required />
                        Подтверждаю повторную отправку
                      </label>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {allowed('deliveries:read') && (
          <section className="card">
            <h3>Карантин событий</h3>
            <p className="muted">
              Отображаются только метаданные, без исходного payload. Повтор возможен после
              устранения причины; некорректные события останутся в карантине.
            </p>
            <ActionButton action={loadQuarantine}>Обновить карантин</ActionButton>
            {quarantine?.length === 0 && <p>Карантин пуст.</p>}
            <ul className="records">
              {quarantine?.map((item) => (
                <li key={`${item.owner}-${item.id}`}>
                  <strong>
                    {item.owner}: {item.topic}
                  </strong>
                  <code>{item.id}</code>
                  <span>
                    Partition: {item.partition}; offset: {item.offset}
                  </span>
                  <p>{item.reason}</p>
                  <Time value={item.created_at} />
                  {item.replayed_at ? (
                    <span>
                      Повторено: <Time value={item.replayed_at} />
                    </span>
                  ) : (
                    allowed('deliveries:replay') && (
                      <ActionForm
                        submit="Повторить событие из карантина"
                        onSubmit={async () => {
                          await api.request(
                            '/api/v1/admin/quarantine/' +
                              encodeURIComponent(item.id) +
                              '/replay?owner=' +
                              encodeURIComponent(item.owner),
                            { method: 'POST', body: {} },
                          );
                          await loadQuarantine();
                        }}
                      >
                        <label className="check">
                          <input type="checkbox" required />
                          Причина устранена; подтверждаю повтор
                        </label>
                      </ActionForm>
                    )
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
}
