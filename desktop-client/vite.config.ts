import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri expects a fixed dev-server port and works best with these settings.
// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves project sites from /<repository-name>/, while local
  // development and most other hosts use /. The deployment workflow sets
  // VITE_BASE_PATH automatically; keeping the default preserves Tauri/local.
  base: process.env.VITE_BASE_PATH ?? '/',
  clearScreen: false,
  server: {
    host: true, // listen on 0.0.0.0 — lets others on your network open http://<your-lan-ip>:1420 directly in a browser, no install
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
});
