import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'drizzle/**', 'data*/**', 'playwright-report/**', 'test-results/**'] },
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'shared', pattern: 'src/shared/**' },
        { type: 'domain', pattern: 'src/domain/**' },
        { type: 'server', pattern: 'src/server/**' },
        { type: 'client', pattern: 'src/client/**' },
      ],
    },
    rules: {
      // shared + domain are pure and portable; client never imports server code and vice versa.
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            { from: { element: { type: 'shared' } }, allow: [{ to: { element: { type: 'shared' } } }] },
            { from: { element: { type: 'domain' } }, allow: [{ to: { element: { type: 'shared' } } }, { to: { element: { type: 'domain' } } }] },
            { from: { element: { type: 'server' } }, allow: [{ to: { element: { type: 'shared' } } }, { to: { element: { type: 'domain' } } }, { to: { element: { type: 'server' } } }] },
            { from: { element: { type: 'client' } }, allow: [{ to: { element: { type: 'shared' } } }, { to: { element: { type: 'domain' } } }, { to: { element: { type: 'client' } } }] },
          ],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
