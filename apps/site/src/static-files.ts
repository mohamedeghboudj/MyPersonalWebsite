import { writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { renderPublicHeaders } from '@platform/config';
import {
  prepareStaticMedia,
  readStaticMedia,
  stageStaticMedia,
} from '../../../scripts/static-media';
import { mediaDirectory } from './lib/media';
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
      'astro:config:setup': async ({ command, config, updateConfig }) => {
        if (command === 'build' && (await readSnapshot()).schemaVersion === 1)
          updateConfig({ publicDir: new URL('./public/', config.root) });
      },
      'astro:build:start': async () => {
        const snapshot = await readSnapshot();
        if (snapshot.schemaVersion === 2)
          await prepareStaticMedia(
            snapshot,
            buildConfig.SITE_MEDIA_SOURCE_DIR ??
              resolve('../../artifacts/public-media-input'),
            mediaDirectory(snapshot),
          );
      },
      'astro:build:done': async ({ dir }) => {
        const snapshot = await readSnapshot();
        const redirects: string[] = [];
        if (snapshot.schemaVersion === 2) {
          const manifest = await readStaticMedia(
            snapshot,
            mediaDirectory(snapshot),
          );
          await stageStaticMedia(
            manifest,
            mediaDirectory(snapshot),
            fileURLToPath(dir),
          );
          // A stale PDF must not ride along through Astro's as-is public-dir
          // copy. V2 CV files join this allowlist only after hash verification
          // against this exact snapshot is implemented.
          const allowedPdfs = new Set(
            Object.values(manifest.documents).map((file) => file.url.slice(1)),
          );
          for (const path of await readdir(dir, { recursive: true })) {
            const normalized = path.replaceAll('\\', '/');
            if (/\.pdf$/iu.test(normalized) && !allowedPdfs.has(normalized))
              throw new Error(`Unverified PDF in public output: ${normalized}`);
          }
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
