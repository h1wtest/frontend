import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { canAdmin, type AdminUser, type Audit, type AuthSession } from './auth';
import { ActionButton, ActionForm, Field, Time, value } from './components';
import { useText } from './i18n';
import { IdentityAdmin } from './IdentityAdmin';
import { CatalogAdmin } from './CatalogAdmin';
import { CommerceAdmin } from './CommerceAdmin';
import { ReferralAdmin } from './ReferralAdmin';
import { NotificationAdmin } from './NotificationAdmin';
import { QuarantinePanel } from './QuarantinePanel';
import type { TelegramResetRequest, TelegramResetResponse } from './generated/businessv1';
const messages = {
  title: { en: 'Administration', ru: 'Администрирование' },
  denied: {
    en: 'Permission denied: this account has no administrative permissions.',
    ru: 'Доступ запрещён: у аккаунта нет административных разрешений.',
  },
  mfa: {
    en: 'Enabled MFA and a fresh identity confirmation are required. Open Security and confirm your identity.',
    ru: 'Для административных действий требуется включённая MFA и свежее подтверждение личности. Откройте «Безопасность» и подтвердите личность.',
  },
  authority: {
    en: 'Every service checks your current session, permissions, resource scope and fresh MFA. The interface does not grant authority.',
    ru: 'Каждый сервис проверяет текущую сессию, права, область ресурса и свежую MFA. Интерфейс не предоставляет полномочий.',
  },
  users: { en: 'Users', ru: 'Пользователи' },
  search: { en: 'Find users', ru: 'Найти пользователей' },
  query: { en: 'Email or user ID', ru: 'Email или ID пользователя' },
  empty: { en: 'No records found.', ru: 'Записи не найдены.' },
  roles: { en: 'Roles', ru: 'Роли' },
  active: { en: 'Active', ru: 'Активен' },
  banned: { en: 'Banned', ru: 'Заблокирован' },
  ban: { en: 'Ban user', ru: 'Заблокировать пользователя' },
  unban: { en: 'Unban user', ru: 'Разблокировать пользователя' },
  reason: { en: 'Reason', ru: 'Причина' },
  revoke: { en: 'Revoke sessions', ru: 'Отозвать сессии' },
  telegramReset: { en: 'Reset Telegram binding', ru: 'Сбросить привязку Telegram' },
  telegramResetReason: { en: 'Reset reason', ru: 'Причина сброса' },
  telegramResetConfirm: {
    en: 'I verified the request to reset this user’s Telegram binding.',
    ru: 'Я проверил запрос на сброс привязки Telegram этого пользователя.',
  },
  telegramResetDone: {
    en: 'Telegram binding reset confirmed by the server.',
    ru: 'Сервер подтвердил сброс привязки Telegram.',
  },
  accepted: {
    en: 'Command accepted. The final result is shown below; unknown is not success.',
    ru: 'Команда принята. Итог показан ниже; неизвестный результат не означает успех.',
  },
  refreshCommand: { en: 'Check command result', ru: 'Проверить результат команды' },
  resumeCommand: { en: 'Resume command', ru: 'Возобновить команду' },
  requested: { en: 'Requested', ru: 'Запрошено' },
  succeeded: { en: 'Succeeded', ru: 'Выполнено' },
  unknown: {
    en: 'Result unknown; check before retrying',
    ru: 'Результат неизвестен; проверьте перед повтором',
  },
  commandDenied: { en: 'Denied', ru: 'Отклонено' },
  audit: { en: 'Audit', ru: 'Аудит' },
  loadAudit: { en: 'Refresh audit', ru: 'Обновить аудит' },
  more: { en: 'Load more', ru: 'Загрузить ещё' },
};
interface Command {
  command_id: string;
  status: 'requested' | 'succeeded' | 'denied' | 'unknown';
}
export function AdminPanel({ auth }: { auth: AuthSession }) {
  const text = useText(messages);
  const [users, setUsers] = useState<AdminUser[]>();
  const [audit, setAudit] = useState<Audit[]>();
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [command, setCommand] = useState<Command>();
  const [commandAuthority, setCommandAuthority] = useState<{ actor: string; permission: string }>();
  const allowed = (permission: string) => canAdmin(auth.user, permission);
  const verified = auth.mfa_verified ?? auth.user.mfa_verified ?? false;
  async function search(next = query) {
    const result = await api.request<AdminUser[]>(
      '/api/v1/admin/users?query=' + encodeURIComponent(next),
    );
    setUsers(result);
    setQuery(next);
  }
  async function userCommand(id: string, action: string, reason: string, idempotency_key: string) {
    const result = await api.request<Command>(
      '/api/v1/admin/users/' + encodeURIComponent(id) + '/' + action,
      { method: 'POST', body: { reason, idempotency_key } },
    );
    setCommand(result);
    setCommandAuthority({
      actor: auth.user.id,
      permission: action === 'revoke-sessions' ? 'users:sessions:revoke' : 'users:write',
    });
    if (result.status === 'succeeded') await search();
    return { message: text('accepted'), status: result.status };
  }
  if (
    !auth.user.permissions.some((permission) =>
      /^(users:|audit:|roles:|oauth:|catalog:|billing:|subscriptions:|referrals:|notifications:)/.test(
        permission,
      ),
    )
  )
    return (
      <section className="card">
        <h2>{text('title')}</h2>
        <p role="alert">{text('denied')}</p>
      </section>
    );
  if (!auth.user.mfa_enabled || !verified)
    return (
      <section className="card">
        <h2>{text('title')}</h2>
        <p role="alert">{text('mfa')}</p>
      </section>
    );
  return (
    <section>
      <h2>{text('title')}</h2>
      <p className="muted">{text('authority')}</p>
      <div className="grid">
        {allowed('users:read') && (
          <section className="card">
            <ActionForm
              title={text('users')}
              submit={text('search')}
              onSubmit={async (form) => {
                await search(value(form, 'query'));
              }}
            >
              <Field label={text('query')} name="query" type="search" maxLength={254} />
            </ActionForm>
            {users?.length === 0 && <p>{text('empty')}</p>}
            <ul className="records">
              {users?.map((user) => (
                <li key={user.id}>
                  <strong>{user.email}</strong>
                  <code>{user.id}</code>
                  <span>{text(user.is_banned ? 'banned' : 'active')}</span>
                  <span>
                    {text('roles')}:{' '}
                    {user.roles.map((role) => role.toUpperCase()).join(', ') || '—'}
                  </span>
                  <Time value={user.created_at} />
                  {allowed('users:write') && !user.roles.includes('owner') && (
                    <UserCommandForm
                      user={user}
                      action={user.is_banned ? 'unban' : 'ban'}
                      submit={text(user.is_banned ? 'unban' : 'ban')}
                      reason={text('reason')}
                      execute={userCommand}
                    />
                  )}
                  {allowed('users:sessions:revoke') &&
                    (auth.user.roles.includes('owner') ||
                      (auth.user.roles.includes('admin') && !user.roles.includes('owner')) ||
                      (auth.user.roles.includes('support') && user.roles.length === 0)) && (
                      <UserCommandForm
                        user={user}
                        action="revoke-sessions"
                        submit={text('revoke')}
                        reason={text('reason')}
                        execute={userCommand}
                      />
                    )}
                  {allowed('notifications:bindings:reset') && (
                    <TelegramResetForm
                      key={`${auth.session_id}:${auth.user.id}:${user.id}`}
                      userId={user.id}
                    />
                  )}
                </li>
              ))}
            </ul>
            {command && (
              <div role="status" className="notice">
                <code>{command.command_id}</code>
                <p>{text(command.status === 'denied' ? 'commandDenied' : command.status)}</p>
                {allowed('audit:read') && (
                  <ActionButton
                    action={async () => {
                      setCommand(
                        await api.request<Command>(
                          '/api/v1/admin/commands/' + encodeURIComponent(command.command_id),
                        ),
                      );
                    }}
                  >
                    {text('refreshCommand')}
                  </ActionButton>
                )}
                {(command.status === 'requested' || command.status === 'unknown') &&
                  commandAuthority?.actor === auth.user.id &&
                  allowed(commandAuthority.permission) && (
                    <ActionButton
                      action={async () => {
                        const result = await api.request<Command>(
                          '/api/v1/admin/commands/' +
                            encodeURIComponent(command.command_id) +
                            '/resume',
                          { method: 'POST', body: {} },
                        );
                        setCommand(result);
                        if (result.status === 'succeeded') await search();
                      }}
                    >
                      {text('resumeCommand')}
                    </ActionButton>
                  )}
              </div>
            )}
          </section>
        )}
        {allowed('audit:read') && (
          <section className="card">
            <h3>{text('audit')}</h3>
            <ActionButton
              action={async () => {
                const page = await api.request<{ items: Audit[]; next_cursor: string | null }>(
                  '/api/v1/admin/audit',
                );
                setAudit(page.items);
                setAuditCursor(page.next_cursor);
              }}
            >
              {text('loadAudit')}
            </ActionButton>
            {audit?.length === 0 && <p>{text('empty')}</p>}
            <ul className="records">
              {audit?.map((item) => (
                <li key={item.id}>
                  <strong>{item.event_type}</strong>
                  <code>{item.id}</code>
                  <span>{item.actor_id ?? '—'}</span>
                  <span>{item.user_id ?? '—'}</span>
                  <Time value={item.created_at} />
                </li>
              ))}
            </ul>
            {auditCursor && (
              <ActionButton
                action={async () => {
                  const page = await api.request<{ items: Audit[]; next_cursor: string | null }>(
                    '/api/v1/admin/audit?cursor=' + encodeURIComponent(auditCursor),
                  );
                  setAudit((previous) => [...(previous ?? []), ...page.items]);
                  setAuditCursor(page.next_cursor);
                }}
              >
                {text('more')}
              </ActionButton>
            )}
          </section>
        )}
      </div>
      {(allowed('roles:read') || allowed('roles:assign') || allowed('oauth:clients:write')) && (
        <IdentityAdmin auth={auth} />
      )}
      {allowed('catalog:read') && <CatalogAdmin auth={auth} />}
      {(allowed('billing:read') ||
        allowed('billing:status:read') ||
        allowed('subscriptions:read')) && <CommerceAdmin auth={auth} />}
      {allowed('referrals:read') && <ReferralAdmin auth={auth} />}
      {allowed('notifications:read') && <NotificationAdmin auth={auth} />}
      {allowed('notifications:read') && <QuarantinePanel auth={auth} />}
    </section>
  );
}
function UserCommandForm({
  user,
  action,
  submit,
  reason,
  execute,
}: {
  user: AdminUser;
  action: string;
  submit: string;
  reason: string;
  execute: (
    id: string,
    action: string,
    reason: string,
    key: string,
  ) => Promise<{ message: string; status: Command['status'] }>;
}) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return (
    <ActionForm
      submit={submit}
      danger={action !== 'unban'}
      onSubmit={async (form) => {
        const result = await execute(user.id, action, value(form, 'reason'), key);
        if (result.status === 'succeeded' || result.status === 'denied')
          setKey(crypto.randomUUID());
        return result.message;
      }}
    >
      <Field label={reason} name="reason" required minLength={3} maxLength={500} />
    </ActionForm>
  );
}

function TelegramResetForm({ userId }: { userId: string }) {
  const text = useText(messages);
  const active = useRef(true);
  const request = useRef<AbortController>();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  return (
    <ActionForm
      title={text('telegramReset')}
      submit={text('telegramReset')}
      danger
      onSubmit={async (form) => {
        const controller = new AbortController();
        request.current = controller;
        const body: TelegramResetRequest = { reason: value(form, 'reason') };
        const result = await api.request<TelegramResetResponse>(
          '/api/v1/admin/users/' + encodeURIComponent(userId) + '/telegram/reset',
          { method: 'POST', body, signal: controller.signal },
        );
        if (!active.current || controller.signal.aborted) return;
        if (result.status !== 'reset') throw new Error('invalid_reset_response');
        return text('telegramResetDone');
      }}
    >
      <Field
        label={text('telegramResetReason')}
        name="reason"
        required
        minLength={1}
        maxLength={500}
      />
      <label className="check">
        <input type="checkbox" required />
        {text('telegramResetConfirm')}
      </label>
    </ActionForm>
  );
}
