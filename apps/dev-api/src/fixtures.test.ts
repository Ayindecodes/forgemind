import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fixtureNames, runFixture } from './fixtures';

const target = resolve(import.meta.dirname, '../../api/tests/fixtures/runs');

describe('the run fixtures the real API is checked against', () => {
  for (const name of fixtureNames) {
    it(`${name} on disk matches the scenario and the reducer`, () => {
      const onDisk = JSON.parse(
        readFileSync(resolve(target, `${name}.json`), 'utf8'),
      );
      expect(onDisk).toEqual(JSON.parse(JSON.stringify(runFixture(name))));
    });
  }
});
