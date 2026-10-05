import { describe, it, expect } from 'vitest';
import { snapshotSchema } from '@platform/schema';
import { sha256 } from '@platform/config';
import {
  parsePublishCapture,
  assertNewerRevision,
} from '../scripts/publish-validation';

describe('publish ordering and immutable snapshot handoff', () => {
  it('allows a first publish and refuses an older job after a newer one is live', () => {
    expect(() => assertNewerRevision(404, '', 1)).not.toThrow();
    expect(() =>
      assertNewerRevision(200, '<main data-revision="1">', 2),
    ).not.toThrow();
    expect(() =>
      assertNewerRevision(200, '<main data-revision="3">', 2),
    ).toThrow('newer');
    expect(() =>
      assertNewerRevision(200, '<main data-revision="3">', 3),
    ).toThrow('newer');
    for (const status of [302, 401, 403, 500])
      expect(() => assertNewerRevision(status, '', 4)).toThrow();
    expect(() => assertNewerRevision(200, 'unexpected HTML', 4)).toThrow();
  });
  it('rejects corrupted, private, expired or future captures', async () => {
    const now = Date.now();
    const snapshot = snapshotSchema.parse({
      schemaVersion: 1,
      revision: 1,
      generatedAt: new Date(now).toISOString(),
      profile: {
        fullName: 'Test',
        translations: [{ locale: 'en', headline: 'Test' }],
      },
      education: [],
      publicVariant: {
        id: 1,
        translations: [{ locale: 'en', summary: 'Test' }],
        items: [],
      },
    });
    const capture = {
      snapshot,
      hash: await sha256(JSON.stringify(snapshot)),
      capturedAt: new Date(now).toISOString(),
      savedAt: new Date(now - 1000).toISOString(),
    };
    expect(await parsePublishCapture(capture, now)).toEqual(capture);
    await expect(
      parsePublishCapture(
        { ...capture, savedAt: new Date(now + 1).toISOString() },
        now,
      ),
    ).rejects.toThrow('Save timestamp');
    await expect(
      parsePublishCapture({ ...capture, hash: '0'.repeat(64) }, now),
    ).rejects.toThrow('hash');
    await expect(
      parsePublishCapture(
        { ...capture, snapshot: { ...snapshot, inbox: [] } },
        now,
      ),
    ).rejects.toThrow();
    await expect(
      parsePublishCapture(capture, now + 31 * 60000),
    ).rejects.toThrow('30 minutes');
    await expect(parsePublishCapture(capture, now - 1)).rejects.toThrow(
      '30 minutes',
    );
  });
});
