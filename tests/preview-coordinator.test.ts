import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { asc, eq } from 'drizzle-orm';
import {
  audit,
  editorOverview,
  readPublishCapture,
  reserveBuildDispatch,
  finishBuildDispatch,
  readPreviewDeployment,
  readPreviewFence,
  previewDeployments,
  capturePublicSnapshot,
} from '@platform/database';
import type {
  PreviewCandidate,
  PreviewActivation,
  PreviewCurrentVersion,
} from '@platform/schema';
import { publishCapturePolicy } from '@platform/config';
import { localDatabase, migrateTestDatabase } from '../scripts/local-database';
import { createPrivateCapture } from '../apps/admin/src/publish-captures';
import {
  coordinatePreviewDeployment,
  reconcilePreviewDeployment,
  type PreviewDeploymentProvider,
} from '../apps/admin/src/preview-coordinator';

let local: Awaited<ReturnType<typeof localDatabase>>;
let now: Date;
const clock = () => new Date(now);
let runId: number;
let active: PreviewCurrentVersion;
let candidates: Map<string, PreviewCandidate>;
let history: Map<string, Extract<PreviewActivation, { status: 'deployed' }>>;
let provider: PreviewDeploymentProvider;
beforeEach(async () => {
  local = await localDatabase();
  await migrateTestDatabase(local.content, local.inbox);
  now = new Date('2026-10-17T10:00:00Z');
  runId = 100;
  active = { versionId: crypto.randomUUID(), release: null };
  candidates = new Map();
  history = new Map();
  provider = {
    buildSucceeded: vi.fn(async () => true),
    candidate: vi.fn(async (id) => candidates.get(id)!),
    current: vi.fn(async () => active),
    activate: vi.fn(async (versionId) => {
      const outcome = {
        status: 'deployed' as const,
        deploymentId: crypto.randomUUID(),
        versionId,
        percentage: 100 as const,
        createdAt: clock().toISOString(),
      };
      history.set(versionId, outcome);
      active = { versionId, release: candidates.get(versionId)!.release };
      return outcome;
    }),
    findActivation: vi.fn(async (versionId) => history.get(versionId) ?? null),
  };
});
afterEach(async () => local?.runtime.dispose());
async function candidate(purpose: 'preview' | 'publish' = 'preview') {
  const id = crypto.randomUUID();
  await createPrivateCapture(
    local.content,
    local.media,
    { id, revision: (await editorOverview(local.content)).revision, purpose },
    'owner',
    clock,
  );
  await reserveBuildDispatch(local.content, id, 'owner', clock().toISOString());
  await finishBuildDispatch(
    local.content,
    id,
    'queued',
    ++runId,
    'owner',
    clock().toISOString(),
  );
  const capture = (await readPublishCapture(local.content, id))!;
  const value: PreviewCandidate = {
    versionId: crypto.randomUUID(),
    release: {
      schemaVersion: 1,
      id,
      sequence: capture.sequence,
      revision: capture.revision,
      snapshotSha256: capture.snapshotSha256,
      bundleSha256: 'a'.repeat(64),
    },
  };
  candidates.set(value.versionId, value);
  return value;
}
const deploy = (value: PreviewCandidate, binding = local.content) =>
  coordinatePreviewDeployment(
    binding,
    value.release.id,
    value.versionId,
    'owner',
    provider,
    clock,
  );
const reconcile = (value: PreviewCandidate) =>
  reconcilePreviewDeployment(
    local.content,
    value.release.id,
    'owner',
    provider,
    clock,
  );
