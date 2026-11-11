import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    // S23a (D-182): the staff dictionary, as every entry except the student page registers it.
    setupFiles: ['tests/setup.ts'],
    pool: 'forks',
    testTimeout: 20000,
  },
});
