import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import {
  auditContrast,
  readColorTokens,
  themes,
  tokenRole,
  type ContrastResult,
  type TokenRole,
} from '@/styles/contrast';

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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-md font-semibold">{title}</h2>
      {children}
    </section>
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
    </main>
  );
}
