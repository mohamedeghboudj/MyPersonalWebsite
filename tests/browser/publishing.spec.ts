import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

async function open(page: Page) {
  await page.goto('/');
  await page.getByText('Website publishing', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Prepare saved content' }),
  ).toBeEnabled();
}
async function prepare(page: Page) {
  await page.getByRole('button', { name: 'Prepare saved content' }).click();
  await expect(
    page.getByRole('button', { name: 'Start private build' }),
  ).toBeVisible();
  return page.getByLabel('Saved previews').inputValue();
}
test('publishes saved content after a lost response and page closure, then recovers its verified status and private report', async ({
  page,
}) => {
  const ids: string[] = [];
  await page.route('**/api/publishing/publish', async (route) => {
    ids.push(route.request().postDataJSON().id as string);
    const response = await route.fetch();
    if (ids.length === 1) return route.abort('failed');
    return route.fulfill({ response });
  });
  await open(page);
  await page
    .getByRole('button', { name: 'Publish saved content', exact: true })
    .click();
  await page.getByRole('button', { name: 'Retry publication request' }).click();
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
  await page.goto('/__simulated-publishing');
  // No open console or status polling is needed by the scheduled coordinator.
  await expect
    .poll(async () =>
      (await page.request.get(`/api/publishing/captures/${ids[0]}/publication`))
        .json()
        .then((value) => value.publication.status),
    )
    .toBe('published');
  await open(page);
  await page.getByLabel('Saved previews').selectOption(ids[0]!);
  await expect(
    page.getByRole('link', { name: 'Open public website', exact: true }),
  ).toHaveAttribute('href', 'http://127.0.0.1:4173/__simulated-publishing');
  await page.getByRole('button', { name: 'Read private build report' }).click();
  await expect(
    page.getByRole('link', { name: 'Download private report' }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'artifacts/publication-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'artifacts/publication-mobile.png',
    fullPage: true,
  });
});
test('loads preview controls on demand and distinguishes build success from the current preview', async ({
  page,
}) => {
  const scripts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Profile',
  );
  expect(scripts.some((url) => url.includes('/publishing-'))).toBe(false);
  await page
    .locator('summary')
    .filter({ hasText: 'Website publishing' })
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Prepare saved content' }),
  ).toBeEnabled();
  expect(scripts.some((url) => url.includes('/publishing-'))).toBe(true);
  await prepare(page);
  await page.getByRole('button', { name: 'Start private build' }).click();
  await expect(page.getByText('Build passed.', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Open private website preview' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Use this private preview' }).click();
  await expect(
    page.getByRole('link', { name: 'Open private website preview' }),
  ).toHaveAttribute('href', 'http://127.0.0.1:4173/__simulated-publishing');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'artifacts/publishing-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'artifacts/publishing-mobile.png',
    fullPage: true,
  });
});
test('reads and downloads a private report as escaped text, with an honest unavailable state', async ({
  page,
}) => {
  await open(page);
  await prepare(page);
  await page.getByRole('button', { name: 'Start private build' }).click();
  await page.route(
    '**/api/publishing/captures/*/diagnostics',
    (route) => route.fulfill({ status: 404, json: { error: 'No report' } }),
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Read private build report' }).click();
  await expect(page.getByRole('status')).toContainText(
    'No private report is available',
  );
  await page.getByRole('button', { name: 'Read private build report' }).click();
  await page.locator('summary').filter({ hasText: 'cv-compile' }).click();
  await expect(page.locator('.build-report')).toContainText(
    '<script>window.reportExecuted = true</script>',
  );
  expect(
    await page.evaluate(() => Object.hasOwn(window, 'reportExecuted')),
  ).toBe(false);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download private report' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^build-report-[a-f0-9-]+\.json$/u);
  expect(
    JSON.parse(await readFile((await file.path())!, 'utf8')).logs[0].text,
  ).toContain('Synthetic diagnostic only');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'artifacts/diagnostics-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByLabel('cv-compile output').focus();
  await page.keyboard.press('PageDown');
  await expect
    .poll(() =>
      page
        .getByLabel('cv-compile output')
        .evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'artifacts/diagnostics-mobile.png',
    fullPage: true,
  });
});
test('retries a lost capture response with the same ID and restores its state after reload', async ({
  page,
}) => {
  const ids: string[] = [];
  await page.route('**/api/publishing/captures', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    ids.push(route.request().postDataJSON().id as string);
    const response = await route.fetch();
    if (ids.length === 1) return route.abort('failed');
    return route.fulfill({ response });
  });
  await open(page);
  await page.getByRole('button', { name: 'Prepare saved content' }).click();
  await page.getByRole('button', { name: 'Retry preparing preview' }).click();
  await expect(
    page.getByRole('button', { name: 'Start private build' }),
  ).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
  await page.reload();
  await page.getByText('Website publishing', { exact: true }).click();
  await page.getByLabel('Saved previews').selectOption(ids[0]!);
  await expect(
    page.getByRole('button', { name: 'Start private build' }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('preserves the selected preview through reauthentication and reconciles uncertainty without a second activation', async ({
  page,
}) => {
  let unauthenticated = true,
    uncertain = false,
    activations = 0;
  let observed: Record<string, unknown> | undefined;
  await page.route('**/api/publishing/captures/*/preview', async (route) => {
    if (route.request().method() === 'POST' && unauthenticated) {
      unauthenticated = false;
      return route.fulfill({
        status: 428,
        json: {
          error: 'Sign in again before activating a private preview.',
          reauthenticate: '/cdn-cgi/access/logout',
        },
      });
    }
    const response = await route.fetch();
    if (route.request().method() === 'POST') {
      activations++;
      observed = (await response.json()).deployment as Record<string, unknown>;
      uncertain = true;
    }
    if (uncertain && observed)
      return route.fulfill({
        status: 202,
        json: {
          deployment: { ...observed, status: 'uncertain', deploymentId: null },
        },
      });
    return route.fulfill({ response });
  });
  await page.route(
    '**/api/publishing/captures/*/preview/reconcile',
    (route) => {
      uncertain = false;
      return route.continue();
    },
  );
  await open(page);
  const id = await prepare(page);
  await page.getByRole('button', { name: 'Start private build' }).click();
  await page.getByRole('button', { name: 'Use this private preview' }).click();
  await expect(
    page.getByRole('alert').getByRole('link', { name: 'Sign out of Access' }),
  ).toBeVisible();
  await expect(page.getByLabel('Saved previews')).toHaveValue(id);
  await page.getByRole('button', { name: 'Use this private preview' }).click();
  await expect(
    page.getByText('The preview change needs verification.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Open private website preview' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Recover preview status' }).click();
  await expect(
    page.getByRole('link', { name: 'Open private website preview' }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(activations).toBe(1);
});
