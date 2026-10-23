import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const [locale, heading, home] of [
  ['en', 'Page not found', 'Return home'],
  ['fr', 'Page introuvable', 'Retour à l’accueil'],
  ['ar', 'الصفحة غير موجودة', 'العودة إلى الرئيسية'],
] as const) {
  test(`${locale}: missing routes keep their status and offer accessible recovery`, async ({
    page,
    context,
    request,
  }) => {
    const prefix = locale === 'en' ? '' : `/${locale}`;
    for (const path of [
      '/missing/',
      '/projects/missing/deeper',
      '/missing.pdf',
    ]) {
      const response = await request.get(`${prefix}${path}`);
      expect(response.status()).toBe(404);
      expect(response.headers()['content-type']).toContain('text/html');
      expect(await response.text()).toContain(heading);
    }
    const response = await page.goto(
      `${prefix}/projects/missing/?q=UNTRUSTED_PATH_MARKER`,
    );
    expect(response?.status()).toBe(404);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('html')).toHaveAttribute(
      'dir',
      locale === 'ar' ? 'rtl' : 'ltr',
    );
    await expect(page.locator('h1')).toHaveText(heading);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
    await expect(
      page.locator(
        'link[rel="canonical"], link[rel="alternate"], script, meta[property^="og:"]',
      ),
    ).toHaveCount(0);
    await expect(page.locator('.primary-nav [aria-current]')).toHaveCount(0);
    expect(await page.content()).not.toContain('UNTRUSTED_PATH_MARKER');
    expect(
      await page
        .locator('.site-header')
        .evaluate((element) => getComputedStyle(element).display),
    ).toBe('flex');
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      if (width !== 320)
        await page.screenshot({
          path: `artifacts/public-preview/404-${locale}-${width}.png`,
          fullPage: true,
        });
    }
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: home, exact: true }),
    ).toBeFocused();
    expect(
      await page
        .locator(':focus')
        .evaluate((element) => getComputedStyle(element).outlineStyle),
    ).toBe('solid');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`http://127.0.0.1:4322${prefix}/`);
    expect(await context.cookies()).toEqual([]);
  });
}

test('missing-page recovery works without JavaScript and never repeats the broken path', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const locale of ['en', 'fr', 'ar']) {
    const prefix = locale === 'en' ? '' : `/${locale}`;
    await page.goto(`http://127.0.0.1:4322${prefix}/missing/`);
    for (const [language, href] of [
      ['EN', '/'],
      ['FR', '/fr/'],
      [locale === 'ar' ? 'العربية' : 'AR', '/ar/'],
    ] as const)
      await expect(
        page
          .locator('.locale-nav')
          .getByRole('link', { name: language, exact: true }),
      ).toHaveAttribute('href', href);
    await page
      .locator('.locale-nav')
      .getByRole('link', { name: 'FR', exact: true })
      .click();
    await expect(page).toHaveURL('http://127.0.0.1:4322/fr/');
  }
  await context.close();
});
