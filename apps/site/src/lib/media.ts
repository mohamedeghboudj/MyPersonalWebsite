import { resolve } from 'node:path';
import type { PublicSnapshot } from '@platform/schema';
import {
  readStaticMedia,
  snapshotDigest,
} from '../../../../scripts/static-media';
export const mediaDirectory = (snapshot: PublicSnapshot) =>
  resolve('../../artifacts/public-media', snapshotDigest(snapshot));
export const mediaManifest = (snapshot: PublicSnapshot) =>
  readStaticMedia(snapshot, mediaDirectory(snapshot));
