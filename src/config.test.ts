// SPDX-License-Identifier: MIT
import { expect, it } from 'vitest';
import { readPublicConfig } from './config';
it('accepts public branding without changing API or identity origin', () => {
  const config = readPublicConfig(
    {
      brand: { name: 'Example', logo_url: '/brand.svg', help_url: 'https://help.example.invalid' },
      locales: ['en', 'ru'],
      default_locale: 'ru',
      canonical_origin: 'https://localhost:8448',
    },
    'https://localhost:8448',
  );
  expect(config.brand.name).toBe('Example');
  expect(config.default_locale).toBe('ru');
});
it('rejects executable links and cross-origin deployment configuration', () => {
  expect(() =>
    readPublicConfig(
      {
        brand: { name: 'X', logo_url: 'javascript:alert(1)' },
        canonical_origin: 'https://localhost:8448',
      },
      'https://localhost:8448',
    ),
  ).toThrow();
  expect(() =>
    readPublicConfig(
      { brand: { name: 'X' }, canonical_origin: 'https://other.invalid' },
      'https://localhost:8448',
    ),
  ).toThrow();
});
it('uses the actual isolated deployment origin when no canonical origin is supplied', () => {
  expect(
    readPublicConfig(
      { brand: { name: 'Isolated Platform' }, locales: ['en', 'ru'] },
      'https://localhost:18448',
    ).canonical_origin,
  ).toBe('https://localhost:18448');
});
