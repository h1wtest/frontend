// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = await readFile(resolve(root, 'contracts-types.sha256'), 'utf8');
const seen = new Set();
for (const row of manifest.trim().split('\n')) {
  const match = /^([0-9a-f]{64})  (businessv1\.ts|validation\.ts)$/.exec(row);
  if (!match || seen.has(match[2])) throw new Error('invalid_contract_manifest');
  seen.add(match[2]);
  const bytes = await readFile(resolve(root, 'src/generated', match[2]));
  if (createHash('sha256').update(bytes).digest('hex') !== match[1]) throw new Error('stale_or_modified_generated_contracts');
}
if (seen.size !== 2) throw new Error('incomplete_contract_manifest');
