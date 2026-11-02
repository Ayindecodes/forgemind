import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { ForgeMark, Logo } from '@/components/brand/logo';
import { durations, easings } from '@/lib/motion';
import {
  auditContrast,
  readColorTokens,
  themes,
  tokenRole,
  type ContrastResult,
  type TokenRole,
} from '@/styles/contrast';

import { MotionDemos } from './motion-demos';
import { ThemeSwitcher } from './theme-switcher';

export const metadata: Metadata = { title: 'Design system | ForgeMind' };

const isEnabled =
  process.env.NODE_ENV !== 'production' ||
  process.env.ENABLE_DESIGN_PAGE === '1';

const colorGroups: { title: string; roles: TokenRole[] }[] = [
  { title: 'Surfaces', roles: ['surface'] },
  { title: 'Text and icons', roles: ['text'] },
  { title: 'Accent', roles: ['accent-fill', 'on-accent'] },
  { title: 'State layers', roles: ['state'] },
  { title: 'Lines and controls', roles: ['control', 'decorative'] },
  { title: 'Glass', roles: ['glass', 'scrim'] },
];

const typeScale = [
  { token: 'text-2xl', className: 'text-2xl font-semibold' },
  { token: 'text-xl', className: 'text-xl font-semibold' },
  { token: 'text-lg', className: 'text-lg font-semibold' },
  { token: 'text-md', className: 'text-md font-medium' },
  { token: 'text-base', className: 'text-base' },
  { token: 'text-sm', className: 'text-sm' },
  { token: 'text-xs', className: 'text-xs' },
  { token: 'text-code', className: 'font-mono text-code' },
];

const materials = [
  {
    name: 'nav',
    label: 'Glass navigation',
    className: 'material-nav rounded-lg',
  },
  { name: 'toolbar', label: 'Glass toolbar', className: 'material-toolbar' },
  { name: 'popover', label: 'Glass popover', className: 'material-popover' },
];

// Deliberately harsh: pure extremes wider than any blur radius.
const backdrops = [
  '#ffffff',
  '#000000',
  '#ff2d2d',
  '#2dff6e',
  '#2d6eff',
  '#ffe02d',
];

const backdropText =
  'error: build failed at step 4 of 7, retrying with bounded budget 0x7f3a ';

const markSizes = [16, 20, 24, 32, 48];

const metrics = ['1,284', '907', '11,111', '48,290', '3,076'];

const radii = [
  { token: 'rounded-sm', className: 'rounded-sm' },
  { token: 'rounded-md', className: 'rounded-md' },
  { token: 'rounded-lg', className: 'rounded-lg' },
  { token: 'rounded-xl', className: 'rounded-xl' },
  { token: 'rounded-2xl', className: 'rounded-2xl' },
];

