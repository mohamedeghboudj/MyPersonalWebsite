import { spikeEducation } from '../../../scripts/fixtures';

const initial = JSON.stringify(spikeEducation, null, 2)
  .replace(/&/gu, '&amp;')
  .replace(/</gu, '&lt;')
  .replace(/>/gu, '&gt;');
export const spikePage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sprint 0 owner diagnostic</title><script src="/spike.js" defer></script></head>
<body><main><h1>Sprint 0 owner diagnostic</h1>
<p>This saves synthetic public test data to the content database. It is not the final console.</p>
<label for="education">Test education item (English, French and Arabic)</label><p><textarea id="education" rows="26" cols="90">${initial}</textarea></p>
<button id="save" type="button">Save test item</button>
<button id="capture" type="button" disabled>Capture publish request</button>
<p id="status" role="status" aria-live="polite">Save once, then capture the immutable public snapshot.</p>
<p>Capture downloads JSON for the owner-only GitHub Actions publish workflow. It contains only the public snapshot, its hash and the start timestamp. Use the downloaded JSON unchanged; the measured time includes the manual dispatch handoff.</p>
</main></body></html>`;
export const spikeScript = `
const status = document.getElementById('status');
const save = document.getElementById('save');
const capture = document.getElementById('capture');
save.addEventListener('click', async () => {
  save.disabled = true; capture.disabled = true;
  try {
    const response = await fetch('/api/education/1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: document.getElementById('education').value });
    if (!response.ok) throw new Error('Save rejected (' + response.status + ')');
    status.textContent = 'Saved in D1. Capture is ready; nothing is public yet.'; capture.disabled = false;
  } catch (error) { status.textContent = error.message; }
  finally { save.disabled = false; }
});
capture.addEventListener('click', async () => {
  capture.disabled = true;
  try {
    const response = await fetch('/api/publish/capture', { method: 'POST' });
    if (!response.ok) throw new Error('Capture rejected (' + response.status + ')');
    const data = await response.json();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'publish-request.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'Captured revision ' + data.snapshot.revision + '. Paste the downloaded JSON into the publish workflow within 30 minutes.';
  } catch (error) { status.textContent = error.message; }
  finally { capture.disabled = false; }
});`;
