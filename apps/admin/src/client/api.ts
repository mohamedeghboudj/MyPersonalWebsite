import { createAdminClient } from '@platform/api-client';

export const client = createAdminClient(window.location.origin);
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}
// Error bodies are deliberately untrusted; Access may return an HTML login page.
export async function checked<
  T extends Pick<Response, 'ok' | 'status' | 'headers' | 'redirected' | 'json'>,
>(response: T): Promise<T> {
  if (
    response.ok &&
    response.headers.get('content-type')?.includes('application/json')
  )
    return response;
  let message =
    response.status === 401 || response.redirected
      ? 'Your session expired. Sign in again in another tab, then retry.'
      : 'The request failed. Your draft is still here; retry when the connection returns.';
  const issues: { path: string; message: string }[] = [];
  try {
    const body: unknown = await response.json();
    if (
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof body.error === 'string'
    )
      message = body.error;
    if (
      body &&
      typeof body === 'object' &&
      'issues' in body &&
      Array.isArray(body.issues)
    )
      for (const issue of body.issues) {
        if (
          issue &&
          typeof issue === 'object' &&
          'path' in issue &&
          typeof issue.path === 'string' &&
          'message' in issue &&
          typeof issue.message === 'string'
        )
          issues.push({ path: issue.path, message: issue.message });
      }
  } catch {
    /* A provider error page contains no application data. */
  }
  throw new ApiError(message, response.status, issues);
}
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'The request failed. Please try again.';
