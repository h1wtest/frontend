import React, { useId, useRef, useEffect, useState } from 'react';
import { useI18n, useText } from './i18n';
const messages = {
  saved: { en: 'Changes saved.', ru: 'Изменения сохранены.' },
  working: { en: 'Working…', ru: 'Выполняется…' },
};
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
  const text = useText(messages);
  const { error: localError } = useI18n();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    error: boolean;
    text?: string;
    cause?: unknown;
  } | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
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
          if (active.current) setFeedback({ error: false, text: message ?? undefined });
        } catch (error) {
          if (active.current) setFeedback({ error: true, cause: error });
        } finally {
          if (active.current) setBusy(false);
        }
      }}
    >
      {title && <h3>{title}</h3>}
      <fieldset disabled={busy}>
        {children}
        <button className={danger ? 'danger' : 'primary'} type="submit">
          {busy ? text('working') : submit}
        </button>
      </fieldset>
      {feedback && (
        <p
          role={feedback.error ? 'alert' : 'status'}
          className={feedback.error ? 'error' : 'success'}
        >
          {feedback.error ? localError(feedback.cause) : (feedback.text ?? text('saved'))}
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
  const text = useText(messages);
  const { error: localError } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ cause: unknown }>();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return (
    <span className="action">
      <button
        type="button"
        className={danger ? 'danger' : ''}
        disabled={busy}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          setFailure(undefined);
          try {
            await action();
          } catch (error) {
            if (active.current) setFailure({ cause: error });
          } finally {
            if (active.current) setBusy(false);
          }
        }}
      >
        {busy ? text('working') : children}
      </button>
      {failure && (
        <span role="alert" className="error">
          {localError(failure.cause)}
        </span>
      )}
    </span>
  );
}
export const value = (form: FormData, name: string) => String(form.get(name) ?? '');
export function Time({ value: timestamp }: { value?: string | null }) {
  const { locale } = useI18n();
  const date = timestamp ? new Date(timestamp) : null;
  return (
    <time dateTime={timestamp ?? undefined}>
      {date && !Number.isNaN(date.getTime())
        ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
        : '—'}
    </time>
  );
}
