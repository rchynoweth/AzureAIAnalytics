import react from '@vitejs/plugin-react';
import { rayfinLocalDev } from '@microsoft/rayfin-local-dev/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const backend = loadEnv(mode, process.cwd(), 'VITE_').VITE_RAYFIN_API_URL;
  return {
    // rayfinLocalDev brokers the Rayfin CLI sign-in on the dev server.
    // It is a dev-server plugin only; nothing from it ships in the production build.
    plugins: [react(), rayfinLocalDev({ autoLogin: true })],
    // Dev only: after a deploy, send function calls to the deployed functions, so local
    // development works without the local Azure Functions host (`npm run dev:fabric`).
    server: backend ? { proxy: { '/functions': { target: backend, changeOrigin: true } } } : {},
    // The largest chunk is the lazy-loaded synthetic fixture file (~75 kB gzipped).
    build: { sourcemap: false, chunkSizeWarningLimit: 800 },
    test: { include: ['src/**/*.test.{ts,tsx}'] },
  };
});
