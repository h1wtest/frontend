// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthSession } from './auth';
import { api } from './api';
import { I18nProvider, useI18n } from './i18n';
import { NotificationAdmin } from './NotificationAdmin';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const auth = (permissions: string[]): AuthSession => ({
  session_id: 's1',
  csrf_token: 'csrf',
  user: {
    id: 'u1',
    email: 's@example.test',
    is_verified: true,
    mfa_enabled: true,
    roles: ['SUPPORT'],
    permissions,
  },
});
function fixture() {
  api.setSession('notification-admin-test', 'csrf');
  const mutations: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      const template = {
        event_type: 'subscription.changed',
        version: 1,
        variables: ['period_end', 'subscription_id'],
        locales: {
          en: { subject: 'Started', body: 'Active subscription' },
          ru: { subject: 'Начало', body: 'Подписка активна' },
        },
      };
      let response: unknown;
      if (options.method !== 'GET') {
        const body = JSON.parse(String(options.body));
        mutations.push({ path: url.pathname, body });
        response =
          options.method === 'PUT'
            ? { ...template, version: 2, locales: body.locales }
            : { status: 'queued' };
      } else if (url.pathname.endsWith('/templates')) response = { items: [template] };
      else
        response = [
          {
            id: '30000000-0000-4000-8000-000000000001',
            user_id: '10000000-0000-4000-8000-000000000001',
            channel: 'email',
            status: 'failed',
            attempts: 3,
            created_at: '2026-10-24T10:00:00Z',
            next_attempt_at: '2026-10-24T11:00:00Z',
            last_error: 'SECRET_PROVIDER_DETAILS',
            message_id: 'message-1',
            delivered_at: null,
            ambiguous: false,
          },
          {
            id: '30000000-0000-4000-8000-000000000002',
            user_id: '10000000-0000-4000-8000-000000000001',
            channel: 'email',
            status: 'sent',
            attempts: 1,
            created_at: '2026-10-24T10:00:00Z',
            next_attempt_at: '2026-10-24T11:00:00Z',
            last_error: null,
            message_id: 'message-2',
            delivered_at: '2026-10-24T11:00:00Z',
            ambiguous: false,
          },
        ];
      return new Response(JSON.stringify(response));
    }),
  );
  return mutations;
}
it('keeps support read-only and omits raw provider delivery errors', async () => {
  fixture();
  render(
    <I18nProvider initialLocale="en">
      <NotificationAdmin auth={auth(['notifications:read'])} />
    </I18nProvider>,
  );
  await screen.findByText('subscription.changed');
  expect(screen.queryByText('SECRET_PROVIDER_DETAILS')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Publish template' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Replay failed delivery' })).toBeNull();
});
it('publishes both locale revisions atomically and only replays failed deliveries with a reason', async () => {
  const mutations = fixture();
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <NotificationAdmin
        auth={auth(['notifications:read', 'notifications:templates:write', 'notifications:replay'])}
      />
    </I18nProvider>,
  );
  const subject = await screen.findByLabelText('EN subject');
  await user.clear(subject);
  await user.type(subject, 'Updated');
  await user.click(screen.getByRole('button', { name: 'Publish template' }));
  expect(mutations[0].body).toEqual({
    expected_version: 1,
    locales: {
      en: { subject: 'Updated', body: 'Active subscription' },
      ru: { subject: 'Начало', body: 'Подписка активна' },
    },
  });
  expect(screen.getAllByRole('button', { name: 'Replay failed delivery' })).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Replay failed delivery' }));
  expect(mutations).toHaveLength(1);
  await user.type(screen.getByLabelText('Replay reason'), 'Provider recovered');
  await user.click(screen.getByRole('button', { name: 'Replay failed delivery' }));
  expect(mutations[1]).toEqual({
    path: '/api/v1/admin/deliveries/30000000-0000-4000-8000-000000000001/replay',
    body: { reason: 'Provider recovered' },
  });
});
function SwitchLocale() {
  const { setLocale } = useI18n();
  return <button onClick={() => setLocale('ru')}>Switch locale</button>;
}
it('preserves unsaved EN and RU template edits across website language changes', async () => {
  fixture();
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <SwitchLocale />
      <NotificationAdmin auth={auth(['notifications:read', 'notifications:templates:write'])} />
    </I18nProvider>,
  );
  const subject = await screen.findByLabelText('EN subject');
  await user.clear(subject);
  await user.type(subject, 'Unsaved subject');
  await user.clear(screen.getByLabelText('RU body'));
  await user.type(screen.getByLabelText('RU body'), 'Несохранённый текст');
  await user.click(screen.getByRole('button', { name: 'Switch locale' }));
  expect((screen.getByLabelText('EN тема') as HTMLInputElement).value).toBe('Unsaved subject');
  expect((screen.getByLabelText('RU текст') as HTMLTextAreaElement).value).toBe(
    'Несохранённый текст',
  );
});

