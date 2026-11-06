import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * Runs axe and returns violations as readable lines. Floating layers (tooltips,
 * popovers, menus) render at the end of the body, outside any landmark, which
 * is how every popover library works; axe's best-practice "region" rule
 * objects to that alone, so those nodes are dropped from that one rule. They
 * are still checked for everything else.
 */
export async function axeViolations(
  page: Page,
  options?: { include?: string; exclude?: string },
) {
  let builder = new AxeBuilder({ page });
  if (options?.include) builder = builder.include(options.include);
  if (options?.exclude) builder = builder.exclude(options.exclude);

  const { violations } = await builder.analyze();

  return violations
    .map((violation) => ({
      ...violation,
      nodes:
        violation.id === 'region'
          ? violation.nodes.filter(
              ({ target }) =>
                !target.join(' ').includes('data-radix-popper-content-wrapper'),
            )
          : violation.nodes,
    }))
    .filter(({ nodes }) => nodes.length > 0)
    .map(
      ({ id, nodes }) =>
        `${id}: ${nodes.map(({ target }) => target.join(' ')).join(', ')}`,
    );
}
