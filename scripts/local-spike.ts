import { mkdir, writeFile } from 'node:fs/promises';
import { saveEducation, createSnapshot } from '@platform/database';
import { sha256 } from '@platform/config';
import { localDatabase } from './local-database.ts';
import { spikeEducation } from './fixtures.ts';

const { runtime, content } = await localDatabase(true);
try {
  const started = performance.now();
  await saveEducation(content, 1, spikeEducation, 'local-spike');
  const saved = performance.now();
  const snapshot = await createSnapshot(content);
  const serialized = JSON.stringify(snapshot, null, 2);
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/snapshot.json', serialized, 'utf8');
  await writeFile(
    'artifacts/local-evidence.json',
    JSON.stringify(
      {
        scope: 'LOCAL ONLY — not a live Sprint 0 proof',
        savedAt: new Date().toISOString(),
        saveMs: saved - started,
        snapshotMs: performance.now() - saved,
        revision: snapshot.revision,
        snapshotHash: await sha256(serialized),
      },
      null,
      2,
    ),
  );
  console.log(
    `Saved local revision ${snapshot.revision}; allowlisted snapshot written to artifacts/snapshot.json`,
  );
} finally {
  await runtime.dispose();
}
