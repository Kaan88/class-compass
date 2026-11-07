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
      // Validation + offline storage libraries, and the accessible UI primitives, in their own
      // long-cached chunks (keeps every chunk < 500 kB; S9 added the importer page).
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-data', test: /node_modules[\\/](zod|dexie)[\\/]/ },
            { name: 'vendor-ui', test: /node_modules[\\/](react-aria|react-aria-components|react-stately|@react-aria|@react-stately|@react-types|@internationalized)[\\/]/ },
          ],
        },
      },
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
