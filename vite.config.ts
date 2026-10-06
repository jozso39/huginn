import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The SPA lives in web/ and is built into web/dist, which the Bun server serves as
// static files. In development `bun run dev:web` proxies /api to the Bun server.
// Its favicon and logo come from icons/web, with every other image of Huginn.
export default defineConfig({
  root: 'web',
  publicDir: '../icons/web',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
});
