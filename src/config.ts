// SPDX-License-Identifier: MIT
import { resolveLocale, type Locale } from './i18n';
export interface PublicConfig {
  brand: { name: string; logo_url?: string; help_url?: string };
  locales: Locale[];
  default_locale: Locale;
  canonical_origin: string;
}
export function readPublicConfig(input: unknown, origin: string): PublicConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid_public_config');
  const data = input as Record<string, unknown>;
  const brand = data.brand as Record<string, unknown> | undefined;
  if (!brand || typeof brand.name !== 'string' || !brand.name.trim() || brand.name.length > 100)
    throw new Error('invalid_public_config');
  if (data.canonical_origin !== undefined && data.canonical_origin !== origin)
    throw new Error('invalid_public_config');
  const safeURL = (value: unknown, sameOrigin: boolean): string | undefined => {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || /[\\\r\n]/.test(value))
      throw new Error('invalid_public_config');
    const url = new URL(value, origin);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (sameOrigin && url.origin !== origin)
    )
      throw new Error('invalid_public_config');
    return sameOrigin ? url.pathname + url.search : url.href;
  };
  const locales: Locale[] = Array.isArray(data.locales)
    ? data.locales.filter((value): value is Locale => value === 'en' || value === 'ru')
    : ['en', 'ru'];
  if (!locales.includes('en') || !locales.includes('ru')) throw new Error('invalid_public_config');
  return {
    brand: {
      name: brand.name.trim(),
      logo_url: safeURL(brand.logo_url, true),
      help_url: safeURL(brand.help_url, false),
    },
    locales,
    default_locale: resolveLocale(
      typeof data.default_locale === 'string' ? data.default_locale : 'en',
    ),
    canonical_origin: origin,
  };
}
export async function loadPublicConfig(signal: AbortSignal): Promise<PublicConfig> {
  const response = await fetch('/config.json', {
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error('public_config_unavailable');
  return readPublicConfig(await response.json(), window.location.origin);
}
