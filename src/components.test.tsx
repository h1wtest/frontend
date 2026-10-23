// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ActionForm } from './components';
import { ApiError } from './api';
import { I18nProvider, useI18n } from './i18n';
afterEach(cleanup);
function Form() {
  const { setLocale } = useI18n();
  return (
    <>
      <button onClick={() => setLocale('ru')}>Russian</button>
      <ActionForm
        submit="Save"
        onSubmit={async () => {
          throw new ApiError('PRIVATE EVIDENCE', 403, 'forbidden');
        }}
      />
    </>
  );
}
it('relocalizes a visible API error without exposing raw server evidence', async () => {
  render(
    <I18nProvider initialLocale="en">
      <Form />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Permission denied');
  fireEvent.click(screen.getByText('Russian'));
  expect(screen.getByRole('alert').textContent).toContain('Доступ запрещён');
  expect(screen.queryByText('PRIVATE EVIDENCE')).toBeNull();
});
