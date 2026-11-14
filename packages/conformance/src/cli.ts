import { parseArgs } from 'node:util';

import { DataSource } from '@forgemind/contract';

import { plan } from './plan';
import { run } from './run';

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string' },
    cookie: { type: 'string', default: '' },
    'data-source': { type: 'string', default: 'live' },
    'all-implemented': { type: 'boolean', default: false },
    only: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});

const baseUrl = values['base-url'];
// Named probes alone, for a check that is about one endpoint. One that
// needs what another learns has nothing to go on and reports as blocked.
const only = values.only?.split(',');
const chosen = only && plan.filter((probe) => only.includes(probe.key));
if (!baseUrl || (only && chosen?.length !== only.length)) {
  process.stderr.write(
    'usage: conformance --base-url <url> [--cookie fm_session=...] [--data-source live|demo] [--all-implemented] [--only <endpoint>[,<endpoint>]] [--json]\n',
  );
  process.exit(2);
}

const summary = await run({
  baseUrl,
  cookie: values.cookie,
  dataSource: DataSource.parse(values['data-source']),
  allImplemented: values['all-implemented'],
  probes: chosen,
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
  if (!chosen && summary.unprobed.length > 0) {
    process.stdout.write(
      `implemented but unprobed: ${summary.unprobed.join(', ')}\n`,
    );
  }
}

// The whole plan must leave nothing implemented unasked. Probes asked for by
// name must each have passed: one that could not be asked is no answer.
const bad = chosen
  ? summary.passed !== chosen.length
  : summary.failed > 0 || summary.unprobed.length > 0;
process.exit(bad ? 1 : 0);
