const common = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
} as const;
export const securityHeaders = {
  ...common,
  'Content-Security-Policy':
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Cache-Control': 'no-store',
} as const;
export const adminDocumentHeaders = {
  ...common,
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
} as const;
// No request-time APIs are used by the foundation public pages. Add only the
// exact contact origin and Turnstile hosts when that public form is implemented.
export const publicDocumentHeaders = {
  ...common,
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
  'X-Robots-Tag': 'noindex, nofollow',
} as const;
export const publicAttachmentHeaders = {
  'Content-Type': 'application/octet-stream',
  'Content-Disposition': 'attachment; filename="document.pdf"',
  'Content-Security-Policy': "sandbox; default-src 'none'",
} as const;
export function renderPublicHeaders(
  mode: 'preview' | 'production' = 'preview',
) {
  return `/*\n${Object.entries(publicDocumentHeaders)
    .filter(([key]) => mode === 'preview' || key !== 'X-Robots-Tag')
    .map(([key, value]) => `  ${key}: ${value}`)
    .join('\n')}\n\n/documents/*\n${Object.entries(publicAttachmentHeaders)
    .map(([key, value]) => `  ${key}: ${value}`)
    .join('\n')}\n`;
}
