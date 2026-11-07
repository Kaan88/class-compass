import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
    rolldownOptions: {
      // Validation + offline storage libraries in their own long-cached chunk (keeps chunks < 500 kB).
      output: { codeSplitting: { groups: [{ name: 'vendor-data', test: /node_modules[\\/](zod|dexie)[\\/]/ }] } },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3210', changeOrigin: false },
      '/healthz': 'http://127.0.0.1:3210',
    },
  },
});
