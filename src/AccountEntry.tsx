import { useEffect, useState } from 'react';
import { api, type ApiClient } from './api';
import type { LoginResult } from './auth';
import { ActionForm, Field, value } from './components';
import { useI18n, useText } from './i18n';
import { identityMessages } from './identity-resources';

type Mode = 'login' | 'register' | 'verify' | 'forgot' | 'reset';
export function AccountEntry({
  authenticated,
  client = api,
  resetToken,
  resetComplete,
}: {
  authenticated: () => Promise<void>;
  client?: ApiClient;
  resetToken?: string;
  resetComplete?: () => Promise<void>;
}) {
  const t = useText(identityMessages);
  const { locale } = useI18n();
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [mode, setMode] = useState<Mode>(
    resetToken || params.has('token')
      ? 'reset'
      : params.has('user_id')
        ? 'verify'
        : window.location.pathname === '/register'
          ? 'register'
          : 'login',
  );
  const [userId, setUserId] = useState(params.get('user_id') ?? '');
  const [challenge, setChallenge] = useState('');
  const [registeredEmail, setRegisteredEmail] = useState('');
  useEffect(() => {
    if (params.has('token')) window.history.replaceState(null, '', window.location.pathname);
  }, [params]);
  const post = <T,>(path: string, body: unknown) =>
    client.request<T>('/api/v1/auth/' + path, { method: 'POST', body });
  async function finish(result: LoginResult) {
    if (result.status === 'mfa_required') {
      if (!result.challenge_id) throw new Error(t('missingChallenge'));
      setChallenge(result.challenge_id);
      return t('enterMfa');
    }
    await authenticated();
    return t('signedIn');
  }
  return (
    <section className="card entry">
      <h2>{t('account')}</h2>
      <nav className="tabs" aria-label={t('auth')}>
        {(
          [
            ['login', t('login')],
            ['register', t('register')],
            ['verify', t('verify')],
            ['forgot', t('forgot')],
            ['reset', t('reset')],
          ] as const
        ).map(([key, label]) => (
          <button
            type="button"
            aria-current={mode === key ? 'page' : undefined}
            key={key}
            onClick={() => {
              setMode(key);
              setChallenge('');
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {mode === 'login' && !challenge && (
        <ActionForm
          key="login"
          submit={t('signIn')}
          onSubmit={async (form) =>
            finish(
              await post<LoginResult>('login', {
                email: value(form, 'email'),
                password: value(form, 'password'),
                device_name: t('webBrowser'),
              }),
            )
          }
        >
          <Field
            label={t('email')}
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
          />
          <Field
            label={t('password')}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1024}
          />
        </ActionForm>
      )}
      {mode === 'login' && challenge && (
        <ActionForm
          key="challenge"
          submit={t('confirmLogin')}
          onSubmit={async (form) =>
            finish(
              await post<LoginResult>('mfa/verify-login', {
                challenge_id: challenge,
                code: value(form, 'code'),
              }),
            )
          }
        >
          <Field
            label={t('mfaCode')}
            name="code"
            autoComplete="one-time-code"
            autoFocus
            required
            maxLength={128}
          />
          <p className="muted">{t('challengeHint')}</p>
        </ActionForm>
      )}
      {mode === 'register' && (
        <ActionForm
          key="register"
          submit={t('create')}
          onSubmit={async (form) => {
            const email = value(form, 'email');
            const result = await post<{ user_id: string; email: string }>('register', {
              email,
              password: value(form, 'password'),
              locale,
              ...(value(form, 'referral_code').trim()
                ? { referral_code: value(form, 'referral_code').trim() }
                : {}),
            });
            setUserId(result.user_id);
            setRegisteredEmail(result.email);
            setMode('verify');
          }}
        >
          <Field
            label={t('email')}
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
          <Field
            label={t('newPassword')}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={1024}
            required
          />
          <Field
            label={t('referral')}
            name="referral_code"
            autoComplete="off"
            maxLength={128}
            defaultValue={params.get('ref') ?? params.get('referral_code') ?? ''}
          />
        </ActionForm>
      )}
      {mode === 'verify' && (
        <ActionForm
          key="verify"
          submit={t('confirmEmail')}
          onSubmit={async (form) => {
            await post('verify-email', {
              user_id: value(form, 'user_id'),
              code: value(form, 'code'),
            });
            setMode('login');
          }}
        >
          <p>
            {t('emailHint')} {registeredEmail}
          </p>
          <Field label={t('userId')} name="user_id" defaultValue={userId} required />
          <Field
            label={t('verificationCode')}
            name="code"
            autoComplete="one-time-code"
            required
            maxLength={128}
          />
        </ActionForm>
      )}
      {mode === 'forgot' && (
        <ActionForm
          key="forgot"
          submit={t('recover')}
          onSubmit={async (form) => {
            await post('password/forgot', { email: value(form, 'email') });
            return t('recoverySent');
          }}
        >
          <Field
            label={t('email')}
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
        </ActionForm>
      )}
      {mode === 'reset' && (
        <ActionForm
          key="reset"
          submit={t('resetPassword')}
          onSubmit={async (form) => {
            await post('password/reset', {
              token: value(form, 'token'),
              password: value(form, 'password'),
            });
            window.history.replaceState(null, '', '/');
            setMode('login');
            await resetComplete?.();
          }}
        >
          <Field
            label={t('resetToken')}
            name="token"
            defaultValue={resetToken ?? params.get('token') ?? ''}
            required
            autoComplete="off"
            maxLength={1024}
          />
          <Field
            label={t('newPassword')}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={1024}
            required
          />
          <p className="muted">{t('resetHint')}</p>
        </ActionForm>
      )}
    </section>
  );
}
