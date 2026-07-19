import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true, // bind 0.0.0.0 — also enabled via `--host` for clarity
    // Forward /api/* to the Express server when testing web mode
    // (run `npm run dev:server` alongside this). Electron mode never
    // hits these — it talks over IPC via window.flux instead.
    proxy: {
      // Regex with trailing slash — must NOT match /api.js (our own
      // src/renderer/api.js module, served at that path by Vite). A plain
      // '/api' prefix match would intercept that file request and proxy it
      // to the (often not running) Express server, causing ECONNREFUSED
      // and a blank app.
      '^/api/': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
