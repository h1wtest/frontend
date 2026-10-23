import { useEffect, useState } from 'react';
import { api, type ApiClient } from './api';
import type { LoginResult } from './auth';
import { ActionForm, Field, value } from './components';

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
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [mode, setMode] = useState<Mode>(
    resetToken || params.has('token') ? 'reset' : params.has('user_id') ? 'verify' : 'login',
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
      if (!result.challenge_id) throw new Error('Сервер не выдал MFA challenge');
      setChallenge(result.challenge_id);
      return 'Введите код приложения-аутентификатора или одноразовый резервный код.';
    }
    await authenticated();
    return 'Вход выполнен.';
  }
  return (
    <section className="card entry">
      <h2>Учётная запись</h2>
      <nav className="tabs" aria-label="Авторизация">
        {(
          [
            ['login', 'Вход'],
            ['register', 'Регистрация'],
            ['verify', 'Подтверждение email'],
            ['forgot', 'Забыли пароль?'],
            ['reset', 'Сброс пароля'],
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
          submit="Войти"
          onSubmit={async (form) =>
            finish(
              await post<LoginResult>('login', {
                email: value(form, 'email'),
                password: value(form, 'password'),
                device_name: 'Web browser',
              }),
            )
          }
        >
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
          />
          <Field
            label="Пароль"
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
          submit="Подтвердить вход"
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
            label="Код MFA или резервный код"
            name="code"
            autoComplete="one-time-code"
            autoFocus
            required
            maxLength={128}
          />
          <p className="muted">
            Резервный код используется только один раз. При истечении challenge начните вход заново.
          </p>
        </ActionForm>
      )}
      {mode === 'register' && (
        <ActionForm
          key="register"
          submit="Зарегистрироваться"
          onSubmit={async (form) => {
            const email = value(form, 'email');
            const result = await post<{ user_id: string; email: string }>('register', {
              email,
              password: value(form, 'password'),
            });
            setUserId(result.user_id);
            setRegisteredEmail(result.email);
            setMode('verify');
          }}
        >
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
          <Field
            label="Новый пароль"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={1024}
            required
          />
        </ActionForm>
      )}
      {mode === 'verify' && (
        <ActionForm
          key="verify"
          submit="Подтвердить email"
          onSubmit={async (form) => {
            await post('verify-email', {
              user_id: value(form, 'user_id'),
              code: value(form, 'code'),
            });
            setMode('login');
          }}
        >
          <p>Введите код из письма{registeredEmail && ` для ${registeredEmail}`}.</p>
          <Field
            label="Идентификатор пользователя из регистрации или письма"
            name="user_id"
            defaultValue={userId}
            required
          />
          <Field
            label="Код подтверждения email"
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
          submit="Запросить восстановление"
          onSubmit={async (form) => {
            await post('password/forgot', { email: value(form, 'email') });
            return 'Если аккаунт существует, инструкции отправлены на email.';
          }}
        >
          <Field
            label="Email"
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
          submit="Сбросить пароль"
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
            label="Одноразовый токен из письма"
            name="token"
            defaultValue={resetToken ?? params.get('token') ?? ''}
            required
            autoComplete="off"
            maxLength={1024}
          />
          <Field
            label="Новый пароль"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={1024}
            required
          />
          <p className="muted">Сброс отзовёт все активные сессии.</p>
        </ActionForm>
      )}
    </section>
  );
}
