import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The personal student page (S10) is its own small entry (student.html), served by the server at
 * `/s`; the Super Speakers scorer app (scorer.html at `/p` and `/p/app`) and board (board.html at
 * `/board`, S12) likewise. In development the same paths are rewritten to the entries here.
 */
const studentPageInDev = (): Plugin => ({
  name: 'cc-student-page',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/s' || req.url?.startsWith('/s?')) req.url = `/student.html${req.url.slice(2)}`;
      // Super Speakers (S12): the scorer link page, the installed scorer app and the board.
      else if (req.url && /^\/(?:p|p\/app)(?:\?|$)/u.test(req.url)) req.url = `/scorer.html${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
      else if (req.url && /^\/board(?:\?|$)/u.test(req.url)) req.url = `/board.html${req.url.slice('/board'.length)}`;
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
        scorer: fileURLToPath(new URL('./scorer.html', import.meta.url)),
        board: fileURLToPath(new URL('./board.html', import.meta.url)),
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
      // The board's Server-Sent Events stream passes through unbuffered (D-134): the proxy keeps the
      // connection open (no timeout) and never compresses or buffers `text/event-stream`.
      '/api': {
        target: 'http://127.0.0.1:3210',
        changeOrigin: false,
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyRes', (res) => {
            if (String(res.headers['content-type'] ?? '').startsWith('text/event-stream')) res.headers['cache-control'] = 'no-store, no-transform';
          });
        },
      },
      '/healthz': 'http://127.0.0.1:3210',
    },
  },
});
