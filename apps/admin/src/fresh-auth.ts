import { z } from 'zod';

const identitySchema = z.object({
  email: z.email(),
  iat: z.number().int().positive(),
  service_token_id: z.string().optional(),
});
// Access's get-identity iat is the login time. Application JWT iat is merely
// issuance time and may refresh without a new login; it is not used here.
export async function hasFreshLogin(
  token: string,
  issuer: string,
  email: string,
  now = Date.now(),
) {
  const response = await fetch(
    new URL('/cdn-cgi/access/get-identity', issuer),
    {
      headers: { Cookie: `CF_Authorization=${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok) return false;
  const parsed = identitySchema.safeParse(await response.json());
  if (!parsed.success) return false;
  const identity = parsed.data;
  const age = Math.floor(now / 1000) - identity.iat;
  return (
    identity.email.toLowerCase() === email.toLowerCase() &&
    !identity.service_token_id &&
    age >= 0 &&
    age <= 300
  );
}
