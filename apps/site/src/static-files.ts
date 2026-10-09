import { writeFile } from 'node:fs/promises';
import type { AstroIntegration } from 'astro';
import { renderPublicHeaders } from '@platform/config';
import {
  readSnapshot,
  buildConfig,
  locales,
  routePath,
  routes,
} from './lib/content';

export function staticFiles(): AstroIntegration {
  return {
    name: 'platform-static-files',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const snapshot = await readSnapshot();
        const redirects: string[] = [];
        if (snapshot.schemaVersion === 2) {
          const known = new Set(
            routes(snapshot).map((path) => routePath('en', path)),
          );
          for (const item of snapshot.navigation)
            if (!known.has(routePath('en', item.path)))
              throw new Error(
                `Navigation points to an unpublished route: ${item.path}`,
              );
          for (const redirect of snapshot.categoryRedirects) {
            const category = snapshot.projectCategories.find(
              (item) => item.id === redirect.categoryId,
            );
            if (
              !category ||
              category.slug === redirect.oldSlug ||
              snapshot.projectCategories.some(
                (item) => item.slug === redirect.oldSlug,
              )
            )
              throw new Error('Invalid category redirect');
            for (const locale of locales)
              redirects.push(
                `${routePath(locale, `projects/category/${redirect.oldSlug}`)} ${routePath(locale, `projects/category/${category.slug}`)} 301`,
              );
          }
        }
        await writeFile(
          new URL('_headers', dir),
          renderPublicHeaders(buildConfig.SITE_MODE),
        );
        await writeFile(
          new URL('_redirects', dir),
          redirects.join('\n') + '\n',
        );
      },
    },
  };
}
