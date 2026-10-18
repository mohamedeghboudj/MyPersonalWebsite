import { defineConfig } from 'astro/config';
import { staticFiles } from './src/static-files.ts';
export default defineConfig({
  output: 'static',
  // Code-owned static assets only. Snapshot media/PDFs are explicitly staged
  // by the integration; the legacy spike's public/cv is not a v2 input.
  publicDir: './static',
  integrations: [staticFiles()],
  trailingSlash: 'always',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'fr', 'ar'],
    routing: { prefixDefaultLocale: false },
  },
  build: { format: 'directory', inlineStylesheets: 'never' },
});
