// ESLint flat config (v9+): built on the typescript-eslint recommended set,
// with stylistic rules that conflict with Prettier disabled (formatting belongs to Prettier).
import eslint from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Ignore build output and dependencies
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },

  // Base rules (vanilla JS recommended set)
  eslint.configs.recommended,
  // TypeScript recommended set (no type-aware checks, so no type-checking overhead)
  tseslint.configs.recommended,

  {
    rules: {
      // The project values "clear code, complete comments, easy to learn from";
      // mandating JSDoc everywhere would be noise. Keep no-unused-vars with
      // more lenient parameter conventions instead.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Allow unawaited void-returning Promises (common in Express handlers)
      '@typescript-eslint/no-misused-promises': 'off',
      'no-console': ['warn', { allow: ['error', 'warn'] }],
    },
  },

  // Enable the Prettier compat layer last; it turns off all purely cosmetic rules
  eslintConfigPrettier,
)
