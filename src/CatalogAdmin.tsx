// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { AuthSession } from './auth';
import type { Catalog, PlanRevision } from './commerce';
import { CommandAttempts } from './commerce';
import { loadCatalog } from './catalog';
import { ActionButton, ActionForm, Field, value } from './components';
import { useI18n, useText } from './i18n';
import { adminCommerceMessages as messages, adminStatusKeys } from './admin-commerce-resources';

const base = '/api/v1/admin/catalog';

export function CatalogAdmin({ auth }: { auth: AuthSession }) {
  return (
    <CatalogWorkspace key={`${auth.session_id}:${auth.user.permissions.join(',')}`} auth={auth} />
  );
}
function CatalogWorkspace({ auth }: { auth: AuthSession }) {
  const t = useText(messages);
  const { locale, error } = useI18n();
  const can = (permission: string) => auth.user.permissions.includes(permission);
  const attempts = useRef(new CommandAttempts());
  const [notice, setNotice] = useState('');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [revision, setRevision] = useState<PlanRevision | null>(null);
  const [preview, setPreview] = useState<PlanRevision | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!auth.user.permissions.includes('catalog:read')) return;
    const controller = new AbortController();
    let cancelled = false;
    setFailure(null);
    loadCatalog('/api/v1/admin/catalog/pages', controller.signal)
      .then((result) => {
        if (!cancelled) {
          setCatalog(result);
          setRevision((current) => {
            if (!current) return null;
            const latest = result.revisions.find((item) => item.id === current.id);
            return latest && latest.version >= current.version ? latest : current;
          });
        }
      })
      .catch((cause) => {
        if (!cancelled) setFailure(cause);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [auth, refresh]);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === 'visible') setRefresh((n) => n + 1);
    };
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const updateRevision = (next: PlanRevision) => {
    setRevision(next);
    setPreview(null);
    setNotice(t('saved'));
    setCatalog((current) =>
      current
        ? {
            ...current,
            revisions: [...current.revisions.filter((item) => item.id !== next.id), next],
          }
        : current,
    );
  };
  const mutateRevision = async (operation: string) => {
    if (!revision) return;
    const next = await api.request<PlanRevision>(
      `${base}/revisions/${encodeURIComponent(revision.id)}/${operation}`,
      {
        method: 'POST',
        body:
          operation === 'preview'
            ? { expected_version: revision.version }
            : attempts.current.body(`${revision.id}/${operation}`, {
                expected_version: revision.version,
              }),
      },
    );
    if (operation === 'preview') setPreview(next);
    else {
      updateRevision(next);
      setRefresh((n) => n + 1);
    }
  };
  if (!can('catalog:read')) return <p role="alert">{t('forbidden')}</p>;
  return (
    <section aria-label={t('catalog')}>
      <h2>{t('catalog')}</h2>
      <p>{t('identityNote')}</p>
      <button type="button" onClick={() => setRefresh((n) => n + 1)}>
        {t('refresh')}
      </button>
      {failure ? (
        <p role="alert">{error(failure)}</p>
      ) : (
        !catalog && <p role="status">{t('loading')}</p>
      )}
      {notice && <p role="status">{notice}</p>}
      {can('catalog:write') && (
        <ActionForm
          title={t('createProduct')}
          submit={t('createProduct')}
          onSubmit={async (form) => {
            await api.request(`${base}/products`, {
              method: 'POST',
              body: attempts.current.body('create-product', { key: value(form, 'key') }),
            });
            setRefresh((n) => n + 1);
          }}
        >
          <Field
            label={t('key')}
            name="key"
            required
            pattern="[a-z0-9][a-z0-9_-]*"
            maxLength={64}
          />
        </ActionForm>
      )}
      {catalog?.products.length === 0 && <p>{t('empty')}</p>}
      {catalog?.products.map((product) => (
        <article className="card" key={product.id}>
          <h3>
            {t('product')}: {product.key}
          </h3>
          <p className="muted">{product.id}</p>
          {can('catalog:write') && (
            <ActionForm
              title={`${t('createPlan')}: ${product.key}`}
              submit={t('createPlan')}
              onSubmit={async (form) => {
                await api.request(`${base}/products/${encodeURIComponent(product.id)}/plans`, {
                  method: 'POST',
                  body: attempts.current.body(`create-plan:${product.id}`, {
                    key: value(form, 'key'),
                    upgrade_rank: Number(value(form, 'rank')),
                  }),
                });
                setRefresh((n) => n + 1);
              }}
            >
              <Field
                label={t('key')}
                name="key"
                required
                pattern="[a-z0-9][a-z0-9_-]*"
                maxLength={64}
              />
              <Field
                label={t('rank')}
                name="rank"
                type="number"
                min={0}
                step={1}
                required
                defaultValue="0"
              />
            </ActionForm>
          )}
          {catalog.plans
            .filter((plan) => plan.product_id === product.id)
            .map((plan) => (
              <section key={plan.id} aria-label={`${t('plan')} ${plan.key}`}>
                <h4>
                  {t('plan')}: {plan.key}
                </h4>
                <p>
                  {t('rank')}: {plan.upgrade_rank} · {t('version')}: {plan.version}
                </p>
                {can('catalog:write') && (
                  <>
                    {!catalog.revisions.some(
                      (item) => item.plan_id === plan.id && item.state !== 'DRAFT',
                    ) && (
                      <ActionForm
                        title={`${t('saveRank')}: ${plan.key}`}
                        submit={t('saveRank')}
                        onSubmit={async (form) => {
                          await api.request(`${base}/plans/${encodeURIComponent(plan.id)}`, {
                            method: 'PUT',
                            body: attempts.current.body(`rank:${plan.id}`, {
                              expected_version: plan.version,
                              upgrade_rank: Number(value(form, 'rank')),
                            }),
                          });
                          setRefresh((n) => n + 1);
                        }}
                      >
                        <Field
                          label={t('rank')}
                          name="rank"
                          type="number"
                          min={0}
                          step={1}
                          required
                          defaultValue={plan.upgrade_rank}
                        />
                      </ActionForm>
                    )}
                    {!catalog.revisions.some(
                      (item) => item.plan_id === plan.id && item.state === 'DRAFT',
                    ) && (
                      <ActionButton
                        action={async () => {
                          updateRevision(
                            await api.request<PlanRevision>(
                              `${base}/plans/${encodeURIComponent(plan.id)}/drafts`,
                              {
                                method: 'POST',
                                body: attempts.current.body(`draft:${plan.id}`, {
                                  expected_version: plan.version,
                                }),
                              },
                            ),
                          );
                          setRefresh((n) => n + 1);
                        }}
                      >
                        {t('newDraft')}
                      </ActionButton>
                    )}
                  </>
                )}
                <ul>
                  {catalog.revisions
                    .filter((item) => item.plan_id === plan.id)
                    .map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setRevision(item);
                            setPreview(null);
                          }}
                        >
                          {item.name[locale] || plan.key} ·{' '}
                          {t(adminStatusKeys[item.state] ?? 'unknown')} · {t('version')}{' '}
                          {item.version}
                        </button>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
        </article>
      ))}
      {revision && (
        <article className="card" aria-label={t('revision')}>
          <h3>{revision.name[locale] || t('revision')}</h3>
          <p>
            {t(adminStatusKeys[revision.state] ?? 'unknown')} · {t('version')} {revision.version}
          </p>
          {revision.state === 'DRAFT' && can('catalog:write') ? (
            <DraftEditor
              key={`${revision.id}:${revision.version}`}
              revision={revision}
              saved={updateRevision}
            />
          ) : (
            <>
              {revision.state === 'PUBLISHED' && <p>{t('immutable')}</p>}
              <RevisionPreview revision={revision} />
            </>
          )}
          {revision.state === 'DRAFT' && (
            <>
              <p>{t('previewNote')}</p>
              {can('catalog:write') && (
                <ActionButton action={() => mutateRevision('preview')}>{t('preview')}</ActionButton>
              )}
              {can('catalog:publish') && (
                <ActionButton action={() => mutateRevision('publish')}>{t('publish')}</ActionButton>
              )}
            </>
          )}
          {revision.state === 'PUBLISHED' && can('catalog:publish') && (
            <ActionButton danger action={() => mutateRevision('archive')}>
              {t('archive')}
            </ActionButton>
          )}
          {preview && (
            <section aria-label={t('preview')}>
              <h4>{t('preview')}</h4>
              <RevisionPreview revision={preview} />
            </section>
          )}
        </article>
      )}
    </section>
  );
}
function RevisionPreview({ revision }: { revision: PlanRevision }) {
  const t = useText(messages);
  const { locale } = useI18n();
  return (
    <>
      <h4>{revision.name[locale]}</h4>
      <p style={{ whiteSpace: 'pre-wrap' }}>{revision.description[locale]}</p>
      <ul>
        {revision.features.map((feature) => (
          <li key={feature.key}>{feature.label[locale]}</li>
        ))}
      </ul>
      <h4>{t('offers')}</h4>
      <ul>
        {revision.offers.map((offer) => (
          <li key={offer.id}>
            {offer.duration_days} {t('days')} · {offer.price} {offer.currency}
          </li>
        ))}
      </ul>
    </>
  );
}
function DraftEditor({
  revision,
  saved,
}: {
  revision: PlanRevision;
  saved: (next: PlanRevision) => void;
}) {
  const t = useText(messages);
  const attempts = useRef(new CommandAttempts());
  const [features, setFeatures] = useState(
    revision.features.map((feature) => ({ ...feature, label: { ...feature.label } })),
  );
  const [offers, setOffers] = useState<
    { id?: string; duration_days: number; price: string; currency: 'USDT' }[]
  >(
    revision.offers.map(({ id, duration_days, price }) => ({
      id,
      duration_days,
      price,
      currency: 'USDT',
    })),
  );
  return (
    <ActionForm
      title={t('editDraft')}
      submit={t('saveDraft')}
      onSubmit={async (form) => {
        const next = await api.request<PlanRevision>(
          `${base}/revisions/${encodeURIComponent(revision.id)}`,
          {
            method: 'PUT',
            body: attempts.current.body(revision.id, {
              expected_version: revision.version,
              name: { en: value(form, 'nameEn'), ru: value(form, 'nameRu') },
              description: { en: value(form, 'descriptionEn'), ru: value(form, 'descriptionRu') },
              features,
              offers,
            }),
          },
        );
        saved(next);
        return t('saved');
      }}
    >
      <Field
        label={t('nameEn')}
        name="nameEn"
        required
        maxLength={160}
        defaultValue={revision.name.en}
      />
      <Field
        label={t('nameRu')}
        name="nameRu"
        required
        maxLength={160}
        defaultValue={revision.name.ru}
      />
      <label className="field">
        <span>{t('descriptionEn')}</span>
        <textarea
          name="descriptionEn"
          required
          maxLength={8000}
          defaultValue={revision.description.en}
        />
      </label>
      <label className="field">
        <span>{t('descriptionRu')}</span>
        <textarea
          name="descriptionRu"
          required
          maxLength={8000}
          defaultValue={revision.description.ru}
        />
      </label>
      <h4>{t('features')}</h4>
      {features.map((feature, index) => (
        <fieldset key={index}>
          <legend>
            {t('features')} {index + 1}
          </legend>
          <Field
            label={t('featureKey')}
            required
            maxLength={64}
            pattern="[a-z0-9][a-z0-9_-]*"
            value={feature.key}
            onChange={(event) =>
              setFeatures((items) =>
                items.map((item, i) => (i === index ? { ...item, key: event.target.value } : item)),
              )
            }
          />
          {(['en', 'ru'] as const).map((language) => (
            <Field
              key={language}
              label={t(language === 'en' ? 'labelEn' : 'labelRu')}
              required
              maxLength={160}
              value={feature.label[language]}
              onChange={(event) =>
                setFeatures((items) =>
                  items.map((item, i) =>
                    i === index
                      ? { ...item, label: { ...item.label, [language]: event.target.value } }
                      : item,
                  ),
                )
              }
            />
          ))}
          <button
            type="button"
            onClick={() => setFeatures((items) => items.filter((_, i) => i !== index))}
          >
            {t('remove')}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={features.length >= 128}
        onClick={() => setFeatures((items) => [...items, { key: '', label: { en: '', ru: '' } }])}
      >
        {t('addFeature')}
      </button>
      <h4>{t('offers')}</h4>
      {offers.map((offer, index) => (
        <fieldset key={index}>
          <legend>
            {t('offers')} {index + 1}
          </legend>
          <Field
            label={t('days')}
            type="number"
            min={1}
            max={3650}
            step={1}
            required
            value={offer.duration_days || ''}
            onChange={(event) =>
              setOffers((items) =>
                items.map((item, i) =>
                  i === index ? { ...item, duration_days: Number(event.target.value) } : item,
                ),
              )
            }
          />
          <Field
            label={t('price')}
            inputMode="decimal"
            pattern="[0-9]+[.][0-9]{6}"
            required
            value={offer.price}
            onChange={(event) =>
              setOffers((items) =>
                items.map((item, i) =>
                  i === index ? { ...item, price: event.target.value } : item,
                ),
              )
            }
          />
          <button
            type="button"
            onClick={() => setOffers((items) => items.filter((_, i) => i !== index))}
          >
            {t('remove')}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={offers.length >= 64}
        onClick={() =>
          setOffers((items) => [...items, { duration_days: 30, price: '', currency: 'USDT' }])
        }
      >
        {t('addOffer')}
      </button>
    </ActionForm>
  );
}
