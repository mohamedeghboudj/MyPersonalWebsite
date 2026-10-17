import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const locale of ['en', 'fr', 'ar']) {
  test(`${locale}: every public template is accessible, static and contained on mobile`, async ({
    page,
    context,
  }) => {
    const prefix = locale === 'en' ? '' : `/${locale}`;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400)
        errors.push(`${response.status()} ${response.url()}`);
    });
    for (const path of [
      '/',
      '/about/',
      '/projects/',
      '/projects/category/software/',
      '/projects/field-notes/',
      '/contact/',
    ]) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      const response = await page.goto(`${prefix}${path}`);
      expect(response?.status()).toBe(200);
      expect(
        await page
          .locator('.site-header')
          .evaluate((element) => getComputedStyle(element).display),
      ).toBe('flex');
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute(
        'dir',
        locale === 'ar' ? 'rtl' : 'ltr',
      );
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        `http://127.0.0.1:4321${prefix}${path}`,
      );
      if (path !== '/contact/') {
        const images = page.locator('picture img');
        expect(await images.count()).toBeGreaterThan(0);
        for (const image of await images.all()) {
          await image.scrollIntoViewIfNeeded();
          await expect
            .poll(() =>
              image.evaluate(
                (element: HTMLImageElement) =>
                  element.complete && element.naturalWidth > 0,
              ),
            )
            .toBe(true);
          await expect(image).toHaveAttribute('lang', locale);
          await expect(image).toHaveAttribute('alt', /\S/u);
          expect(
            await image.evaluate(
              (element: HTMLImageElement) =>
                new URL(element.currentSrc).pathname,
            ),
          ).toMatch(/^\/media\/[a-f0-9]{64}\.(avif|webp)$/u);
          expect(Number(await image.getAttribute('width'))).toBeLessThanOrEqual(
            1600,
          );
        }
      }
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
        'content',
        /^http:\/\/127\.0\.0\.1:4321\/media\/[a-f0-9]{64}\.jpg$/u,
      );
      await expect(
        page.locator('meta[property="og:image:alt"]'),
      ).toHaveAttribute(
        'content',
        {
          en: 'Synthetic geometric image for layout testing',
          fr: 'Image géométrique fictive pour tester la mise en page',
          ar: 'صورة هندسية تجريبية لاختبار التخطيط',
        }[locale]!,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(
        await page.locator('script:not([type="application/ld+json"])').count(),
      ).toBe(0);
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
    await page.goto(`${prefix}/projects/small-systems/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Small systems',
    );
    await expect(page.locator('article.case-study')).toHaveAttribute(
      'lang',
      'en',
    );
    await expect(page.locator('article.case-study')).toHaveAttribute(
      'dir',
      'ltr',
    );
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
    expect(await context.cookies()).toEqual([]);
    expect(errors).toEqual([]);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${prefix}/`);
    await expect(page.locator('.hero-main > .media-portrait')).toHaveCount(1);
    if (locale === 'en')
      await page.screenshot({
        path: 'artifacts/public-preview/home-desktop.png',
        fullPage: true,
      });
    if (locale === 'ar') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: 'artifacts/public-preview/home-ar-mobile.png',
        fullPage: true,
      });
    }
  });
}

test('category and language navigation preserve the selected page without JavaScript', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4322/projects/');
  await page
    .locator('.category-nav')
    .getByRole('link', { name: 'Research', exact: true })
    .click();
  await expect(page.locator('.project-card')).toHaveCount(1);
  await page
    .locator('.locale-nav')
    .getByRole('link', { name: 'FR', exact: true })
    .click();
  await expect(page).toHaveURL(/\/fr\/projects\/category\/research\/$/u);
  await page.locator('.project-title a').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Atlas ouvert',
  );
  await context.close();
});

test('public documents download as attachments and only built assets are exposed', async ({
  page,
  request,
}) => {
  await page.goto('/about/');
  const link = page.locator('a[download="document.pdf"]');
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^\/documents\/[a-f0-9]{64}\.pdf$/u);
  const response = await request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/octet-stream');
  expect(response.headers()['content-disposition']).toContain('attachment');
  expect(response.headers()['content-security-policy']).toContain('sandbox');
  const download = page.waitForEvent('download');
  await link.click();
  expect((await download).suggestedFilename()).toBe('document.pdf');
  for (const path of [
    '/1.bin',
    '/manifest.json',
    '/snapshot.json',
    '/media-input/1.bin',
    '/cv/en.pdf',
    '/cv/fr.pdf',
    '/cv/ar.pdf',
    '/cv/__stale_snapshot_probe.pdf',
  ])
    expect((await request.get(path)).status()).toBe(404);
});
