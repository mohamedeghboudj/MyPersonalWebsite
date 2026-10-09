import { defineConfig } from 'astro/config';
import { staticFiles } from './src/static-files.ts';
export default defineConfig({
  output: 'static',
  integrations: [staticFiles()],
  trailingSlash: 'always',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'fr', 'ar'],
    routing: { prefixDefaultLocale: false },
  },
  build: { format: 'directory', inlineStylesheets: 'never' },
});
