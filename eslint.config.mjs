import path from 'node:path';
import { fileURLToPath } from 'node:url';
import eslint from '@eslint/js';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Severity convention: `error` means a bug or a type-safety hole, `warn` means style. Both
// fail the lint, which runs with --max-warnings 0

const typescriptRules = {
  '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
  // an untyped value flowing into a call, a return, an argument or a member access defeats
  // the checker silently
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-unsafe-return': 'error',
  '@typescript-eslint/no-unsafe-call': 'error',
  '@typescript-eslint/no-unsafe-argument': 'error',
  '@typescript-eslint/no-unsafe-member-access': 'error',
  '@typescript-eslint/no-unsafe-assignment': 'error',
  // stringifying a non-string is how `[object Object]` reaches a user
  '@typescript-eslint/restrict-template-expressions': 'error',
  '@typescript-eslint/no-unnecessary-type-assertion': 'error',

  '@typescript-eslint/no-inferrable-types': 'warn',
  'padding-line-between-statements': [
    'warn',
    { blankLine: 'always', prev: 'import', next: '*' },
    { blankLine: 'any', prev: 'import', next: 'import' },
  ],

  '@typescript-eslint/ban-ts-comment': 'off',
  '@typescript-eslint/no-unused-vars': 'off',
  '@typescript-eslint/no-non-null-assertion': 'off',
  '@typescript-eslint/require-await': 'off',
  '@typescript-eslint/no-require-imports': 'off',
  '@typescript-eslint/prefer-promise-reject-errors': 'off',
  '@typescript-eslint/no-redundant-type-constituents': 'off',
  '@typescript-eslint/no-duplicate-type-constituents': 'off',
};

// typescript-eslint turns these core rules off because tsc reports them itself. Plain
// .js/.mjs files are not type-checked, so they get them back
const untypedJsCorrectnessRules = {
  'constructor-super': 'error',
  'getter-return': 'error',
  'no-class-assign': 'error',
  'no-const-assign': 'error',
  'no-dupe-args': 'error',
  'no-dupe-class-members': 'error',
  'no-dupe-keys': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-new-native-nonconstructor': 'error',
  'no-obj-calls': 'error',
  'no-setter-return': 'error',
  'no-this-before-super': 'error',
  'no-unexpected-multiline': 'error',
  'no-unreachable': 'error',
  'no-unsafe-negation': 'error',
  'no-with': 'error',
};

// tests and tooling are linted without the type-aware rules
const scriptTypeCheckedRulesOff = {
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-unsafe-return': 'off',
  '@typescript-eslint/no-unsafe-assignment': 'off',
  '@typescript-eslint/no-unsafe-argument': 'off',
  '@typescript-eslint/no-unsafe-member-access': 'off',
  '@typescript-eslint/no-unsafe-call': 'off',
  '@typescript-eslint/restrict-template-expressions': 'off',
  '@typescript-eslint/no-non-null-assertion': 'off',
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/generated/**',
      'scripts/whois/data/**',
      // a project of their own, type-checked by their own tsconfig (npm run check:examples)
      'examples/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      prettierRecommended,
    ],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: dirname,
        project: ['./tsconfig.json'],
        EXPERIMENTAL_useProjectService: true,
      },
      globals: globals.node,
    },
    rules: {
      ...typescriptRules,
      // formatting, not correctness (and `format` re-checks it with prettier directly)
      'prettier/prettier': ['warn', {}, { usePrettierrc: true }],
    },
  },
  {
    files: ['test/**', 'scripts/**', '**/*.test.ts', '*.mjs', '*.cjs', '*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: scriptTypeCheckedRulesOff,
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    rules: untypedJsCorrectnessRules,
  }
);
