import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function open(page: Page) {
  await page.goto('/');
  await page.getByText('Website preview', { exact: true }).click();
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
  await page.locator('summary').filter({ hasText: 'Website preview' }).focus();
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
  await page.getByText('Website preview', { exact: true }).click();
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
