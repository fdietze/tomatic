import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import xstate from 'eslint-plugin-xstate'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // By default, ESLint ignored `node_modules` and files/folders starting with a dot.
    // We add `dist` to that list.
    ignores: ['dist', 'eslint.config.js'],
  },
  {
    // Source files (React/Browser environment)
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      xstate,
    },
    settings: {
        'import/resolver': {
            typescript: true,
            node: true,
        },
    },
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    rules: {
        'xstate/no-infinite-loop': 'error',
        'xstate/no-imperative-action': 'error',
        'xstate/no-ondone-outside-compound-state': 'error',
        'xstate/invoke-usage': 'error',
        'xstate/entry-exit-action': 'error',
        'xstate/prefer-always': 'error',
        'xstate/prefer-predictable-action-arguments': 'error',
        'xstate/no-misplaced-on-transition': 'error',
        'xstate/no-invalid-transition-props': 'error',
        'xstate/no-invalid-state-props': 'error',
        'xstate/no-invalid-conditional-action': 'error',
        'xstate/no-async-guard': 'error',
        '@typescript-eslint/explicit-function-return-type': 'error',
        '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Config and test files (Node.js environment)
    files: [
      '*.{js,ts}',
      'tests/**/*.{ts,tsx}',
    ],
    ignores: ['src/**'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.node,
        ...globals.browser
      },
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['playwright.config.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  {
    files: ['tests/fixtures.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
);
