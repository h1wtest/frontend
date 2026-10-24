// SPDX-License-Identifier: MIT
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
} from 'react';
import { api } from './api';
import { canAdmin, type AuthSession } from './auth';
import { ActionButton, ActionForm, Field, Time, value } from './components';
import { useI18n, useText } from './i18n';
import { accountMessages, deliveryStatusKey } from './account-resources';
import type { SafeDelivery } from './ProfilePanel';

import type {
  TemplateLocales,
  TemplatePreviewResponse,
  TemplateRevision as Template,
} from './generated/businessv1';

type TemplateLocale = keyof TemplateLocales;
type TemplatePart = keyof TemplateLocales['en'];
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
  const [draft, setDraft] = useState(() => ({ base: template, locales: template.locales }));
  const [preview, setPreview] = useState<TemplatePreviewResponse>();
  const previewGeneration = useRef(0);
  const activeField = useRef<{
    locale: TemplateLocale;
    part: TemplatePart;
    element: HTMLInputElement | HTMLTextAreaElement;
  }>();
  const [hasActiveField, setHasActiveField] = useState(false);
  const pendingSelection = useRef<{
    element: HTMLInputElement | HTMLTextAreaElement;
    position: number;
  }>();
  const dirty = (['en', 'ru'] as const).some((locale) =>
    (['subject', 'body'] as const).some(
      (part) => draft.locales[locale][part] !== draft.base.locales[locale][part],
    ),
  );
  useEffect(() => {
    if (template.version <= draft.base.version || dirty) return;
    setDraft({ base: template, locales: template.locales });
    previewGeneration.current++;
    setPreview(undefined);
    activeField.current = undefined;
    setHasActiveField(false);
  }, [template, draft.base.version, dirty]);
  useEffect(
    () => () => {
      previewGeneration.current++;
    },
    [],
  );
  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    if (!selection) return;
    pendingSelection.current = undefined;
    selection.element.focus();
    selection.element.setSelectionRange(selection.position, selection.position);
  }, [draft.locales]);
  function edit(locale: TemplateLocale, part: TemplatePart, text: string) {
    previewGeneration.current++;
    setPreview(undefined);
    setDraft((current) => ({
      ...current,
      locales: {
        ...current.locales,
        [locale]: { ...current.locales[locale], [part]: text },
      },
    }));
  }
  function insertVariable(variable: Template['variables'][number]) {
    const target = activeField.current;
    if (!target?.element.isConnected || !template.variables.includes(variable)) return;
    const text = draft.locales[target.locale][target.part];
    const start = target.element.selectionStart ?? text.length;
    const end = target.element.selectionEnd ?? start;
    const token = `{{${variable}}}`;
    const next = text.slice(0, start) + token + text.slice(end);
    if (next.length > target.element.maxLength) return;
    pendingSelection.current = { element: target.element, position: start + token.length };
    edit(target.locale, target.part, next);
  }
  return (
    <li>
      <h4>{template.event_type}</h4>
      <p>
        {t('version')}: {writable ? draft.base.version : template.version}
      </p>
      {writable ? (
        <ActionForm
          key={draft.base.version}
          submit={t('publishTemplate')}
          onSubmit={async () => {
            const updated = await api.request<Template>(
              `/api/v1/admin/templates/${encodeURIComponent(template.event_type)}`,
              {
                method: 'PUT',
                body: { expected_version: draft.base.version, locales: draft.locales },
              },
            );
            previewGeneration.current++;
            setPreview(undefined);
            activeField.current = undefined;
            setHasActiveField(false);
            setDraft({ base: updated, locales: updated.locales });
            published(updated);
          }}
        >
          {template.version > draft.base.version && (
            <p role="status" className="notice">
              {t('newTemplateRevision')}
            </p>
          )}
          {(dirty || template.version > draft.base.version) && (
            <button
              type="button"
              onClick={() => {
                previewGeneration.current++;
                setPreview(undefined);
                activeField.current = undefined;
                setHasActiveField(false);
                setDraft({ base: template, locales: template.locales });
              }}
            >
              {t('reloadTemplate')}
            </button>
          )}
          {(['en', 'ru'] as const).map((locale) => (
            <div key={locale}>
              {(['subject', 'body'] as const).map((part) => {
                const label = t(
                  locale === 'en'
                    ? part === 'subject'
                      ? 'enSubject'
                      : 'enBody'
                    : part === 'subject'
                      ? 'ruSubject'
                      : 'ruBody',
                );
                const props = {
                  name: `${locale}_${part}`,
                  value: draft.locales[locale][part],
                  required: true,
                  maxLength: part === 'subject' ? 500 : 32000,
                  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                    edit(locale, part, event.currentTarget.value),
                  onFocus: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                    activeField.current = { locale, part, element: event.currentTarget };
                    setHasActiveField(true);
                  },
                };
                return part === 'subject' ? (
                  <Field key={part} label={label} {...props} />
                ) : (
                  <label key={part} className="field">
                    <span>{label}</span>
                    <textarea {...props} rows={6} />
                  </label>
                );
              })}
            </div>
          ))}
          <p className="muted">{t('templateVariables')}</p>
          <div>
            {template.variables.map((variable) => (
              <span className="action" key={variable}>
                <button
                  type="button"
                  disabled={!hasActiveField}
                  onClick={() => insertVariable(variable)}
                >
                  {t('insertVariable')} {`{{${variable}}}`}
                </button>
              </span>
            ))}
          </div>
          <ActionButton
            action={async () => {
              const generation = ++previewGeneration.current;
              setPreview(undefined);
              try {
                const rendered = await api.request<TemplatePreviewResponse>(
                  `/api/v1/admin/templates/${encodeURIComponent(template.event_type)}/preview`,
                  { method: 'POST', body: { locales: draft.locales } },
                );
                if (generation === previewGeneration.current) setPreview(rendered);
              } catch (error) {
                if (generation === previewGeneration.current) throw error;
              }
            }}
          >
            {t('previewTemplate')}
          </ActionButton>
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
      {writable && preview && (
        <section aria-label={t('templatePreview')}>
          <h5>{t('templatePreview')}</h5>
          <p className="muted">{t('templatePreviewSamples')}</p>
          <dl>
            <dt>{t('enSubject')}</dt>
            <dd>{preview.locales.en.subject}</dd>
            <dt>{t('enBody')}</dt>
            <dd>
              <pre>{preview.locales.en.body}</pre>
            </dd>
            <dt>{t('ruSubject')}</dt>
            <dd>{preview.locales.ru.subject}</dd>
            <dt>{t('ruBody')}</dt>
            <dd>
              <pre>{preview.locales.ru.body}</pre>
            </dd>
          </dl>
        </section>
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
  const refreshGeneration = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const generation = ++refreshGeneration.current;
    try {
      const [templatePage, deliveryPage] = await Promise.all([
        api.request<{ items: Template[] }>('/api/v1/admin/templates', { signal }),
        api.requestWithMetadata<SafeDelivery[]>('/api/v1/admin/deliveries?limit=50', { signal }),
      ]);
      if (signal?.aborted || generation !== refreshGeneration.current) return;
      setTemplates((previous) => {
        const latest = new Map(previous?.map((row) => [row.event_type, row]));
        for (const row of templatePage.items) {
          const current = latest.get(row.event_type);
          if (!current || row.version > current.version) latest.set(row.event_type, row);
        }
        return [...latest.values()];
      });
      setDeliveries(deliveryPage.data);
      setCursor(deliveryPage.next_cursor ?? undefined);
      setFailure(undefined);
    } catch (error) {
      if (!signal?.aborted && generation === refreshGeneration.current) throw error;
    }
  }, []);
  useEffect(() => {
    if (!readable) return;
    const controller = new AbortController();
    void refresh(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setFailure(error);
    });
    return () => {
      controller.abort();
      refreshGeneration.current++;
    };
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
                published={(updated) => {
                  refreshGeneration.current++;
                  setTemplates((previous) =>
                    previous?.map((row) =>
                      row.event_type === updated.event_type && updated.version > row.version
                        ? updated
                        : row,
                    ),
                  );
                }}
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
