import type { Context } from 'hono';
import { adminEnvSchema } from '@platform/config';
import { hasFreshLogin } from './fresh-auth.ts';
import type { AdminEnvironment } from './index.ts';

export async function requireRecentLogin(
  c: Context<AdminEnvironment>,
  freshLogin: typeof hasFreshLogin,
  message: string,
) {
  const config = adminEnvSchema.parse(c.env);
  try {
    if (
      !(await freshLogin(
        c.req.header('Cf-Access-Jwt-Assertion') ?? '',
        config.ACCESS_ISSUER,
        config.OWNER_EMAIL,
      ))
    )
      return c.json(
        { error: message, reauthenticate: '/cdn-cgi/access/logout' },
        428,
      );
  } catch {
    return c.json(
      {
        error:
          'Access could not verify your recent login. Your content is unchanged. Sign in again, then retry. If it still fails, try again shortly.',
        reauthenticate: '/cdn-cgi/access/logout',
      },
      503,
    );
  }
  return undefined;
}
