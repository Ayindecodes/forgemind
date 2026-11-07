import { parseArgs } from 'node:util';

import { DataSource } from '@forgemind/contract';

import { run } from './run';

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string' },
    cookie: { type: 'string', default: '' },
    'data-source': { type: 'string', default: 'live' },
    'all-implemented': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
});

const baseUrl = values['base-url'];
if (!baseUrl) {
  process.stderr.write(
    'usage: conformance --base-url <url> [--cookie fm_session=...] [--data-source live|demo] [--all-implemented] [--json]\n',
  );
  process.exit(2);
}

const summary = await run({
  baseUrl,
  cookie: values.cookie,
  dataSource: DataSource.parse(values['data-source']),
  allImplemented: values['all-implemented'],
});

if (values.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  const width = Math.max(...summary.results.map((result) => result.key.length));
  for (const result of summary.results) {
    const mark = {
      pass: 'ok  ',
      fail: 'FAIL',
      unimplemented: '--  ',
      blocked: 'wait',
    }[result.verdict];
    process.stdout.write(
      `${mark} ${result.key.padEnd(width)} ${result.method.padEnd(6)} ${result.path.padEnd(34)} ${result.note}\n`,
    );
  }
  process.stdout.write(
    `\n${summary.passed} passed, ${summary.failed} failed, ${summary.blocked} blocked, ${summary.unimplemented} unimplemented\n`,
  );
  if (summary.unprobed.length > 0) {
    process.stdout.write(
      `implemented but unprobed: ${summary.unprobed.join(', ')}\n`,
    );
  }
}

const bad = summary.failed > 0 || summary.unprobed.length > 0;
process.exit(bad ? 1 : 0);
