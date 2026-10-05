import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.tools/**',
      '.cache/**',
      '**/dist/**',
      '**/.astro/**',
      '**/.wrangler/**',
      'artifacts/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
);
