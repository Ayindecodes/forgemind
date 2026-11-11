import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fixtureNames, runFixture } from '../src/fixtures';

const target = resolve(import.meta.dirname, '../../api/tests/fixtures/runs');
mkdirSync(target, { recursive: true });
for (const name of fixtureNames) {
  const fixture = runFixture(name);
  writeFileSync(
    resolve(target, `${name}.json`),
    `${JSON.stringify(fixture, null, 2)}\n`,
  );
  console.log(
    `${name}: ${fixture.events.length} events, ${fixture.run.status} ${fixture.run.outcome ?? ''}`,
  );
}
