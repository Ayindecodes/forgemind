import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { open } from './support/open';

import {
  composite,
  contrastRatio,
  parseColor,
  readColorTokens,
  readGlassBackdrop,
  tokenRole,
} from '../src/styles/contrast';
import { readPixels } from './support/pixels';

const tokensCss = readFileSync(
  new URL('../src/styles/tokens.css', import.meta.url),
  'utf8',
);

const GLASS = ['nav', 'toolbar', 'popover', 'overlay'];
const FILLS: Record<string, string> = {
  nav: 'glass',
  toolbar: 'glass',
  popover: 'glass-strong',
  overlay: 'glass-strong',
};

// Rounding and blur sampling can land a channel just outside the model.
const CHANNEL_TOLERANCE = 3;

const materialStyles = (page: Page) =>
  page.evaluate((names) => {
    return names.map((name) => {
      const element = document.createElement('div');
      element.className = `material-${name}`;
      document.body.append(element);

      const { backdropFilter, backgroundColor } = getComputedStyle(element);
      element.remove();

      return { name, backdropFilter, backgroundColor };
    });
  }, GLASS);

function expectSolid(
  styles: Awaited<ReturnType<typeof materialStyles>>,
  surface: string,
) {
  const { r, g, b } = parseColor(surface);

  for (const { name, backdropFilter, backgroundColor } of styles) {
    expect(backdropFilter, name).toBe('none');
    expect(backgroundColor, name).toBe(`rgb(${r}, ${g}, ${b})`);
  }
}

for (const theme of ['dark', 'light'] as const) {
  const tokens = readColorTokens(tokensCss)[theme];
  const textTokens = Object.keys(tokens).filter(
    (name) => tokenRole(name) === 'text',
  );

  for (const name of GLASS) {
    test(`${name} glass keeps text readable over busy content in the ${theme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await open(page, '/design');

      const { data } = await readPixels(page, `material-sample-${name}`);
      const pixels = Array.from({ length: data.length / 4 }, (_, index) => ({
        r: data[index * 4] ?? 0,
        g: data[index * 4 + 1] ?? 0,
        b: data[index * 4 + 2] ?? 0,
        a: 1,
      }));

      for (const token of textTokens) {
        const foreground = parseColor(tokens[token] ?? '');
        const lowest = Math.min(
          ...pixels.map((pixel) => contrastRatio(foreground, pixel)),
        );

        expect(lowest, token).toBeGreaterThanOrEqual(4.5);
      }

      // The real pixels must stay inside the range the contrast audit assumes.
      const backdrop = readGlassBackdrop(tokensCss)[theme];
      const fill = parseColor(tokens[FILLS[name] ?? ''] ?? '');
      const low = composite([backdrop['backdrop-darkest'], fill]);
      const high = composite([backdrop['backdrop-lightest'], fill]);

      for (const channel of ['r', 'g', 'b'] as const) {
        const values = pixels.map((pixel) => pixel[channel]);

        expect(Math.min(...values)).toBeGreaterThanOrEqual(
          Math.min(low[channel], high[channel]) - CHANNEL_TOLERANCE,
        );
        expect(Math.max(...values)).toBeLessThanOrEqual(
          Math.max(low[channel], high[channel]) + CHANNEL_TOLERANCE,
        );
      }

      // A flat sample would mean the panel is solid, not glass.
      const distinct = new Set(pixels.map(({ r, g, b }) => `${r},${g},${b}`));
      expect(distinct.size).toBeGreaterThan(8);
    });
  }
}

test('glass uses the blur and tone filters by default', async ({ page }) => {
  await open(page, '/design');

  for (const { name, backdropFilter } of await materialStyles(page)) {
    expect(backdropFilter, name).toContain('blur(');
    expect(backdropFilter, name).toContain('saturate(');
    expect(backdropFilter, name).toContain('brightness(');
  }
});

test('the solid material is opaque and unfiltered', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page, '/design');

  const { backdropFilter, backgroundColor } = await page
    .getByTestId('material-solid')
    .evaluate((element) => getComputedStyle(element));

  expect(backdropFilter).toBe('none');
  expect(backgroundColor).toBe('rgb(23, 27, 33)');
});

test('nested glass turns solid and leaves its parent as glass', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page, '/design');

  const pairs = await page.evaluate((names) => {
    return names.flatMap((parentName) =>
      names.map((childName) => {
        const parent = document.createElement('div');
        const child = document.createElement('div');

        parent.className = `material-${parentName}`;
        child.className = `material-${childName}`;
        parent.append(child);
        document.body.append(parent);

        const result = {
          pair: `${childName} inside ${parentName}`,
          parentFilter: getComputedStyle(parent).backdropFilter,
          childFilter: getComputedStyle(child).backdropFilter,
          childBackground: getComputedStyle(child).backgroundColor,
        };

        parent.remove();

        return result;
      }),
    );
  }, GLASS);

  expect(pairs).toHaveLength(GLASS.length ** 2);

  for (const { pair, parentFilter, childFilter, childBackground } of pairs) {
    expect(parentFilter, pair).toContain('blur(');
    expect(childFilter, pair).toBe('none');
    expect(childBackground, pair).toBe('rgb(23, 27, 33)');
  }
});

test('glass is solid when the browser has no backdrop filter', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page, '/design');

  const removed = await page.evaluate(() => {
    let count = 0;

    const prune = (
      rules: CSSRuleList,
      owner: CSSStyleSheet | CSSGroupingRule,
    ) => {
      for (let index = rules.length - 1; index >= 0; index -= 1) {
        const rule = rules[index];

        if (
          rule instanceof CSSSupportsRule &&
          /backdrop-filter/.test(rule.conditionText)
        ) {
          owner.deleteRule(index);
          count += 1;
        } else if (rule instanceof CSSGroupingRule) {
          prune(rule.cssRules, rule);
        }
      }
    };

    for (const sheet of document.styleSheets) prune(sheet.cssRules, sheet);

    return count;
  });

  expect(removed).toBeGreaterThan(0);
  expectSolid(
    await materialStyles(page),
    readColorTokens(tokensCss).dark.elevated ?? '',
  );
});

test('glass is solid when reduced transparency is requested', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });

  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  });

  await open(page, '/design');

  expectSolid(
    await materialStyles(page),
    readColorTokens(tokensCss).dark.elevated ?? '',
  );
});

test('glass is solid with a stronger edge when more contrast is requested', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark', contrast: 'more' });
  await open(page, '/design');

  expectSolid(
    await materialStyles(page),
    readColorTokens(tokensCss).dark.elevated ?? '',
  );

  const { r, g, b } = parseColor(
    readColorTokens(tokensCss).dark['line-control'] ?? '',
  );
  const border = await page
    .getByTestId('material-solid')
    .evaluate((element) => getComputedStyle(element).borderTopColor);

  expect(border).toBe(`rgb(${r}, ${g}, ${b})`);
});

test('glass has no filter in forced colors mode', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await open(page, '/design');

  for (const { name, backdropFilter } of await materialStyles(page)) {
    expect(backdropFilter, name).toBe('none');
  }
});
