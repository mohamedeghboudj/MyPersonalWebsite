import { writeFile } from 'node:fs/promises';
import { renderPublicHeaders } from '@platform/config';
await writeFile('apps/site/public/_headers', renderPublicHeaders(), 'utf8');
