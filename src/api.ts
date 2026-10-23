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
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};
export class ApiClient {
  private csrf = '';
  private csrfRequest: Promise<void> | undefined;
  constructor(
    private origin = globalThis.location?.origin ?? '',
    private expired: () => void = () => {},
  ) {}
  setCsrf(value: string) {
    this.csrf = value;
  }
  private async bootstrapCsrf() {
    if (this.csrf) return;
    this.csrfRequest ??= this.request<{ csrf_token: string }>('/api/v1/auth/csrf')
      .then((value) => {
        this.csrf = value.csrf_token;
      })
      .finally(() => {
        this.csrfRequest = undefined;
      });
    await this.csrfRequest;
    if (!this.csrf) throw new Error('Сервер не выдал CSRF-токен. Обновите страницу.');
  }
  async request<T = unknown>(path: string, options: Request = {}): Promise<T> {
    if (!path.startsWith('/api/v1/') || path.startsWith('//') || /[\\\r\n]/.test(path))
      throw new Error('Недопустимый адрес API');
    const method = options.method ?? 'GET';
    if (method !== 'GET') await this.bootstrapCsrf();
    const headers = new Headers({ Accept: 'application/json' });
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (method !== 'GET') headers.set('X-CSRF-Token', this.csrf);
    const response = await fetch(new URL(path, this.origin), {
      method,
      headers,
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal ?? AbortSignal.timeout(15000),
    });
    const data =
      response.status === 204
        ? null
        : ((await response.json().catch(() => null)) as Record<string, unknown> | null);
    if (!response.ok) {
      if (response.status === 401) {
        this.csrf = '';
        this.expired();
      }
      throw new ApiError(
        typeof data?.error === 'string' ? data.error : `Ошибка сервера (${response.status})`,
        response.status,
        typeof data?.code === 'string' ? data.code : 'request_failed',
      );
    }
    return data as T;
  }
}
export const api = new ApiClient(globalThis.location?.origin ?? '', () =>
  globalThis.dispatchEvent?.(new Event('session-expired')),
);
