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
