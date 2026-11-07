import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The personal student page (S10) is its own small entry (student.html), served by the server at
 * `/s`. In development the same path is rewritten to the entry here.
 */
const studentPageInDev = (): Plugin => ({
  name: 'cc-student-page',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/s' || req.url?.startsWith('/s?')) req.url = `/student.html${req.url.slice(2)}`;
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), studentPageInDev()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        student: fileURLToPath(new URL('./student.html', import.meta.url)),
      },
      // Validation + offline storage libraries, and the accessible UI primitives, in their own
      // long-cached chunks (keeps every chunk < 500 kB; S9 added the importer page, S10 the student entry).
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-data', test: /node_modules[\\/](zod|dexie)[\\/]/ },
            { name: 'vendor-ui', test: /node_modules[\\/](react-aria|react-aria-components|react-stately|@react-aria|@react-stately|@react-types|@internationalized)[\\/]/ },
            // S10: shared by the main app and the student page entry.
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'vendor-tanstack', test: /node_modules[\\/]@tanstack[\\/]/ },
            { name: 'i18n', test: /src[\\/]shared[\\/]i18n[\\/]/ },
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
