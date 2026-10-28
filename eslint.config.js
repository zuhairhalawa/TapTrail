import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'e2e/.tmp', 'docs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Never inject HTML: user content is untrusted. Render text instead.',
        },
      ],
    },
  },
  {
    // The standalone viewer runtime is plain browser JS that is inlined into exports.
    files: ['src/viewer/**/*.js'],
    languageOptions: { globals: { ...globals.browser }, sourceType: 'module' },
    rules: {
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Use textContent / DOM APIs.' },
        { property: 'outerHTML', message: 'Use textContent / DOM APIs.' },
        { property: 'insertAdjacentHTML', message: 'Use DOM APIs.' },
      ],
      'no-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['public/*.js'],
    languageOptions: { globals: { ...globals.browser }, sourceType: 'script' },
  },
  {
    files: ['e2e/**/*.ts', '*.config.ts', 'vite.config.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
