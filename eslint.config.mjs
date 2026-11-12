import gts from 'gts';

export default [
  {
    ignores: [
      '.isolated/**',
      '.forgeops/**',
      'build/**',
      'dist/**',
      'dist-renderer/**',
      'release/**',
      'renderer/dist/**',
      'node_modules/**',
    ],
  },
  ...gts,
  {
    files: ['renderer/src/**/*.{ts,tsx}', 'renderer/vite.config.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.renderer.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/**/*.ts', 'verify/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            {
              from: 'package',
              package: 'node:test',
              name: [
                'describe',
                'it',
                'test',
                'before',
                'after',
                'beforeEach',
                'afterEach',
              ],
            },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'n/no-unsupported-features/node-builtins': 'off',
    },
  },
];
