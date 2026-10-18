import { defineConfig } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  build: { outDir: 'dist', sourcemap: false },
  esbuild: { jsx: 'automatic' },
  plugins: [
    {
      name: 'admin-loading-budget',
      async writeBundle(_options, bundle) {
        // Build evidence stays outside the served assets. Record the actual static
        // import graph so lazy features cannot disguise a larger initial download.
        const directory = fileURLToPath(
          new URL('../../artifacts/', import.meta.url),
        );
        await mkdir(directory, { recursive: true });
        await writeFile(
          directory + '/admin-build-manifest.json',
          JSON.stringify(
            Object.values(bundle)
              .filter((item) => item.type === 'chunk')
              .map((chunk) => ({
                fileName: chunk.fileName,
                isEntry: chunk.isEntry,
                imports: chunk.imports,
              })),
          ),
        );
      },
    },
  ],
});
