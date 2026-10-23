// SPDX-License-Identifier: MIT
import { useState } from 'react';
import { api } from './api';
import { canAdmin, type AuthSession } from './auth';
import { ActionButton, ActionForm, Field, Time, value } from './components';
import { useText } from './i18n';
interface Quarantine {
  id: string;
  owner: 'notification' | 'profile' | 'audit';
  topic: string;
  partition: number;
  offset: number;
  reason: string;
  created_at: string;
  replayed_at: string | null;
}
const messages = {
  title: { en: 'Event quarantine', ru: 'Карантин событий' },
  note: {
    en: 'Metadata only. Resolve the owner-side failure before replaying; invalid events stay quarantined.',
    ru: 'Только метаданные. Перед повтором устраните причину у владельца; некорректные события останутся в карантине.',
  },
  load: { en: 'Refresh quarantine', ru: 'Обновить карантин' },
  empty: { en: 'Quarantine is empty.', ru: 'Карантин пуст.' },
  replay: { en: 'Replay event', ru: 'Повторить событие' },
  reason: { en: 'Reason and resolution', ru: 'Причина и исправление' },
  replayed: { en: 'Replayed', ru: 'Повторено' },
};
export function QuarantinePanel({ auth }: { auth: AuthSession }) {
  const text = useText(messages);
  const [records, setRecords] = useState<Quarantine[]>();
  async function load() {
    const result = await Promise.all(
      ['notification', 'profile', 'audit'].map((owner) =>
        api.request<Quarantine[]>('/api/v1/admin/quarantine?owner=' + owner),
      ),
    );
    setRecords(result.flat());
  }
  if (!canAdmin(auth.user, 'notifications:read')) return null;
  return (
    <section className="card">
      <h3>{text('title')}</h3>
      <p className="muted">{text('note')}</p>
      <ActionButton action={load}>{text('load')}</ActionButton>
      {records?.length === 0 && <p>{text('empty')}</p>}
      <ul className="records">
        {records?.map((item) => (
          <li key={item.owner + item.id}>
            <strong>
              {item.owner}: {item.topic}
            </strong>
            <code>{item.id}</code>
            <span>
              {item.partition} / {item.offset}
            </span>
            <p>{item.reason}</p>
            <Time value={item.created_at} />
            {item.replayed_at ? (
              <span>
                {text('replayed')}: <Time value={item.replayed_at} />
              </span>
            ) : (
              canAdmin(auth.user, 'notifications:replay') && (
                <ActionForm
                  submit={text('replay')}
                  onSubmit={async (form) => {
                    await api.request(
                      '/api/v1/admin/quarantine/' +
                        encodeURIComponent(item.id) +
                        '/replay?owner=' +
                        item.owner,
                      { method: 'POST', body: { reason: value(form, 'reason') } },
                    );
                    await load();
                  }}
                >
                  <Field
                    label={text('reason')}
                    name="reason"
                    required
                    minLength={3}
                    maxLength={500}
                  />
                </ActionForm>
              )
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
