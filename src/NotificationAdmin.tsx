// SPDX-License-Identifier: MIT
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { canAdmin, type AuthSession } from './auth';
import { ActionButton, ActionForm, Field, Time, value } from './components';
import { useI18n, useText } from './i18n';
import { accountMessages, deliveryStatusKey } from './account-resources';
import type { SafeDelivery } from './ProfilePanel';

import type { TemplateRevision as Template } from './generated/businessv1';
function TemplateEditor({
  template,
  writable,
  published,
}: {
  template: Template;
  writable: boolean;
  published: (template: Template) => void;
}) {
  const t = useText(accountMessages);
  return (
    <li>
      <h4>{template.event_type}</h4>
      <p>
        {t('version')}: {template.version}
      </p>
      {writable ? (
        <ActionForm
          submit={t('publishTemplate')}
          onSubmit={async (form) => {
            published(
              await api.request<Template>(
                `/api/v1/admin/templates/${encodeURIComponent(template.event_type)}`,
                {
                  method: 'PUT',
                  body: {
                    expected_version: template.version,
                    locales: {
                      en: { subject: value(form, 'en_subject'), body: value(form, 'en_body') },
                      ru: { subject: value(form, 'ru_subject'), body: value(form, 'ru_body') },
                    },
                  },
                },
              ),
            );
          }}
        >
          <Field
            label={t('enSubject')}
            name="en_subject"
            defaultValue={template.locales.en.subject}
            required
            maxLength={500}
          />
          <label className="field">
            <span>{t('enBody')}</span>
            <textarea
              name="en_body"
              defaultValue={template.locales.en.body}
              required
              rows={6}
              maxLength={32000}
            />
          </label>
          <Field
            label={t('ruSubject')}
            name="ru_subject"
            defaultValue={template.locales.ru.subject}
            required
            maxLength={500}
          />
          <label className="field">
            <span>{t('ruBody')}</span>
            <textarea
              name="ru_body"
              defaultValue={template.locales.ru.body}
              required
              rows={6}
              maxLength={32000}
            />
          </label>
          <p className="muted">{t('atomicPublish')}</p>
        </ActionForm>
      ) : (
        <dl>
          <dt>{t('enSubject')}</dt>
          <dd>{template.locales.en.subject}</dd>
          <dt>{t('enBody')}</dt>
          <dd>{template.locales.en.body}</dd>
          <dt>{t('ruSubject')}</dt>
          <dd>{template.locales.ru.subject}</dd>
          <dt>{t('ruBody')}</dt>
          <dd>{template.locales.ru.body}</dd>
        </dl>
      )}
    </li>
  );
}
export function NotificationAdmin({ auth }: { auth: AuthSession }) {
  const t = useText(accountMessages);
  const { error: errorText } = useI18n();
  const readable = canAdmin(auth.user, 'notifications:read');
  const editable = canAdmin(auth.user, 'notifications:templates:write');
  const replayable = canAdmin(auth.user, 'notifications:replay');
  const [templates, setTemplates] = useState<Template[]>();
  const [deliveries, setDeliveries] = useState<SafeDelivery[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [failure, setFailure] = useState<unknown>();
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const [templatePage, deliveryPage] = await Promise.all([
      api.request<{ items: Template[] }>('/api/v1/admin/templates', { signal }),
      api.requestWithMetadata<SafeDelivery[]>('/api/v1/admin/deliveries?limit=50', { signal }),
    ]);
    if (signal?.aborted) return;
    setTemplates(templatePage.items);
    setDeliveries(deliveryPage.data);
    setCursor(deliveryPage.next_cursor ?? undefined);
    setFailure(undefined);
  }, []);
  useEffect(() => {
    if (!readable) return;
    const controller = new AbortController();
    void refresh(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setFailure(error);
    });
    return () => controller.abort();
  }, [readable, refresh, auth.session_id]);
  if (!readable) return <p role="alert">{t('forbidden')}</p>;
  return (
    <section aria-labelledby="notification-admin-heading">
      <h2 id="notification-admin-heading">{t('notificationAdmin')}</h2>
      <ActionButton action={() => refresh()}>{t('refresh')}</ActionButton>
      {failure !== undefined && (
        <p className="error" role="alert">
          {errorText(failure)}
        </p>
      )}
      {!templates && failure === undefined && <p role="status">{t('loading')}</p>}
      <div className="grid">
        <section className="card">
          <h3>{t('templates')}</h3>
          {templates?.length === 0 && <p>{t('empty')}</p>}
          <ul className="records">
            {templates?.map((template) => (
              <TemplateEditor
                key={template.event_type}
                template={template}
                writable={editable}
                published={(updated) =>
                  setTemplates((previous) =>
                    previous?.map((row) => (row.event_type === updated.event_type ? updated : row)),
                  )
                }
              />
            ))}
          </ul>
        </section>
        <section className="card">
          <h3>{t('deliveries')}</h3>
          {templates && deliveries.length === 0 && <p>{t('empty')}</p>}
          <ul className="records">
            {deliveries.map((delivery) => (
              <li key={delivery.id}>
                <code>{delivery.id}</code>
                <strong>
                  {delivery.channel}: {t(deliveryStatusKey(delivery.status))}
                </strong>
                <span>
                  {t('attempts')}: {delivery.attempts}
                </span>
                <Time value={delivery.created_at} />
                {delivery.delivered_at && <Time value={delivery.delivered_at} />}
                {delivery.status === 'failed' && replayable && (
                  <ActionForm
                    submit={t('replay')}
                    onSubmit={async (form) => {
                      await api.request(
                        `/api/v1/admin/deliveries/${encodeURIComponent(delivery.id)}/replay`,
                        { method: 'POST', body: { reason: value(form, 'reason') } },
                      );
                      setDeliveries((previous) =>
                        previous.map<SafeDelivery>((row) =>
                          row.id === delivery.id ? { ...row, status: 'retry' } : row,
                        ),
                      );
                      return t('queued');
                    }}
                  >
                    <Field label={t('replayReason')} name="reason" required maxLength={1000} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
          {cursor && (
            <ActionButton
              action={async () => {
                const page = await api.requestWithMetadata<SafeDelivery[]>(
                  `/api/v1/admin/deliveries?limit=50&cursor=${encodeURIComponent(cursor)}`,
                );
                setDeliveries((previous) => [...previous, ...page.data]);
                setCursor(page.next_cursor ?? undefined);
              }}
            >
              {t('more')}
            </ActionButton>
          )}
        </section>
      </div>
    </section>
  );
}
