import { expect, test, type Page } from '@playwright/test';

import { open } from './support/open';

import { readPixels } from './support/pixels';

type Rgb = [number, number, number];

const RGB_CHANNEL = /\d+/g;

function computedRgb(
  page: Page,
  property: 'color' | 'backgroundColor',
  testId: string,
) {
  return page.getByTestId(testId).evaluate((element, name) => {
    let current: Element | null = element;

    while (current) {
      const value = getComputedStyle(current)[name];
      if (value !== 'rgba(0, 0, 0, 0)') return value;
      current = current.parentElement;
    }

    return '';
  }, property);
}

const toRgb = (value: string) =>
  (value.match(RGB_CHANNEL) ?? []).slice(0, 3).map(Number) as Rgb;

for (const colorScheme of ['dark', 'light'] as const) {
  test(`the symbol stays clear at 16px in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await open(page, '/design');

    const glyph = toRgb(await computedRgb(page, 'color', 'mark-16'));
    const background = toRgb(
      await computedRgb(page, 'backgroundColor', 'mark-16'),
    );
    const { data, width } = await readPixels(page, 'mark-16');

    const pixel = (x: number, y: number) => {
      const offset = (y * width + x) * 4;
      return [data[offset], data[offset + 1], data[offset + 2]];
    };

    expect(width).toBe(16);

    expect(pixel(4, 8)).toEqual(glyph); // stem
    expect(pixel(7, 8)).toEqual(background); // gap beside the node
    expect(pixel(9, 8)).toEqual(glyph); // node
    expect(pixel(9, 6)).toEqual(background); // gap above the node
    expect(pixel(9, 3)).toEqual(glyph); // top arm
    expect(pixel(1, 1)).toEqual(background); // margin

    const pixels = data.length / 4;
    const solid = Array.from({ length: pixels }, (_, index) => {
      const value = [data[index * 4], data[index * 4 + 1], data[index * 4 + 2]];
      return [glyph, background].some(
        (color) => JSON.stringify(color) === JSON.stringify(value),
      );
    }).filter(Boolean).length;

    // Only the angled tip of the top arm may be antialiased.
    expect(solid / pixels).toBeGreaterThanOrEqual(0.97);
  });
}

test('the app icon survives at 16px in the browser', async ({ page }) => {
  await open(page, '/design');

  const [stem, gap] = await page.evaluate(async () => {
    const image = new Image(16, 16);
    image.src = '/icon.svg';
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;

    const context = canvas.getContext('2d');
    context?.drawImage(image, 0, 0, 16, 16);

    return [
      [...(context?.getImageData(4, 8, 1, 1).data ?? [])].slice(0, 3),
      [...(context?.getImageData(7, 8, 1, 1).data ?? [])].slice(0, 3),
    ];
  });

  expect(stem).toEqual([11, 13, 16]);
  expect(gap).toEqual([110, 168, 254]);
});

test('declares the app icons', async ({ page, request }) => {
  await open(page, '/');

  const icons = await page
    .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((links) =>
      links.map((link) => link.getAttribute('href') ?? ''),
    );

  expect(icons.some((href) => href.includes('favicon.ico'))).toBe(true);
  expect(icons.some((href) => href.includes('icon.svg'))).toBe(true);
  expect(icons.some((href) => href.includes('apple-icon'))).toBe(true);

  for (const href of icons) {
    expect((await request.get(href)).status(), href).toBe(200);
  }
});

test('the logo has an accessible name', async ({ page }) => {
  await open(page, '/design');

  await expect(
    page.getByRole('img', { name: 'ForgeMind' }).first(),
  ).toBeVisible();
});

test('Geist loads for interface and code text', async ({ page }) => {
  await open(page, '/design');
  await page.evaluate(() => document.fonts.ready);

  const fonts = await page.evaluate(() => ({
    body: getComputedStyle(document.body).fontFamily,
    code: getComputedStyle(
      document.querySelector('.font-mono') ?? document.body,
    ).fontFamily,
    loaded: [...document.fonts]
      .filter(({ status }) => status === 'loaded')
      .map(({ family }) => family),
  }));

  expect(fonts.body).toMatch(/Geist/i);
  expect(fonts.code).toMatch(/Geist ?Mono/i);
  expect(fonts.loaded.some((family) => /Geist ?Sans/i.test(family))).toBe(true);
  expect(fonts.loaded.some((family) => /Geist ?Mono/i.test(family))).toBe(true);
});

test('loading the fonts does not shift the layout', async ({ page }) => {
  await open(page, '/design');
  await page.evaluate(() => document.fonts.ready);

  const shift = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        new PerformanceObserver((list) => {
          resolve(
            list
              .getEntries()
              .reduce(
                (total, entry) =>
                  total + (entry as PerformanceEntry & { value: number }).value,
                0,
              ),
          );
        }).observe({ type: 'layout-shift', buffered: true });

        setTimeout(() => resolve(0), 500);
      }),
  );

  expect(shift).toBeLessThan(0.1);
});

test('tabular figures give every digit the same width', async ({ page }) => {
  await open(page, '/design');
  await page.evaluate(() => document.fonts.ready);

  const widths = await page.evaluate(() =>
    ['1111111111', '0000000000', '7777777777'].map((digits) => {
      const span = document.createElement('span');
      span.textContent = digits;
      span.style.fontVariantNumeric = 'tabular-nums';
      document.body.append(span);

      const { width } = span.getBoundingClientRect();
      span.remove();

      return width;
    }),
  );

  expect(new Set(widths).size).toBe(1);
});
