// SPDX-License-Identifier: MIT
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contracts = resolve(process.argv[2] ?? resolve(root, '../platform-contracts'));
const destination = resolve(root, 'src/generated');
await mkdir(destination, { recursive: true });
const hashes = [];
for (const name of ['businessv1.ts', 'validation.ts']) {
  const source = resolve(contracts, 'gen/typescript', name);
  const bytes = await readFile(source);
  await copyFile(source, resolve(destination, name));
  hashes.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
}
await writeFile(resolve(root, 'contracts-types.sha256'), hashes.join('\n') + '\n');
