import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022', sourcemap: false },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api/v1/auth': 'http://localhost:8001',
      '/oauth': 'http://localhost:8001',
      '/.well-known': 'http://localhost:8001',
      '/api/v1/users': 'http://localhost:8002',
      '/api/v1/notifications': 'http://localhost:8003',
      '/api/v1/admin': 'http://localhost:8004',
    },
  },
});
