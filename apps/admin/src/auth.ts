import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const verifiers = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export type VerifyAccess = (
  token: string,
  issuer: string,
  audience: string,
) => Promise<JWTPayload>;
export const verifyAccess: VerifyAccess = async (token, issuer, audience) => {
  let keys = verifiers.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
      timeoutDuration: 5000,
    });
    verifiers.set(issuer, keys);
  }
  const { payload } = await jwtVerify(token, keys, {
    issuer,
    audience,
    algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'sub', 'email'],
  });
  return payload;
};
