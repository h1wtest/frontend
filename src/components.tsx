import React, { useId, useState } from 'react';
export function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} {...props} />
    </label>
  );
}
export function ActionForm({
  title,
  submit,
  children,
  onSubmit,
  danger = false,
}: {
  title?: string;
  submit: string;
  children?: React.ReactNode;
  onSubmit: (data: FormData) => Promise<string | void>;
  danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  return (
    <form
      aria-label={title ?? submit}
      aria-busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setFeedback(null);
        try {
          const message = await onSubmit(data);
          setFeedback({ error: false, text: message ?? 'Изменения сохранены.' });
        } catch (error) {
          setFeedback({
            error: true,
            text: error instanceof Error ? error.message : 'Не удалось выполнить запрос',
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      {title && <h3>{title}</h3>}
      <fieldset disabled={busy}>
        {children}
        <button className={danger ? 'danger' : 'primary'} type="submit">
          {busy ? 'Выполняется…' : submit}
        </button>
      </fieldset>
      {feedback && (
        <p
          role={feedback.error ? 'alert' : 'status'}
          className={feedback.error ? 'error' : 'success'}
        >
          {feedback.text}
        </p>
      )}
    </form>
  );
}
export function ActionButton({
  children,
  action,
  danger = false,
}: {
  children: React.ReactNode;
  action: () => Promise<unknown>;
  danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <span className="action">
      <button
        type="button"
        className={danger ? 'danger' : ''}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await action();
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Ошибка запроса');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Выполняется…' : children}
      </button>
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </span>
  );
}
export const value = (form: FormData, name: string) => String(form.get(name) ?? '');
export function Time({ value: timestamp }: { value?: string }) {
  return (
    <time dateTime={timestamp}>
      {timestamp ? new Date(timestamp).toLocaleString('ru-RU') : '—'}
    </time>
  );
}
