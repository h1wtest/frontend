import { decodeWire, validateCommand } from './wire';
import { parseStrictJSON } from './generated/validation';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

type Request = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};
export class ApiClient {
  private csrf = '';
  private csrfRequest: Promise<void> | undefined;
  private sessionId: string | null | undefined;
  private generation = 0;
  private language = globalThis.navigator?.language ?? 'en';
  setLanguage(locale: 'en' | 'ru') {
    this.language = locale;
  }
  constructor(
    private origin = globalThis.location?.origin ?? '',
    private expired: () => void = () => {},
  ) {}
  setSession(sessionId: string | null, csrf = '') {
    if (this.sessionId !== sessionId) {
      this.generation++;
      this.csrfRequest = undefined;
      this.sessionId = sessionId;
    }
    this.csrf = csrf;
  }
  private assertCurrent(generation: number) {
    if (generation !== this.generation)
      throw new ApiError(
        'Контекст авторизации изменился. Повторите действие.',
        0,
        'auth_context_changed',
      );
  }
  private async bootstrapCsrf() {
    if (this.csrf) return;
    if (!this.csrfRequest) {
      const generation = this.generation;
      const request = this.request<{ csrf_token: string }>('/api/v1/auth/csrf')
        .then((value) => {
          this.assertCurrent(generation);
          this.csrf = value.csrf_token;
        })
        .finally(() => {
          if (this.csrfRequest === request) this.csrfRequest = undefined;
        });
      this.csrfRequest = request;
    }
    await this.csrfRequest;
    if (!this.csrf) throw new Error('Сервер не выдал CSRF-токен. Обновите страницу.');
  }
  async request<T = unknown>(path: string, options: Request = {}): Promise<T> {
    return (await this.requestWithMetadata<T>(path, options)).data;
  }
  async requestWithMetadata<T = unknown>(
    path: string,
    options: Request = {},
  ): Promise<{ data: T; next_cursor: string | null }> {
    if (!path.startsWith('/api/v1/') || path.startsWith('//') || /[\\\r\n]/.test(path))
      throw new Error('Недопустимый адрес API');
    const generation = this.generation;
    const method = options.method ?? 'GET';
    if (method !== 'GET') validateCommand(path, method, options.body);
    if (method !== 'GET') await this.bootstrapCsrf();
    this.assertCurrent(generation);
    const headers = new Headers({ Accept: 'application/json' });
    headers.set('Accept-Language', this.language);
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (method !== 'GET') headers.set('X-CSRF-Token', this.csrf);
    const response = await fetch(new URL(path, this.origin), {
      method,
      headers,
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
    const raw = response.status === 204 ? '' : await response.text();
    let data: Record<string, unknown> | null = null;
    if (!response.ok && raw) {
      try {
        data = parseStrictJSON(raw) as Record<string, unknown>;
      } catch {
        data = null;
      }
    }
    this.assertCurrent(generation);
    if (!response.ok) {
      if (response.status === 401) {
        this.setSession(null);
        this.expired();
      }
      throw new ApiError(
        typeof data?.error === 'string' ? data.error : `Ошибка сервера (${response.status})`,
        response.status,
        typeof data?.code === 'string' ? data.code : 'request_failed',
      );
    }
    try {
      const decoded = (response.status === 204 ? null : decodeWire(path, method, raw)) as T;
      return { data: decoded, next_cursor: response.headers.get('X-Next-Cursor') || null };
    } catch {
      throw new ApiError('invalid_response', 502, 'invalid_response');
    }
  }
}
export const api = new ApiClient(globalThis.location?.origin ?? '', () =>
  globalThis.dispatchEvent?.(new Event('session-expired')),
);
