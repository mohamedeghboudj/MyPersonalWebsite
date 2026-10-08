import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('owner edits Arabic, previews fallback, saves, resolves a conflict and deletes', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Education', exact: true }).click();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByLabel('Start date').fill('2020-09-01');
  await page.getByRole('checkbox', { name: 'Visible', exact: true }).check();
  await page.getByRole('button', { name: 'Add English translation' }).click();
  await page
    .getByLabel('Institution *', { exact: true })
    .fill('Synthetic University');
  await page.getByLabel('Program *', { exact: true }).fill('Engineering');
  await page
    .getByLabel('Description *', { exact: true })
    .fill('A synthetic test entry.');
  await page.getByRole('button', { name: 'العربية', exact: false }).click();
  await page.getByRole('button', { name: 'Add العربية translation' }).click();
  await page.getByLabel('Institution *', { exact: true }).fill('جامعة تجريبية');
  await page.getByLabel('Program *', { exact: true }).fill('هندسة');
  await page
    .getByLabel('Description *', { exact: true })
    .fill('هذا سجل تجريبي لاختبار المحرر.');
  await expect(page.locator('.translations [dir="rtl"]')).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved privately' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Synthetic University/ }),
  ).toContainText('AR ✓');
  await page.getByRole('button', { name: 'Preview text' }).click();
  await page.getByLabel('Preview language').selectOption('fr');
  await expect(
    page.getByText('Using EN because this translation is missing.'),
  ).toBeVisible();
  await page.getByLabel('Preview language').selectOption('ar');
  await expect(page.locator('.content-preview').first()).toContainText(
    'جامعة تجريبية',
  );
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const overview = (await (
    await request.get('/api/content/overview')
  ).json()) as { revision: number };
  await request.post('/api/content/technologies', {
    headers: { Origin: 'http://127.0.0.1:4173' },
    data: {
      revision: overview.revision,
      record: { name: 'Concurrent edit', slug: 'concurrent-edit' },
    },
  });
  await page.getByLabel('City', { exact: true }).fill('Unsaved city');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('alert')).toContainText('A newer edit exists');
  await expect(page.getByLabel('City', { exact: true })).toHaveValue(
    'Unsaved city',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Discard / reload' }).click();
  await expect(page.getByLabel('City', { exact: true })).toHaveValue('');
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({
    path: 'artifacts/console-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'العربية', exact: false }).click();
  await expect(
    page.getByRole('combobox', { name: 'Content section', exact: true }),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'artifacts/console-mobile.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Delete item', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Item deleted' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('uploads a private image and selects it by its description', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Media library', exact: true })
    .click();
  await page.getByLabel('File', { exact: true }).setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page
    .getByLabel('Alternative text', { exact: true })
    .fill('Synthetic portrait');
  await page.getByRole('button', { name: 'Upload file', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Synthetic portrait/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Synthetic portrait/ }).click();
  await expect(
    page.getByRole('checkbox', {
      name: 'Eligible for public derivatives (redacted copies only)',
    }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('link', { name: 'Download private original' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.locator('.record-button').click();
  await expect(
    page
      .getByLabel('Portrait', { exact: true })
      .getByRole('option', { name: 'Synthetic portrait' }),
  ).toHaveCount(1);
  await page
    .getByLabel('Portrait', { exact: true })
    .selectOption({ label: 'Synthetic portrait' });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved privately' }),
  ).toBeVisible();
});

test('validates on the server and keeps hostile text inert in preview', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Technologies', exact: true }).click();
  await page.getByRole('button', { name: 'Add item' }).click();
  await page
    .getByLabel('Name *', { exact: true })
    .fill('<img src=x onerror=alert(1)>');
  await page.getByLabel('Slug *', { exact: true }).fill('INVALID SLUG');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Check the highlighted fields',
  );
  await expect(page.getByLabel('Slug *', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.getByRole('button', { name: 'Preview text' }).click();
  await expect(page.locator('.content-preview')).toContainText(
    '<img src=x onerror=alert(1)>',
  );
  await expect(page.locator('.content-preview img')).toHaveCount(0);
});