it('keeps the draft concurrency base across a newer refresh and preserves both locales after a conflict until explicit reload', async () => {
  api.setSession('template-conflict-test', 'csrf');
  const revision1 = {
    event_type: 'subscription.changed',
    version: 1,
    variables: ['period_end', 'subscription_id'],
    locales: {
      en: { subject: 'Started', body: 'Active subscription' },
      ru: { subject: 'Начало', body: 'Первая версия' },
    },
  };
  const revision2 = {
    ...revision1,
    version: 2,
    locales: { ...revision1.locales, ru: { subject: 'Новая тема', body: 'Новая версия' } },
  };
  let latest = revision1;
  const publications: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      if (options.method === 'PUT') {
        const body = JSON.parse(String(options.body));
        publications.push(body);
        if (body.expected_version !== latest.version)
          return new Response('{"error":"version_conflict","code":"version_conflict"}', {
            status: 409,
          });
        latest = { ...latest, version: latest.version + 1, locales: body.locales };
        return new Response(JSON.stringify(latest));
      }
      return new Response(
        JSON.stringify(url.pathname.endsWith('/templates') ? { items: [latest] } : []),
      );
    }),
  );
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <NotificationAdmin auth={auth(['notifications:read', 'notifications:templates:write'])} />
    </I18nProvider>,
  );
  const subject = await screen.findByLabelText('EN subject');
  await user.clear(subject);
  await user.type(subject, 'Local EN edit');
  latest = revision2;
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await user.click(screen.getByRole('button', { name: 'Publish template' }));
  await waitFor(() => expect(publications).toHaveLength(1));
  expect(publications[0]).toEqual({
    expected_version: 1,
    locales: {
      en: { subject: 'Local EN edit', body: 'Active subscription' },
      ru: { subject: 'Начало', body: 'Первая версия' },
    },
  });
  await screen.findByRole('alert');
  expect((screen.getByLabelText('EN subject') as HTMLInputElement).value).toBe('Local EN edit');
  expect((screen.getByLabelText('RU body') as HTMLTextAreaElement).value).toBe('Первая версия');
  expect(
    screen.getByText('A newer revision is available. Your draft still uses its original version.'),
  ).toBeTruthy();
  await user.click(
    screen.getByRole('button', { name: 'Discard draft and reload latest revision' }),
  );
  expect((screen.getByLabelText('EN subject') as HTMLInputElement).value).toBe('Started');
  expect((screen.getByLabelText('RU body') as HTMLTextAreaElement).value).toBe('Новая версия');
  await user.click(screen.getByRole('button', { name: 'Publish template' }));
  await waitFor(() => expect(publications).toHaveLength(2));
  expect(publications[1]).toEqual({ expected_version: 2, locales: revision2.locales });
});

it('does not let a delayed refresh regress a newly published template revision', async () => {
  api.setSession('template-delayed-refresh-test', 'csrf');
  const revision1 = {
    event_type: 'subscription.changed',
    version: 1,
    variables: ['period_end', 'subscription_id'],
    locales: {
      en: { subject: 'Started', body: 'Active subscription' },
      ru: { subject: 'Начало', body: 'Подписка активна' },
    },
  };
  let templateReads = 0;
  const { promise: delayedRefresh, resolve: releaseRefresh } = Promise.withResolvers<Response>();
  const versions: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      if (options.method === 'PUT') {
        const body = JSON.parse(String(options.body));
        versions.push(body.expected_version);
        return new Response(
          JSON.stringify({
            ...revision1,
            version: body.expected_version + 1,
            locales: body.locales,
          }),
        );
      }
      if (!url.pathname.endsWith('/templates')) return new Response('[]');
      if (++templateReads === 2) return delayedRefresh;
      return new Response(JSON.stringify({ items: [revision1] }));
    }),
  );
  const user = userEvent.setup();
  render(
    <I18nProvider initialLocale="en">
      <NotificationAdmin auth={auth(['notifications:read', 'notifications:templates:write'])} />
    </I18nProvider>,
  );
  const subject = await screen.findByLabelText('EN subject');
  await user.clear(subject);
  await user.type(subject, 'Published edit');
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await user.click(screen.getByRole('button', { name: 'Publish template' }));
  await waitFor(() => expect(versions).toEqual([1]));
  await screen.findByText('Version: 2');
  await act(async () => {
    releaseRefresh(new Response(JSON.stringify({ items: [revision1] })));
  });
  await screen.findByRole('button', { name: 'Refresh' });
  expect(screen.getByText('Version: 2')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Publish template' }));
  await waitFor(() => expect(versions).toEqual([1, 2]));
});

