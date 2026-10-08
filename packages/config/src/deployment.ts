import { z } from 'zod';

export const environmentNames = ['local', 'preview', 'production'] as const;
const identifier = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/u);
const database = z
  .object({
    name: identifier,
    id: z.string().regex(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u),
  })
  .strict();
const origin = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.origin === value &&
    (url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)))
  );
}, 'Use HTTPS or loopback HTTP, without a path');
const environment = z
  .object({
    content: database,
    inbox: database,
    mediaBucket: identifier.min(3).optional(),
    admin: z.object({ name: identifier, origin }),
    contact: z.object({ name: identifier, origin }),
    site: z.object({ name: identifier, origin }),
  })
  .strict();
export const deploymentSetSchema = z
  .object({ local: environment, preview: environment, production: environment })
  .strict()
  .superRefine((value, context) => {
    const ids: string[] = [];
    const names: string[] = [];
    const origins: string[] = [];
    for (const name of environmentNames) {
      const env = value[name];
      ids.push(env.content.id, env.inbox.id);
      names.push(
        env.content.name,
        env.inbox.name,
        env.admin.name,
        env.contact.name,
        env.site.name,
      );
      if (env.mediaBucket) names.push(env.mediaBucket);
      origins.push(env.admin.origin, env.contact.origin, env.site.origin);
      for (const app of [env.admin, env.contact, env.site]) {
        const url = new URL(app.origin);
        if (
          name === 'local'
            ? !['localhost', '127.0.0.1'].includes(url.hostname)
            : url.protocol !== 'https:' ||
              ['localhost', '127.0.0.1'].includes(url.hostname)
        )
          context.addIssue({
            code: 'custom',
            message: 'Local apps use loopback; remote apps use HTTPS',
            path: [name],
          });
      }
    }
    for (const [label, values] of [
      ['database IDs', ids],
      ['resource names', names],
      ['origins', origins],
    ] as const)
      if (new Set(values).size !== values.length)
        context.addIssue({
          code: 'custom',
          message: `Environments must not share ${label}`,
        });
  });
export type DeploymentSet = z.infer<typeof deploymentSetSchema>;
export function createWranglerConfigs(
  input: unknown,
  name: (typeof environmentNames)[number],
) {
  const all = deploymentSetSchema.parse(input);
  const env = all[name];
  const d1 = (binding: 'CONTENT' | 'INBOX', db: z.infer<typeof database>) => ({
    binding,
    database_name: db.name,
    database_id: db.id,
    migrations_dir: `../../database/migrations/${binding.toLowerCase()}`,
  });
  const common = {
    $schema: '../../node_modules/wrangler/config-schema.json',
    compatibility_date: '2026-10-01',
    workers_dev: false,
    preview_urls: false,
  };
  // All routing remains disabled until the owner attaches Access / domain routes.
  // The generator never inherits bindings between environments.
  return {
    admin: {
      ...common,
      name: env.admin.name,
      main: 'src/index.ts',
      assets: {
        directory: './dist',
        binding: 'ASSETS',
        run_worker_first: true,
        not_found_handling: 'single-page-application',
      },
      vars: {
        APP_ENV: name,
        ADMIN_ORIGIN: env.admin.origin,
        PUBLIC_ORIGIN: env.site.origin,
      },
      d1_databases: [d1('CONTENT', env.content), d1('INBOX', env.inbox)],
      ...(env.mediaBucket
        ? { r2_buckets: [{ binding: 'MEDIA', bucket_name: env.mediaBucket }] }
        : {}),
    },
    contact: {
      ...common,
      name: env.contact.name,
      main: 'src/index.ts',
      vars: {
        APP_ENV: name,
        PUBLIC_ORIGIN: env.site.origin,
        TURNSTILE_MODE: 'production',
        TURNSTILE_HOSTNAME: new URL(env.site.origin).hostname,
      },
      d1_databases: [d1('INBOX', env.inbox)],
      triggers: { crons: ['15 3 * * *'] },
    },
    site: { ...common, name: env.site.name, assets: { directory: './dist' } },
  };
}
export function assertRemoteResourcesConfigured(
  input: DeploymentSet,
  name: 'preview' | 'production',
) {
  const env = input[name];
  if (
    [env.content.id, env.inbox.id].some((id) => id.startsWith('00000000-')) ||
    [env.admin, env.contact, env.site].some((app) =>
      new URL(app.origin).hostname.endsWith('.example'),
    )
  )
    throw new Error(
      'Replace example database IDs and origins in the ignored deployment manifest first',
    );
}
