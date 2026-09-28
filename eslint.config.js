// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import unicorn from 'eslint-plugin-unicorn';
import noBarrelFiles from 'eslint-plugin-no-barrel-files';
import functional from 'eslint-plugin-functional';
import reactHooks from 'eslint-plugin-react-hooks';

export default defineConfig(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  /** @type {any} */ (noBarrelFiles.flat),

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { unicorn, functional },
    rules: {
      'no-param-reassign': 'error',
      'functional/immutable-data': [
        'error',
        { ignoreClasses: true, ignoreImmediateMutation: true },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        {
          accessibility: 'explicit',
          overrides: {
            accessors: 'explicit',
            constructors: 'no-public',
            methods: 'explicit',
            properties: 'explicit',
            parameterProperties: 'explicit',
          },
        },
      ],
      'unicorn/filename-case': ['error', { cases: { camelCase: true, pascalCase: true } }],
      '@typescript-eslint/parameter-properties': ['error', { prefer: 'parameter-property' }],
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'block-like', next: '*' },
        { blankLine: 'always', prev: '*', next: 'return' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
    },
  },

  // Tests: bun:test's `expect().rejects` is typed void but must be awaited, mocks lose
  // type info, and collecting events into an array is the honest way to assert on them.
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/await-thenable': 'off',
      'functional/immutable-data': 'off',
    },
  },

  // The web app is React: hooks rules, no class-accessibility noise, and it may only
  // ever talk to the server over HTTP, never import from src/.
  {
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      '@typescript-eslint/explicit-member-accessibility': 'off',
      '@typescript-eslint/parameter-properties': 'off',
      // The DOM is the one external system React code writes to directly.
      'functional/immutable-data': [
        'error',
        { ignoreClasses: true, ignoreImmediateMutation: true, ignoreAccessorPattern: ['document.title'] },
      ],
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@/*', '../../src/*'], message: 'web/ talks to the API only' }] },
      ],
    },
  },

  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Outside core: @/ aliases instead of deep relative imports.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../*', '../../../*', '../../../../*'],
              message: 'Use @/ import aliases instead of deep relative imports',
            },
          ],
        },
      ],
    },
  },

  // Core layer isolation: core never depends on infrastructure or interface.
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/infrastructure', '@/infrastructure/*', '@/infrastructure/**/*'],
              message: 'core must not import from infrastructure',
            },
            {
              group: ['@/interface', '@/interface/*', '@/interface/**/*'],
              message: 'core must not import from interface',
            },
            {
              group: ['@/dependency', '@/dependency/*', '@/dependency/**/*'],
              message: 'core must not import from dependency',
            },
            {
              group: ['../../*', '../../../*', '../../../../*'],
              message: 'Use @/ import aliases instead of deep relative imports',
            },
          ],
        },
      ],
    },
  },

  // Core tests build the real graph through createTestContainer(), which lives in
  // dependency/. Same isolation as core otherwise.
  {
    files: ['src/core/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/infrastructure', '@/infrastructure/*', '@/infrastructure/**/*'],
              message: 'core tests reach infrastructure only through createTestContainer()',
            },
            {
              group: ['@/interface', '@/interface/*', '@/interface/**/*'],
              message: 'core must not import from interface',
            },
          ],
        },
      ],
    },
  },

  prettierConfig
);
