import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/target/**',
      'desktop-client/src-tauri/gen/**',
    ],
  },
  {
    files: ['desktop-client/src/**/*.{ts,tsx}'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'warn',
      'no-console': 'off',
    },
  },
  {
    files: ['shared/**/*.ts', 'signaling-server/**/*.ts', 'desktop-client/test/**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['e2e/**/*.mjs', 'scripts/**/*.mjs'],
    extends: [eslint.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-console': 'off' },
  },
);