const shadows = [
  { token: 'shadow-sm', className: 'shadow-sm' },
  { token: 'shadow-md', className: 'shadow-md' },
  { token: 'shadow-lg', className: 'shadow-lg' },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-md font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function MaterialSample({
  name,
  label,
  className,
}: {
  name: string;
  label: string;
  className: string;
}) {
  return (
    <div className={`flex flex-col gap-2 px-4 py-3 ${className}`}>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="font-medium">{label}</span>
        <span className="text-fg-secondary">Secondary text</span>
        <span className="text-fg-muted">Muted metadata</span>
        <span className="text-accent-fg">Accent link</span>
        <span className="text-success-fg">Checks passed</span>
        <span className="text-error-fg">Build failed</span>
      </div>
      <div data-testid={`material-sample-${name}`} className="h-4" />
    </div>
  );
}

function worstCase(results: ContrastResult[]) {
  const worst = new Map<string, ContrastResult>();

  for (const result of results) {
    const key = `${result.theme}:${result.token}`;
    const current = worst.get(key);

    if (!current || result.ratio < current.ratio) worst.set(key, result);
  }

  return worst;
}

export default function DesignPage() {
  if (!isEnabled) notFound();

  const css = readFileSync(
    join(process.cwd(), 'src/styles/tokens.css'),
    'utf8',
  );
  const { dark, light } = readColorTokens(css);
  const results = auditContrast(css);
  const failing = results.filter(({ ratio, required }) => ratio < required);
  const worst = worstCase(results);
  const auditedTokens = [...new Set(results.map(({ token }) => token))];

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Design system</h1>
          <p className="text-fg-secondary">
            {results.length.toLocaleString('en-US')} contrast pairs checked,{' '}
            {failing.length} below AA
          </p>
        </div>
        <ThemeSwitcher />
      </header>

      <Section title="Motion">
        <p className="text-fg-secondary">
          Motion explains state changes. Small interactions take{' '}
          {durations.fast * 1000}ms, popovers {durations.base * 1000}ms and
          dialogs {durations.slow * 1000}ms. Reduced motion keeps the fades and
          removes the movement.
        </p>
        <div className="flex flex-wrap gap-x-8 gap-y-1 font-mono text-xs text-fg-secondary">
          {Object.entries(easings).map(([name, curve]) => (
            <span key={name}>
              ease-{name} cubic-bezier({curve.join(', ')})
            </span>
          ))}
        </div>
        <div className="relative isolate overflow-hidden rounded-xl border border-line bg-surface p-6">
          <p
            aria-hidden="true"
            className="absolute inset-0 overflow-hidden p-6 font-mono text-code break-all text-line-control select-none"
          >
            {backdropText.repeat(30)}
          </p>
          <div className="relative">
            <MotionDemos />
          </div>
        </div>
      </Section>

      <Section title="Brand">
        <div className="flex flex-col gap-6 rounded-lg border border-line bg-surface p-6">
          <div className="flex flex-wrap items-end gap-8">
            {markSizes.map((size) => (
              <figure key={size} className="flex flex-col gap-2">
                <ForgeMark size={size} data-testid={`mark-${size}`} />
                <figcaption className="font-mono text-xs text-fg-secondary">
                  {size}
                </figcaption>
              </figure>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-8">
            <Logo size={16} />
            <Logo size={24} />
            <span className="text-accent-fg">
              <Logo size={24} />
            </span>
          </div>
        </div>
      </Section>

      <Section title="Materials">
        <p className="text-fg-secondary">
          Glass squeezes whatever sits behind it into a safe tone range, so text
          stays readable over any content.
        </p>
        <div
          data-testid="material-stage"
          className="relative isolate overflow-hidden rounded-xl border border-line"
        >
          <div aria-hidden="true" className="absolute inset-0 flex">
            {backdrops.map((color) => (
              <div
                key={color}
                className="flex-1"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <p
            aria-hidden="true"
            className="absolute inset-0 overflow-hidden font-mono text-code font-semibold break-all text-[#808080]"
          >
            {backdropText.repeat(40)}
          </p>
          <div className="relative flex flex-col gap-4 p-6">
            {materials.map(({ name, label, className }) => (
              <MaterialSample
                key={name}
                name={name}
                label={label}
                className={className}
              />
            ))}
            <div className="material-scrim -mx-6 -mb-6 p-6">
              <MaterialSample
                name="overlay"
                label="Glass overlay over a scrim"
                className="material-overlay"
              />
            </div>
            <div data-testid="material-solid" className="material-solid p-4">
              <p className="font-mono text-code text-fg-secondary">
                Solid surface for code, logs, tables and forms
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Color">
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-fg-secondary">
                <th scope="col" className="px-3 py-2 font-medium">
                  Token
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Dark
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Light
                </th>
              </tr>
            </thead>
            {colorGroups.map(({ title, roles }) => (
              <tbody key={title}>
                <tr className="border-t border-line">
                  <th
                    scope="colgroup"
                    colSpan={3}
                    className="bg-elevated px-3 py-1.5 text-left text-xs font-medium text-fg-secondary"
                  >
                    {title}
                  </th>
                </tr>
                {Object.keys(dark)
                  .filter((name) => {
                    const role = tokenRole(name);
                    return role !== undefined && roles.includes(role);
                  })
                  .map((name) => (
                    <tr key={name} className="border-t border-line-subtle">
                      <th
                        scope="row"
                        className="px-3 py-1.5 text-left font-normal"
                      >
                        <span className="flex items-center gap-2 font-mono">
                          <span
                            aria-hidden="true"
                            className="size-4 shrink-0 rounded-sm border border-line"
                            style={{ backgroundColor: `var(--color-${name})` }}
                          />
                          {name}
                        </span>
                      </th>
                      <td className="px-3 py-1.5 font-mono whitespace-nowrap text-fg-secondary">
                        {dark[name]}
                      </td>
                      <td className="px-3 py-1.5 font-mono whitespace-nowrap text-fg-secondary">
                        {light[name]}
                      </td>
                    </tr>
                  ))}
              </tbody>
            ))}
          </table>
        </div>
      </Section>

      <Section title="Contrast">
        <p className="text-fg-secondary">
          The lowest ratio for each token across every surface, glass and state
          layer it can sit on.
        </p>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-fg-secondary">
                <th scope="col" className="px-3 py-2 font-medium">
                  Token
                </th>
                {themes.map((theme) => (
                  <th
                    key={theme}
                    scope="col"
                    className="px-3 py-2 font-medium capitalize"
                  >
                    {theme}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {auditedTokens.map((token) => (
                <tr key={token} className="border-t border-line-subtle">
                  <th
                    scope="row"
                    className="px-3 py-1.5 text-left font-mono font-normal"
                  >
                    {token}
                  </th>
                  {themes.map((theme) => {
                    const result = worst.get(`${theme}:${token}`);
                    if (!result) return <td key={theme} />;

                    return (
                      <td
                        key={theme}
                        className="px-3 py-1.5 whitespace-nowrap text-fg-secondary tabular-nums"
                      >
                        {result.ratio >= result.required ? 'Pass' : 'Fail'}{' '}
                        {result.ratio.toFixed(2)} of {result.required}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Type">
        <div className="flex flex-col gap-2">
          {typeScale.map(({ token, className }) => (
            <div key={token} className="flex items-baseline gap-4">
              <span className="w-20 shrink-0 font-mono text-xs text-fg-secondary">
                {token}
              </span>
              <span className={className}>Investigate the failing build</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Numerals">
        <p className="text-fg-secondary">
          Tables and metrics use tabular figures so digits line up in columns.
        </p>
        <div className="flex gap-12">
          <div className="flex flex-col items-end">
            <span className="text-xs text-fg-secondary">Tabular</span>
            {metrics.map((metric) => (
              <span key={metric} className="text-lg tabular-nums">
                {metric}
              </span>
            ))}
          </div>
          <div className="flex flex-col items-end">
            <span className="text-xs text-fg-secondary">Proportional</span>
            {metrics.map((metric) => (
              <span key={metric} className="text-lg">
                {metric}
              </span>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Radii">
        <div className="flex flex-wrap gap-4">
          {radii.map(({ token, className }) => (
            <div key={token} className="flex flex-col gap-1.5">
              <div
                className={`size-16 border border-line bg-elevated ${className}`}
              />
              <span className="font-mono text-xs text-fg-secondary">
                {token}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Elevation">
        <div className="flex flex-wrap gap-6">
          {shadows.map(({ token, className }) => (
            <div key={token} className="flex flex-col gap-2">
              <div
                className={`h-16 w-28 rounded-lg border border-line bg-elevated ${className}`}
              />
              <span className="font-mono text-xs text-fg-secondary">
                {token}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </main>
  );
}
