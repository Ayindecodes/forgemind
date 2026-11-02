import { expect, test, type Locator, type Page } from '@playwright/test';

import { durations } from '../src/lib/motion';

type Sample = { t: number; opacity: number; transform: string; height: number };

const IDENTITY = ['none', 'matrix(1, 0, 0, 1, 0, 0)'];
const ms = (seconds: number) => seconds * 1000;

// Frames stretch when the test machine is busy, so settling gets this much grace.
const GRACE = 600;

/** Clicks a trigger in-page, then samples the target on every frame. */
function sample(page: Page, trigger: string, target: string, duration = 700) {
  return page.evaluate(
    ({ trigger, target, duration }) =>
      new Promise<Sample[]>((resolve) => {
        const samples: Sample[] = [];
        const button = document.querySelector<HTMLElement>(
          `[data-testid="${trigger}"]`,
        );
        button?.click();
        const start = performance.now();

        const tick = () => {
          const element = document.querySelector<HTMLElement>(
            `[data-testid="${target}"]`,
          );

          if (element) {
            const style = getComputedStyle(element);
            samples.push({
              t: performance.now() - start,
              opacity: Number(style.opacity),
              transform: style.transform,
              height: element.offsetHeight,
            });
          }

          if (performance.now() - start < duration) requestAnimationFrame(tick);
          else resolve(samples);
        };

        requestAnimationFrame(tick);
      }),
    { trigger, target, duration },
  );
}

/** The CSS animation on an element. Fill mode keeps it readable after it ends. */
const animationOf = (locator: Locator) =>
  locator.evaluate((element) => {
    const [animation] = element.getAnimations() as CSSAnimation[];
    const effect = animation?.effect as KeyframeEffect | undefined;

    return {
      name: animation?.animationName,
      duration: effect?.getTiming().duration,
      easing: effect?.getKeyframes()[0]?.easing,
    };
  });

const settled = (samples: Sample[]) =>
  samples.find(
    ({ opacity, transform }) => opacity === 1 && IDENTITY.includes(transform),
  );

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
});

test('transitions take their timing from the tokens', async ({ page }) => {
  await page.goto('/design');

  const press = await page.getByTestId('press').evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.transitionDuration, style.transitionTimingFunction];
  });

  expect(press).toEqual([`${durations.fast}s`, 'cubic-bezier(0.2, 0, 0, 1)']);

  const utility = await page
    .locator('.transition-colors')
    .first()
    .evaluate((element) => getComputedStyle(element).transitionDuration);

  expect(utility).toBe(`${durations.fast}s`);
});

test('a dialog fades and scales in within the slow duration', async ({
  page,
}) => {
  await page.goto('/design');

  const samples = await sample(page, 'open-dialog', 'dialog');
  const first = samples[0];
  const done = settled(samples);

  expect(samples.length).toBeGreaterThan(5);
  expect(first?.opacity).toBeLessThan(1);
  expect(samples.some(({ transform }) => /^matrix\(0\.9/.test(transform))).toBe(
    true,
  );
  expect(done).toBeDefined();
  expect(done?.t).toBeGreaterThan(ms(durations.slow) * 0.6);
  expect(done?.t).toBeLessThan(ms(durations.slow) + GRACE);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dialog')).toHaveCount(0, {
    timeout: ms(durations.base) + GRACE * 2,
  });
});

test('a popover rises out of its control and settles in place', async ({
  page,
}) => {
  await page.goto('/design');

  const samples = await sample(page, 'toggle-popover', 'popover');

  expect(
    samples.some(
      ({ transform }) =>
        /^matrix\(1, 0, 0, 1, 0, -?[0-9.]+\)$/.test(transform) &&
        !IDENTITY.includes(transform),
    ),
  ).toBe(true);
  expect(settled(samples)).toBeDefined();
  expect(settled(samples)?.t).toBeLessThan(ms(durations.base) + GRACE);
});

test('an expandable panel opens to its natural height', async ({ page }) => {
  await page.goto('/design');

  const samples = await sample(page, 'toggle-expand', 'expand');
  const heights = samples.map(({ height }) => height);
  const final = heights.at(-1) ?? 0;
  const grown = samples.find(({ height }) => height === final);

  expect(heights[0]).toBeLessThan(final);
  expect(final).toBeGreaterThan(40);
  expect(grown?.t).toBeLessThan(ms(durations.base) + GRACE);
});

test('a status change fades in with the fast preset', async ({ page }) => {
  await page.goto('/design');
  await page.getByTestId('advance-status').click();

  const chip = page.getByTestId('status');
  await expect(chip).toHaveText('Running');

  expect(await animationOf(chip)).toEqual({
    name: 'motion-fade-in',
    duration: ms(durations.fast),
    easing: 'cubic-bezier(0, 0, 0.2, 1)',
  });
});

test('press feedback is a restrained scale', async ({ page }) => {
  await page.goto('/design');

  const button = page.getByTestId('press');
  const box = await button.boundingBox();
  if (!box) throw new Error('Button not rendered');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms(durations.fast) + 100);

  expect(
    await button.evaluate((element) => getComputedStyle(element).scale),
  ).toBe('0.98');

  await page.mouse.up();
});

test('nothing animates once the page has settled', async ({ page }) => {
  await page.goto('/design');
  await page.waitForTimeout(1000);

  const running = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter(({ playState }) => playState === 'running').length,
  );

  expect(running).toBe(0);
});

test.describe('with reduced motion', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('the dialog keeps its fade and loses its scale', async ({ page }) => {
    await page.goto('/design');

    const samples = await sample(page, 'open-dialog', 'dialog');

    expect(samples.length).toBeGreaterThan(5);
    expect(samples.every(({ transform }) => IDENTITY.includes(transform))).toBe(
      true,
    );
    expect(samples.some(({ opacity }) => opacity > 0 && opacity < 1)).toBe(
      true,
    );
    expect(samples.at(-1)?.opacity).toBe(1);
  });

  test('the popover appears in place', async ({ page }) => {
    await page.goto('/design');

    const samples = await sample(page, 'toggle-popover', 'popover');

    expect(samples.length).toBeGreaterThan(5);
    expect(samples.every(({ transform }) => IDENTITY.includes(transform))).toBe(
      true,
    );
    expect(samples.at(-1)?.opacity).toBe(1);
  });

  test('press feedback has no movement', async ({ page }) => {
    await page.goto('/design');

    const button = page.getByTestId('press');
    const box = await button.boundingBox();
    if (!box) throw new Error('Button not rendered');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(ms(durations.fast) + 100);

    const style = await button.evaluate((element) => {
      const { scale, transitionProperty } = getComputedStyle(element);
      return { scale, transitionProperty };
    });

    expect(style.scale).toBe('1');
    expect(style.transitionProperty).not.toMatch(/scale|transform|translate/);

    await page.mouse.up();
  });

  test('the status fade still runs', async ({ page }) => {
    await page.goto('/design');
    await page.getByTestId('advance-status').click();

    const chip = page.getByTestId('status');
    await expect(chip).toHaveText('Running');

    expect((await animationOf(chip)).duration).toBe(ms(durations.fast));
  });
});
