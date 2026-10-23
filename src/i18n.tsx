// SPDX-License-Identifier: MIT
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from './api';

export type Locale = 'en' | 'ru';
export type Messages = Record<string, { en: string; ru: string }>;
export function resolveLocale(value?: string | null): Locale {
  return value?.toLowerCase().split(/[-_]/)[0] === 'ru' ? 'ru' : 'en';
}
const errors: Messages = {
  request_failed: {
    en: 'The request could not be completed. Please try again.',
    ru: 'Не удалось выполнить запрос. Повторите попытку.',
  },
  unauthenticated: {
    en: 'Your session has expired. Sign in again.',
    ru: 'Сессия истекла. Войдите снова.',
  },
  access_denied: {
    en: 'Permission denied. Check your permissions and confirm your identity in Security.',
    ru: 'Доступ запрещён. Проверьте права и подтвердите личность в разделе «Безопасность».',
  },
  version_conflict: {
    en: 'This record changed. Refresh it and review your changes before trying again.',
    ru: 'Запись изменилась. Обновите данные и проверьте изменения перед повтором.',
  },
  dependency_unavailable: {
    en: 'The service is temporarily unavailable. Your operation has not been confirmed.',
    ru: 'Сервис временно недоступен. Выполнение операции не подтверждено.',
  },
  invalid_request: {
    en: 'Check the entered values and try again.',
    ru: 'Проверьте введённые значения и повторите попытку.',
  },
  auth_context_changed: {
    en: 'The signed-in account changed. Reload before continuing.',
    ru: 'Аккаунт изменился. Обновите данные перед продолжением.',
  },
  idempotency_conflict: {
    en: 'This operation key was already used with different values. Refresh the operation.',
    ru: 'Ключ операции уже использован с другими значениями. Обновите операцию.',
  },
  invalid_catalog: {
    en: 'Both languages, valid offers and unique feature keys are required.',
    ru: 'Укажите оба языка, корректные предложения и уникальные ключи возможностей.',
  },
  immutable_revision: {
    en: 'Published revisions cannot be edited. Create a new draft.',
    ru: 'Опубликованную версию нельзя изменять. Создайте новый черновик.',
  },
  draft_exists: {
    en: 'This plan already has a draft. Open the existing draft.',
    ru: 'У тарифа уже есть черновик. Откройте его.',
  },
  duplicate_key: { en: 'This key is already in use.', ru: 'Этот ключ уже используется.' },
  not_found: { en: 'The requested record was not found.', ru: 'Запись не найдена.' },
  invalid_address: {
    en: 'Enter a valid wallet address for the selected network.',
    ru: 'Введите корректный адрес кошелька для выбранной сети.',
  },
  invalid_network: { en: 'Select a supported network.', ru: 'Выберите поддерживаемую сеть.' },
  insufficient_balance: {
    en: 'There is no available balance for this payout.',
    ru: 'Доступного баланса для выплаты недостаточно.',
  },
  payout_already_decided: {
    en: 'This payout has already been decided. Refresh the record.',
    ru: 'По выплате уже принято решение. Обновите запись.',
  },
  telegram_link_required: {
    en: 'Confirm your Telegram link before enabling this channel.',
    ru: 'Подтвердите привязку Telegram перед включением канала.',
  },
  invalid_template: {
    en: 'Check both template languages and required variables.',
    ru: 'Проверьте оба языка шаблона и обязательные переменные.',
  },
  unknown_template_variable: {
    en: 'The template contains an unsupported variable.',
    ru: 'Шаблон содержит неподдерживаемую переменную.',
  },
  unsafe_template_url: {
    en: 'The template contains an unsafe link.',
    ru: 'Шаблон содержит небезопасную ссылку.',
  },
  reauth_required: {
    en: 'Confirm your password and MFA in Security, then retry.',
    ru: 'Подтвердите пароль и MFA в разделе «Безопасность» и повторите действие.',
  },
  mfa_required: {
    en: 'A fresh MFA confirmation is required in Security.',
    ru: 'Требуется свежее подтверждение MFA в разделе «Безопасность».',
  },
  last_owner: {
    en: 'The last active OWNER cannot be removed or disabled.',
    ru: 'Нельзя удалить или отключить последнего активного OWNER.',
  },
  invalid_referral_code: {
    en: 'The referral code is invalid.',
    ru: 'Реферальный код недействителен.',
  },
  quote_expired: {
    en: 'The quote expired. Request a new quote before paying.',
    ru: 'Расчёт доплаты истёк. Запросите новый расчёт перед оплатой.',
  },
  action_conflict: {
    en: 'Another operation is pending for this product. Open its order first.',
    ru: 'По продукту ожидает другая операция. Сначала откройте её заказ.',
  },
  invalid_credentials: {
    en: 'The credentials or verification code are invalid.',
    ru: 'Неверные учётные данные или код подтверждения.',
  },
  invalid_code: {
    en: 'The verification code is invalid or expired.',
    ru: 'Код подтверждения неверен или истёк.',
  },
  rate_limited: {
    en: 'Too many attempts. Wait before trying again.',
    ru: 'Слишком много попыток. Повторите позже.',
  },
  invalid_role: {
    en: 'Select only registered staff roles.',
    ru: 'Выберите только зарегистрированные служебные роли.',
  },
  invalid_permission: {
    en: 'Select only permissions from the server catalog.',
    ru: 'Выберите права только из серверного каталога.',
  },
  reason_required: {
    en: 'Enter a reason for this administrative action.',
    ru: 'Укажите причину административного действия.',
  },
  owner_permissions_immutable: {
    en: 'OWNER authority cannot be reassigned through the permission editor.',
    ru: 'Полномочия OWNER нельзя переназначить через редактор прав.',
  },
  invalid_redirect_uri: {
    en: 'Use exact HTTPS redirects without credentials, fragments or wildcards.',
    ru: 'Укажите точные HTTPS-адреса возврата без учётных данных, фрагментов и шаблонов.',
  },
  invalid_scope: {
    en: 'Select only supported OAuth scopes.',
    ru: 'Выберите только поддерживаемые OAuth scopes.',
  },
  invalid_locale: { en: 'Select a supported language.', ru: 'Выберите поддерживаемый язык.' },
  client_conflict: {
    en: 'The OAuth client changed or is already registered. Refresh the list.',
    ru: 'OAuth-клиент изменился или уже зарегистрирован. Обновите список.',
  },
  consent_expired: {
    en: 'The consent request expired. Restart authorization in the requesting application.',
    ru: 'Запрос согласия истёк. Начните авторизацию заново в приложении.',
  },
  invalid_consent: {
    en: 'This consent request does not belong to the current session.',
    ru: 'Запрос согласия не принадлежит текущей сессии.',
  },
  invalid_evidence: {
    en: 'Enter complete monetary evidence: amount, network and external reference.',
    ru: 'Укажите полное денежное подтверждение: сумму, сеть и внешний идентификатор.',
  },
  invalid_state: {
    en: 'This operation is not allowed in the current state. Refresh the record.',
    ru: 'Операция недопустима в текущем состоянии. Обновите запись.',
  },
  payment_not_unpaid: {
    en: 'The payment is not proven unpaid and cannot be cancelled. Review its current status.',
    ru: 'Отсутствие оплаты не подтверждено, отмена невозможна. Проверьте текущий статус.',
  },
  incompatible_offer: {
    en: 'This offer is not compatible with the current plan, duration or direction of change.',
    ru: 'Предложение несовместимо с текущим тарифом, сроком или направлением смены.',
  },
};
const aliases: Record<string, string> = {
  forbidden: 'access_denied',
  unauthorized: 'unauthenticated',
  identity_unavailable: 'dependency_unavailable',
  database_unavailable: 'dependency_unavailable',
  service_unavailable: 'dependency_unavailable',
  invalid_password: 'invalid_credentials',
  invalid_mfa_code: 'invalid_code',
  reauthentication_required: 'reauth_required',
  fresh_mfa_required: 'mfa_required',
  last_owner_required: 'last_owner',
  active_action_exists: 'action_conflict',
  pending_action_exists: 'action_conflict',
  referral_code_invalid: 'invalid_referral_code',
  too_many_requests: 'rate_limited',
};
function localizedError(error: unknown, locale: Locale): string {
  const code = error instanceof ApiError ? error.code : '';
  const known = errors[aliases[code] ?? code];
  if (known) return known[locale];
  if (error instanceof ApiError) {
    if (error.status === 401) return errors.unauthenticated[locale];
    if (error.status === 403) return errors.access_denied[locale];
    if (error.status === 409) return errors.version_conflict[locale];
    if (error.status === 429) return errors.rate_limited[locale];
    if (error.status >= 500) return errors.dependency_unavailable[locale];
    if (error.status === 400) return errors.invalid_request[locale];
  }
  return errors.request_failed[locale];
}
type I18n = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  error: (error: unknown) => string;
};
const defaultLocale = resolveLocale(globalThis.navigator?.language);
const context = createContext<I18n>({
  locale: defaultLocale,
  setLocale: () => {},
  error: (error) => localizedError(error, defaultLocale),
});
export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale ?? defaultLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo<I18n>(
    () => ({ locale, setLocale, error: (error) => localizedError(error, locale) }),
    [locale],
  );
  return <context.Provider value={value}>{children}</context.Provider>;
}
export function useI18n() {
  return useContext(context);
}
export function useText<T extends Messages>(messages: T): (key: keyof T) => string {
  const { locale } = useI18n();
  return (key) => messages[key][locale] || messages[key].en;
}
export function money(amount: string, locale: Locale, currency = 'USDT'): string {
  if (!/^-?\d+(?:\.\d+)?$/.test(amount)) return '—';
  const [integer, fraction] = amount.split('.');
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    BigInt(integer),
  );
  const separator = locale === 'ru' ? ',' : '.';
  return `${grouped}${fraction === undefined ? '' : separator + fraction} ${currency}`;
}