async function actions(id: string) {
  return (
    await drizzle(local.content)
      .select({ action: audit.action })
      .from(audit)
      .where(eq(audit.entity, `capture:${id}`))
      .orderBy(asc(audit.id))
  )
    .map((row) => row.action)
    .filter((action) => action.startsWith('publish.preview.'));
}
describe('durable preview activation coordinator', () => {
  it('reserves and audits before activation, acknowledges once and never changes content revision or public output', async () => {
    const value = await candidate();
    const before = await editorOverview(local.content);
    const activate = provider.activate;
    provider.activate = vi.fn(async (versionId) => {
      expect((await readPreviewFence(local.content))?.captureId).toBe(
        value.release.id,
      );
      expect(await actions(value.release.id)).toEqual([
        'publish.preview.activating',
      ]);
      return activate(versionId);
    });
    const result = await deploy(value);
    expect(result).toMatchObject({
      captureId: value.release.id,
      versionId: value.versionId,
      status: 'deployed',
    });
    expect(await deploy(value)).toEqual(result);
    expect(provider.activate).toHaveBeenCalledTimes(1);
    expect(await readPreviewFence(local.content)).toBeUndefined();
    expect(await actions(value.release.id)).toEqual([
      'publish.preview.activating',
      'publish.preview.deployed',
    ]);
    expect((await editorOverview(local.content)).revision).toBe(
      before.revision,
    );
    expect(JSON.stringify(result)).not.toMatch(/requestedBy|updatedBy|owner/);
    expect(
      JSON.stringify(await capturePublicSnapshot(local.content)),
    ).not.toContain(value.versionId);
  });
  it('coalesces concurrent identical requests into exactly one provider mutation', async () => {
    const value = await candidate();
    const results = await Promise.all([1, 2, 3].map(() => deploy(value)));
    expect(
      results.every((result) => result.captureId === value.release.id),
    ).toBe(true);
    expect(provider.activate).toHaveBeenCalledTimes(1);
    expect(
      (await readPreviewDeployment(local.content, value.release.id))?.status,
    ).toBe('deployed');
    expect(
      (await actions(value.release.id)).filter(
        (action) => action === 'publish.preview.activating',
      ),
    ).toHaveLength(1);
  });
  it('blocks a competing capture while the winner is still in flight', async () => {
    const first = await candidate(),
      second = await candidate();
    let started!: () => void, finish!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const released = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const activate = provider.activate;
    provider.activate = vi.fn(async (versionId) => {
      started();
      await released;
      return activate(versionId);
    });
    const pending = deploy(first);
    await entered;
    try {
      await expect(deploy(second)).rejects.toMatchObject({ status: 409 });
      expect(provider.activate).toHaveBeenCalledTimes(1);
    } finally {
      finish();
      await pending;
    }
    expect((await deploy(second)).status).toBe('deployed');
  });
  it('retains an uncertain fence across timeouts and capture expiry without retrying activation', async () => {
    const first = await candidate();
    provider.activate = vi.fn(async () => {
      throw new Error('PRIVATE provider timeout');
    });
    expect((await deploy(first)).status).toBe('uncertain');
    now = new Date(now.getTime() + publishCapturePolicy.retentionMs + 1);
    const second = await candidate();
    expect((await reconcile(first)).status).toBe('uncertain');
    await expect(deploy(second)).rejects.toMatchObject({ status: 409 });
    expect(provider.activate).toHaveBeenCalledTimes(1);
    expect((await readPreviewFence(local.content))?.captureId).toBe(
      first.release.id,
    );
    expect(await actions(first.release.id)).toEqual([
      'publish.preview.activating',
      'publish.preview.uncertain',
    ]);
  });
  it('reconciles a lost accepted response from exact positive evidence, including after input expiry', async () => {
    const first = await candidate();
    const activate = provider.activate;
    provider.activate = vi.fn(async (versionId) => {
      await activate(versionId);
      throw new Error('response lost');
    });
    expect((await deploy(first)).status).toBe('uncertain');
    now = new Date(now.getTime() + publishCapturePolicy.retentionMs + 1);
    expect((await reconcile(first)).status).toBe('deployed');
    expect(provider.activate).toHaveBeenCalledTimes(1);
    expect(await readPreviewFence(local.content)).toBeUndefined();
    expect(await actions(first.release.id)).toEqual([
      'publish.preview.activating',
      'publish.preview.uncertain',
      'publish.preview.deployed',
    ]);
  });
  it('recovers an acknowledged provider activation after the database acknowledgement failed', async () => {
    const value = await candidate();
    const faulty = new Proxy(local.content, {
      get(target, property) {
        if (property === 'prepare')
          return (query: string) => {
            if (query.startsWith('update "preview_deployments"'))
              throw new Error('D1 acknowledgement unavailable');
            return target.prepare(query);
          };
        const entry = Reflect.get(target, property);
        return typeof entry === 'function' ? entry.bind(target) : entry;
      },
    });
    await expect(deploy(value, faulty)).rejects.toThrow();
    expect(
      (await readPreviewDeployment(local.content, value.release.id))?.status,
    ).toBe('activating');
    expect((await reconcile(value)).status).toBe('deployed');
    expect(provider.activate).toHaveBeenCalledTimes(1);
  });
  it('rejects a changed provider baseline or expired capture before sending and releases only that safe reservation', async () => {
    for (const change of ['baseline', 'expiry']) {
      const value = await candidate();
      let reads = 0;
      provider.current = vi.fn(async () => {
        if (++reads === 2) {
          if (change === 'baseline')
            return { ...active, versionId: crypto.randomUUID() };
          now = new Date(now.getTime() + publishCapturePolicy.retentionMs);
        }
        return active;
      });
      expect((await deploy(value)).status).toBe('rejected');
      expect(await readPreviewFence(local.content)).toBeUndefined();
    }
    expect(provider.activate).not.toHaveBeenCalled();
  });
  it('retains definitive rejections without resending and permits a different later capture', async () => {
    const value = await candidate();
    provider.activate = vi.fn(async () => ({ status: 'rejected' as const }));
    expect((await deploy(value)).status).toBe('rejected');
    expect((await deploy(value)).status).toBe('rejected');
    expect(provider.activate).toHaveBeenCalledTimes(1);
    expect((await deploy(await candidate())).status).toBe('rejected');
    expect(provider.activate).toHaveBeenCalledTimes(2);
    expect(await readPreviewFence(local.content)).toBeUndefined();
  });
  it('rejects failed builds, mismatched receipts and publish-purpose captures before reservation', async () => {
    const value = await candidate();
    provider.buildSucceeded = vi.fn(async () => false);
    await expect(deploy(value)).rejects.toMatchObject({ status: 409 });
    provider.buildSucceeded = vi.fn(async () => true);
    candidates.set(value.versionId, {
      ...value,
      release: { ...value.release, snapshotSha256: 'b'.repeat(64) },
    });
    await expect(deploy(value)).rejects.toMatchObject({ status: 409 });
    await expect(deploy(await candidate('publish'))).rejects.toMatchObject({
      status: 409,
    });
    expect(await readPreviewFence(local.content)).toBeUndefined();
    expect(provider.activate).not.toHaveBeenCalled();
  });
  it('uses the database watermark to block older captures even if the provider read is stale', async () => {
    const older = await candidate(),
      newer = await candidate();
    await deploy(newer);
    active = { versionId: crypto.randomUUID(), release: null };
    await expect(deploy(older)).rejects.toMatchObject({ status: 409 });
    expect(provider.activate).toHaveBeenCalledTimes(1);
    expect(
      await readPreviewDeployment(local.content, older.release.id),
    ).toBeUndefined();
  });
  it('keeps fences on wrong, partial, stale or unavailable reconciliation evidence', async () => {
    const value = await candidate();
    provider.activate = vi.fn(async () => ({ status: 'uncertain' as const }));
    await deploy(value);
    const observed = {
      status: 'deployed' as const,
      deploymentId: crypto.randomUUID(),
      versionId: value.versionId,
      percentage: 100 as const,
      createdAt: clock().toISOString(),
    };
    for (const evidence of [
      { ...observed, versionId: crypto.randomUUID() },
      { ...observed, createdAt: new Date(now.getTime() - 1).toISOString() },
      { ...observed, percentage: 50 },
      null,
    ]) {
      provider.findActivation = vi.fn(
        async () =>
          evidence as Extract<PreviewActivation, { status: 'deployed' }> | null,
      );
      expect((await reconcile(value)).status).toBe('uncertain');
    }
    provider.findActivation = vi.fn(async () => {
      throw new Error('PRIVATE credential');
    });
    expect(JSON.stringify(await reconcile(value))).not.toContain('PRIVATE');
    expect((await readPreviewFence(local.content))?.captureId).toBe(
      value.release.id,
    );
    expect(provider.activate).toHaveBeenCalledTimes(1);
  });
  it('treats malformed or mismatched activation success as uncertain rather than releasing the fence', async () => {
    const value = await candidate();
    provider.activate = vi.fn(async () => ({
      status: 'deployed' as const,
      deploymentId: crypto.randomUUID(),
      versionId: crypto.randomUUID(),
      percentage: 100 as const,
      createdAt: clock().toISOString(),
    }));
    expect((await deploy(value)).status).toBe('uncertain');
    expect(await readPreviewFence(local.content)).toBeDefined();
  });
  it('prevents deletion, identity changes and clearing an uncertain fence without evidence', async () => {
    const value = await candidate();
    provider.activate = vi.fn(async () => ({ status: 'uncertain' as const }));
    await deploy(value);
    const db = drizzle(local.content),
      where = eq(previewDeployments.captureId, value.release.id);
    await expect(db.delete(previewDeployments).where(where)).rejects.toThrow();
    await expect(
      db
        .update(previewDeployments)
        .set({ versionId: crypto.randomUUID() })
        .where(where),
    ).rejects.toThrow();
    await expect(
      db
        .update(previewDeployments)
        .set({ bundleSha256: 'c'.repeat(64) })
        .where(where),
    ).rejects.toThrow();
    await expect(
      db.update(previewDeployments).set({ status: 'rejected' }).where(where),
    ).rejects.toThrow();
    await expect(
      deploy({ ...value, versionId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await actions(value.release.id)).toEqual([
      'publish.preview.activating',
      'publish.preview.uncertain',
    ]);
  });
  it('rolls back the reservation when its audit cannot be written, before any provider mutation', async () => {
    const value = await candidate();
    await local.content
      .prepare(
        "CREATE TRIGGER synthetic_preview_audit_failure BEFORE INSERT ON audit_log WHEN NEW.action = 'publish.preview.activating' BEGIN SELECT RAISE(ABORT, 'Synthetic audit failure'); END;",
      )
      .run();
    await expect(deploy(value)).rejects.toMatchObject({ status: 409 });
    expect(
      await readPreviewDeployment(local.content, value.release.id),
    ).toBeUndefined();
    expect(provider.activate).not.toHaveBeenCalled();
  });
});
