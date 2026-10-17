import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: Vite serves the UI on 5317 and proxies /api to the Mindscape server on 4317.
// Build: output goes to dist/ui, which the server serves directly.
export default defineConfig({
  root: 'ui',
  plugins: [react()],
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
    // CodeMirror is ~500 kB but loads only when notes are first edited.
    chunkSizeWarningLimit: 800,
  },
  server: {
    host: '127.0.0.1',
    port: 5317,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4317',
    },
  },
});