function previewFixture(status = 200, code = '') {
  api.setSession('template-preview-test', 'csrf');
  const requests: { method: string; path: string; body: unknown; csrf: string | null }[] = [];
  const locales = {
    en: { subject: 'Started', body: 'Active subscription' },
    ru: { subject: 'Начало', body: 'Подписка активна' },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      if (options.method === 'GET')
        return new Response(
          JSON.stringify(
            url.pathname.endsWith('/templates')
              ? {
                  items: [
                    {
                      event_type: 'subscription.changed',
                      version: 1,
                      variables: ['period_end', 'subscription_id'],
                      locales,
                    },
                  ],
                }
              : [],
          ),
        );
      requests.push({
        method: String(options.method),
        path: url.pathname,
        body: JSON.parse(String(options.body)),
        csrf: new Headers(options.headers).get('X-CSRF-Token'),
      });
      if (status !== 200) return new Response(JSON.stringify({ error: code, code }), { status });
      return new Response(
        JSON.stringify({
          locales: {
            en: {
              subject: 'Preview EN',
              body: '<img src=x onerror="alert(1)"><script>doNotRun()</script>',
            },
            ru: { subject: 'Предпросмотр RU', body: 'Пример периода: 2030-01-02' },
          },
        }),
      );
    }),
  );
  return requests;
}

it('inserts only server-allowed tokens into each focused locale field at its selection and previews through a nonpublishing CSRF POST with inert text', async () => {
  const requests = previewFixture();
  const user = userEvent.setup();
  const view = render(
    <I18nProvider initialLocale="en">
      <NotificationAdmin auth={auth(['notifications:read', 'notifications:templates:write'])} />
    </I18nProvider>,
  );
  await screen.findByLabelText('EN subject');
  expect(screen.queryByRole('button', { name: 'Insert {{reset_url}}' })).toBeNull();
  const fields = [
    ['EN subject', 'S{{period_end}}rted'],
    ['EN body', 'A{{period_end}}ive subscription'],
    ['RU subject', 'Н{{period_end}}ало'],
    ['RU body', 'П{{period_end}}писка активна'],
  ];
  for (const [label, expected] of fields) {
    const field = screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
    await user.click(field);
    field.setSelectionRange(1, 3);
    await user.click(screen.getByRole('button', { name: 'Insert {{period_end}}' }));
    expect(field.value).toBe(expected);
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(15);
  }
  await user.click(screen.getByRole('button', { name: 'Preview template' }));
  await screen.findByText('Preview EN');
  expect(requests).toEqual([
    {
      method: 'POST',
      path: '/api/v1/admin/templates/subscription.changed/preview',
      csrf: 'csrf',
      body: {
        locales: {
          en: { subject: 'S{{period_end}}rted', body: 'A{{period_end}}ive subscription' },
          ru: { subject: 'Н{{period_end}}ало', body: 'П{{period_end}}писка активна' },
        },
      },
    },
  ]);
  expect(
    screen.getByText('<img src=x onerror="alert(1)"><script>doNotRun()</script>'),
  ).toBeTruthy();
  expect(screen.getByText('Предпросмотр RU')).toBeTruthy();
  expect(view.container.querySelector('img, script')).toBeNull();
  await user.type(screen.getByLabelText('EN subject'), ' changed');
  expect(screen.queryByText('Preview EN')).toBeNull();
  expect(requests).toHaveLength(1);
});

it.each([
  [403, 'forbidden'],
  [400, 'unknown_template_variable'],
] as const)(
  'shows preview failure %s without publishing or discarding the draft',
  async (status, code) => {
    const requests = previewFixture(status, code);
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <NotificationAdmin auth={auth(['notifications:read', 'notifications:templates:write'])} />
      </I18nProvider>,
    );
    const subject = await screen.findByLabelText('EN subject');
    await user.clear(subject);
    await user.paste(code === 'unknown_template_variable' ? 'Unsaved {{reset_url}}' : 'Unsaved');
    await user.click(screen.getByRole('button', { name: 'Preview template' }));
    await screen.findByRole('alert');
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].path).toBe('/api/v1/admin/templates/subscription.changed/preview');
    expect((subject as HTMLInputElement).value).toBe(
      code === 'unknown_template_variable' ? 'Unsaved {{reset_url}}' : 'Unsaved',
    );
  },
);

it('does not expose insertion or preview to notification readers without template-write permission', async () => {
  const requests = previewFixture();
  render(
    <I18nProvider initialLocale="en">
      <NotificationAdmin auth={auth(['notifications:read'])} />
    </I18nProvider>,
  );
  await screen.findByText('subscription.changed');
  expect(screen.queryByRole('button', { name: 'Preview template' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Insert / })).toBeNull();
  expect(requests).toHaveLength(0);
});
