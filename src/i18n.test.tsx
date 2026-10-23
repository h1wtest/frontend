// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from './api';
import { I18nProvider, useI18n, useText, money, resolveLocale } from './i18n';

afterEach(cleanup);
const messages = { title: { en: 'Settings', ru: 'Настройки' } };
function Example() {
  const { locale, setLocale, error } = useI18n();
  const text = useText(messages);
  return (
    <>
      <h2>{text('title')}</h2>
      <input aria-label="draft" defaultValue="unsaved" />
      <button onClick={() => setLocale(locale === 'en' ? 'ru' : 'en')}>switch</button>
      <p role="alert">
        {error(new ApiError('PRIVATE PROVIDER EVIDENCE', 409, 'version_conflict'))}
      </p>
    </>
  );
}
it('switches resources without discarding an unfinished form or rendering provider errors', () => {
  render(
    <I18nProvider initialLocale="en">
      <Example />
    </I18nProvider>,
  );
  fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'keep draft' } });
  fireEvent.click(screen.getByText('switch'));
  expect(screen.getByRole('heading').textContent).toBe('Настройки');
  expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('keep draft');
  expect(screen.getByRole('alert').textContent).toContain('измен');
  expect(screen.queryByText('PRIVATE PROVIDER EVIDENCE')).toBeNull();
});
it('falls back to English for unsupported locale and formats exact money without float rounding', () => {
  expect(resolveLocale('ru-RU')).toBe('ru');
  expect(resolveLocale('de-DE')).toBe('en');
  expect(money('9007199254740993.000001', 'en')).toBe('9,007,199,254,740,993.000001 USDT');
  expect(money('0.000001', 'ru')).toBe('0,000001 USDT');
});
