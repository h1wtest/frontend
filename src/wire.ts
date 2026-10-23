// SPDX-License-Identifier: MIT
import { schema } from './generated/businessv1';
import { parseStrictJSON, validate } from './generated/validation';
interface Operation {
  method: string;
  path: string;
  request?: string;
  response: string;
}
const operations: readonly Operation[] = schema['x-endpoints'];
function operationFor(path: string, method: string) {
  const pathname = path.split('?')[0];
  return operations.find(
    (operation) =>
      operation.method === method &&
      new RegExp(
        '^' +
          operation.path
            .split('/')
            .map((part) =>
              part.startsWith('{') && part.endsWith('}')
                ? '[^/]+'
                : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            )
            .join('/') +
          '$',
      ).test(pathname),
  );
}
export function validateCommand(path: string, method: string, body: unknown) {
  const operation = operationFor(path, method);
  if (!operation) return;
  if (operation.request) validate(schema, operation.request, body);
  else if (body !== undefined) throw new TypeError('unexpected_command_body');
}
export function decodeWire(path: string, method: string, text: string): unknown {
  const decoded = parseStrictJSON(text);
  const operation = operationFor(path, method);
  if (operation) validate(schema, operation.response, decoded);
  return decoded;
}
