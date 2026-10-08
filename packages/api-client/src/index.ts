import { hc } from 'hono/client';
import type { AdminApi } from '../../../apps/admin/src/index';

// Type-only server dependency: no Worker, database or secrets in the browser.
export function createAdminClient(origin: string) {
  return hc<AdminApi>(origin, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    init: { credentials: 'same-origin' },
  });
}
