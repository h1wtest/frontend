// SPDX-License-Identifier: MIT
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { canAdmin, type AuthSession } from './auth';
import { ActionButton, ActionForm, Field, Time, value } from './components';
import { useI18n, useText } from './i18n';
import { identityMessages } from './identity-resources';

type Role = { slug: string; name: string; version: number; permissions: string[] };
type RoleInventory = { roles: Role[]; permissions: string[] };
type OAuthClient = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  allowed_scopes: string[];
  is_public: boolean;
  trusted_first_party: boolean;
  revoked_at: string | null;
};
type Secret = { client_id: string; client_secret: string };
const ownerOnly: Record<string, true> = {
  'roles:read': true,
  'roles:write': true,
  'roles:assign': true,
  'oauth:clients:write': true,
};
const scopes = ['openid', 'email', 'profile', 'offline_access'] as const;

export function IdentityAdmin({ auth }: { auth: AuthSession }) {
  return <IdentityOwner key={auth.user.id + ':' + auth.session_id} auth={auth} />;
}
function IdentityOwner({ auth }: { auth: AuthSession }) {
  const t = useText(identityMessages);
  const owner = auth.user.roles.includes('owner');
  const allowed = (permission: string) => owner && canAdmin(auth.user, permission);
  if (
    !owner ||
    !auth.user.mfa_enabled ||
    !['roles:read', 'roles:write', 'roles:assign', 'oauth:clients:write'].some(allowed)
  )
    return (
      <section className="card">
        <h2>{t('identityAdmin')}</h2>
        <p role="alert">{t('denied')}</p>
      </section>
    );
  return (
    <section aria-labelledby="identity-admin-heading">
      <h2 id="identity-admin-heading">{t('identityAdmin')}</h2>
      <p className="muted">{t('adminHint')}</p>
      <div className="grid">
        {allowed('roles:read') && <RoleManagement writable={allowed('roles:write')} />}
        {allowed('roles:read') && allowed('roles:assign') && <StaffAssignment />}
        {allowed('oauth:clients:write') && <ClientManagement />}
      </div>
    </section>
  );
}
function RoleManagement({ writable }: { writable: boolean }) {
  const t = useText(identityMessages);
  const { error: describeError } = useI18n();
  const [inventory, setInventory] = useState<RoleInventory>();
  const [error, setError] = useState<unknown>();
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setError(undefined);
    try {
      const result = await api.request<RoleInventory>('/api/v1/admin/roles', {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setInventory(result);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure);
    }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      request.current?.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [load]);
  return (
    <section className="card">
      <h3>{t('roles')}</h3>
      <ActionButton action={load}>{t('refresh')}</ActionButton>
      {error !== undefined && <p role="alert">{describeError(error)}</p>}
      {!inventory && error === undefined && <p role="status">{t('loading')}</p>}
      {inventory?.roles.map((role) => (
        <RoleEditor
          key={role.slug + ':' + role.version}
          role={role}
          choices={inventory.permissions}
          writable={writable}
          updated={load}
        />
      ))}
    </section>
  );
}
function RoleEditor({
  role,
  choices,
  writable,
  updated,
}: {
  role: Role;
  choices: string[];
  writable: boolean;
  updated: () => Promise<void>;
}) {
  const t = useText(identityMessages);
  const immutable = role.slug === 'owner';
  return (
    <fieldset aria-label={role.slug.toUpperCase()} disabled={immutable || !writable}>
      <legend>{role.slug.toUpperCase()}</legend>
      <p>
        {t('version')}: {role.version}
      </p>
      {immutable && <p>{t('ownerImmutable')}</p>}
      <ActionForm
        submit={t('savePermissions')}
        onSubmit={async (form) => {
          await api.request(
            '/api/v1/admin/roles/' + encodeURIComponent(role.slug) + '/permissions',
            {
              method: 'PUT',
              body: {
                permissions: form.getAll('permission').map(String),
                expected_version: role.version,
                reason: value(form, 'reason').trim(),
              },
            },
          );
          await updated();
        }}
      >
        <fieldset disabled={immutable || !writable}>
          <legend>{t('permissions')}</legend>
          {choices.map((permission) => (
            <label className="check" key={permission}>
              <input
                type="checkbox"
                name="permission"
                value={permission}
                defaultChecked={role.permissions.includes(permission)}
                disabled={!immutable && !!ownerOnly[permission]}
              />
              <code>{permission}</code>
              {!immutable && ownerOnly[permission] && (
                <span className="muted">{t('ownerPermission')}</span>
              )}
            </label>
          ))}
          {!immutable && <Field label={t('reason')} name="reason" required maxLength={500} />}
        </fieldset>
      </ActionForm>
    </fieldset>
  );
}
function StaffAssignment() {
  const t = useText(identityMessages);
  const [assignment, setAssignment] = useState<{
    user_id: string;
    roles: string[];
    role_version: number;
  }>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  return (
    <section className="card">
      <h3>{t('assignments')}</h3>
      <ActionForm
        submit={t('loadAssignment')}
        onSubmit={async (form) => {
          controller.current?.abort();
          const request = new AbortController();
          controller.current = request;
          setAssignment(undefined);
          const result = await api.request<{
            user_id: string;
            roles: string[];
            role_version: number;
          }>(
            '/api/v1/admin/users/' + encodeURIComponent(value(form, 'user_id').trim()) + '/roles',
            { signal: request.signal },
          );
          if (!request.signal.aborted) setAssignment(result);
        }}
      >
        <Field label={t('targetUser')} name="user_id" required autoComplete="off" />
      </ActionForm>
      {assignment && (
        <fieldset
          key={assignment.user_id + ':' + assignment.role_version}
          aria-label={t('assignments')}
        >
          <legend>{t('assignments')}</legend>
          <code>{assignment.user_id}</code>
          <p>
            {t('version')}: {assignment.role_version}
          </p>
          <p>{t('ordinaryHint')}</p>
          <ActionForm
            submit={t('saveAssignment')}
            onSubmit={async (form) => {
              const result = await api.request<{
                user_id: string;
                roles: string[];
                role_version: number;
              }>('/api/v1/admin/users/' + encodeURIComponent(assignment.user_id) + '/roles', {
                method: 'PUT',
                body: {
                  roles: form.getAll('role').map(String),
                  expected_version: assignment.role_version,
                  reason: value(form, 'reason').trim(),
                },
              });
              setAssignment(result);
            }}
          >
            {['owner', 'admin', 'support'].map((role) => (
              <label className="check" key={role}>
                <input
                  type="checkbox"
                  name="role"
                  value={role}
                  defaultChecked={assignment.roles.includes(role)}
                />
                {role.toUpperCase()}
              </label>
            ))}
            <Field label={t('reason')} name="reason" required maxLength={500} />
          </ActionForm>
        </fieldset>
      )}
    </section>
  );
}
function ClientManagement() {
  const t = useText(identityMessages);
  const { error: describeError } = useI18n();
  const [clients, setClients] = useState<OAuthClient[]>();
  const [secret, setSecret] = useState<Secret>();
  const [error, setError] = useState<unknown>();
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setError(undefined);
    try {
      const result = await api.request<{ items: OAuthClient[] }>('/api/v1/admin/oauth/clients', {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setClients(result.items);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const clear = () => {
      mounted.current = false;
      request.current?.abort();
      setSecret(undefined);
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('session-expired', clear);
    return () => {
      mounted.current = false;
      request.current?.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('session-expired', clear);
    };
  }, [load]);
  return (
    <section className="card">
      <h3>{t('clients')}</h3>
      <ActionButton action={load}>{t('refresh')}</ActionButton>
      {error !== undefined && <p role="alert">{describeError(error)}</p>}
      {!clients && error === undefined && <p role="status">{t('loading')}</p>}
      {clients?.length === 0 && <p>{t('noClients')}</p>}
      {secret && (
        <div className="secret-panel">
          <h4>{t('oneTimeSecret')}</h4>
          <p>{t('secretOnce')}</p>
          <code>{secret.client_id}</code>
          <code>{secret.client_secret}</code>
          <button type="button" onClick={() => setSecret(undefined)}>
            {t('hideSecrets')}
          </button>
        </div>
      )}
      <ActionForm
        title={t('createClient')}
        submit={t('createClient')}
        onSubmit={async (form) => {
          setSecret(undefined);
          const redirects = value(form, 'redirect_uris')
            .split(/\r?\n/)
            .map((uri) => uri.trim())
            .filter(Boolean);
          if (
            !redirects.length ||
            redirects.some((uri) => {
              try {
                const parsed = new URL(uri);
                return (
                  parsed.protocol !== 'https:' ||
                  !!parsed.username ||
                  !!parsed.password ||
                  !!parsed.hash ||
                  uri.includes('*') ||
                  /[\s\\]/.test(uri)
                );
              } catch {
                return true;
              }
            })
          )
            throw new ApiError('', 400, 'invalid_redirect_uri');
          const result = await api.request<OAuthClient & { client_secret: string | null }>(
            '/api/v1/admin/oauth/clients',
            {
              method: 'POST',
              body: {
                client_name: value(form, 'client_name').trim(),
                redirect_uris: redirects,
                allowed_scopes: form.getAll('scope').map(String),
                is_public: form.has('is_public'),
                trusted_first_party: form.has('trusted_first_party'),
                reason: value(form, 'reason').trim(),
              },
            },
          );
          if (!mounted.current) return;
          if (result.client_secret)
            setSecret({ client_id: result.client_id, client_secret: result.client_secret });
          await load();
        }}
      >
        <Field label={t('clientName')} name="client_name" required maxLength={200} />
        <label className="field">
          <span>{t('redirects')}</span>
          <textarea name="redirect_uris" required rows={3} />
        </label>
        <fieldset>
          <legend>{t('scopes')}</legend>
          {scopes.map((scope) => (
            <label className="check" key={scope}>
              <input
                type="checkbox"
                name="scope"
                value={scope}
                defaultChecked={scope === 'openid'}
              />
              <code>{scope}</code>
            </label>
          ))}
        </fieldset>
        <label className="check">
          <input type="checkbox" name="is_public" />
          {t('publicClient')}
        </label>
        <label className="check">
          <input type="checkbox" name="trusted_first_party" />
          {t('trustedClient')}
        </label>
        <Field label={t('reason')} name="reason" required maxLength={500} />
      </ActionForm>
      <ul className="records">
        {clients?.map((client) => (
          <li key={client.client_id}>
            <strong>{client.client_name}</strong>
            <code>{client.client_id}</code>
            <ul>
              {client.redirect_uris.map((uri) => (
                <li key={uri}>
                  <code>{uri}</code>
                </li>
              ))}
            </ul>
            <p>
              {t('scopes')}: {client.allowed_scopes.join(', ')}
            </p>
            {client.is_public && <span>{t('publicClient')}</span>}
            {client.trusted_first_party && <span>{t('trustedClient')}</span>}
            {client.revoked_at ? (
              <p>
                {t('revoked')}: <Time value={client.revoked_at} />
              </p>
            ) : (
              <>
                {!client.is_public && (
                  <ActionForm
                    submit={t('rotateSecret')}
                    onSubmit={async (form) => {
                      setSecret(undefined);
                      const result = await api.request<Secret>(
                        '/api/v1/admin/oauth/clients/' +
                          encodeURIComponent(client.client_id) +
                          '/rotate',
                        { method: 'POST', body: { reason: value(form, 'reason').trim() } },
                      );
                      if (mounted.current) setSecret(result);
                    }}
                  >
                    <Field label={t('reason')} name="reason" required maxLength={500} />
                  </ActionForm>
                )}
                <ActionForm
                  submit={t('revokeClient')}
                  danger
                  onSubmit={async (form) => {
                    setSecret(undefined);
                    await api.request(
                      '/api/v1/admin/oauth/clients/' +
                        encodeURIComponent(client.client_id) +
                        '/revoke',
                      { method: 'POST', body: { reason: value(form, 'reason').trim() } },
                    );
                    if (mounted.current) await load();
                  }}
                >
                  <Field label={t('reason')} name="reason" required maxLength={500} />
                </ActionForm>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
