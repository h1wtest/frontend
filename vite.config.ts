import { readFileSync } from 'node:fs';
import { Agent } from 'node:https';
import { createSecureContext } from 'node:tls';
import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, isPreview }) => {
  let proxy: Record<string, ProxyOptions> | undefined;
  if (command === 'serve' && !isPreview && process.env.VITEST !== 'true') {
    const caFile = process.env.SSO_CA_FILE;
    if (!caFile) {
      throw new Error(
        'SSO_CA_FILE is required for npm run dev: provide the local HTTPS gateway CA PEM file.',
      );
    }
    let ca: Buffer;
    try {
      ca = readFileSync(caFile);
      createSecureContext({ ca });
    } catch (cause) {
      throw new Error('SSO_CA_FILE must point to a readable valid CA PEM file.', { cause });
    }
    const agent = new Agent({ ca, rejectUnauthorized: true });
    const gateway: ProxyOptions = {
      target: 'https://localhost:8448',
      agent,
      secure: true,
      changeOrigin: true,
      proxyTimeout: 15000,
      timeout: 15000,
    };
    proxy = { '/api': gateway, '/oauth': gateway, '/.well-known': gateway };
  }
  return {
    plugins: [react()],
    build: { target: 'es2022', sourcemap: false },
    server: { port: 3000, strictPort: true, proxy },
  };
});
