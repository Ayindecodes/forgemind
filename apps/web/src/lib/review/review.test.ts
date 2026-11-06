import type { DiffFile } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { compileComments, type DraftComment } from './comments';
import { gitHeader, newLinesInPatch, parseFile } from './parse';
import { hunkSides, placeTokens } from './tokens';
import { buildTree } from './tree';

const file = (overrides: Partial<DiffFile> = {}): DiffFile => ({
  path: 'src/retry.ts',
  previousPath: null,
  change: 'modified',
  additions: 2,
  deletions: 1,
  language: 'typescript',
  patch: `@@ -34,3 +34,4 @@ export class RetryPolicy {
   constructor(private readonly plan: Plan) {
-    this.retryBudget = plan.maxRetries;
+    this.retryBudget = Math.min(remaining, plan.maxRetries);
+    this.remaining = remaining;
   }
`,
  explanation: null,
  ...overrides,
});

describe('parseFile', () => {
  it('writes the header the parser needs for each kind of change', () => {
    expect(gitHeader(file())).toContain(
      '--- a/src/retry.ts\n+++ b/src/retry.ts',
    );
    expect(gitHeader(file({ change: 'added' }))).toContain('--- /dev/null');
    expect(gitHeader(file({ change: 'deleted' }))).toContain('+++ /dev/null');
    expect(
      gitHeader(file({ change: 'renamed', previousPath: 'src/old.ts' })),
    ).toContain('rename from src/old.ts\nrename to src/retry.ts');
  });

  it('parses a bare patch into hunks with line numbers', () => {
    const parsed = parseFile(file());
    expect(parsed.type).toBe('modify');
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0]?.changes.map((change) => change.type)).toEqual([
      'normal',
      'delete',
      'insert',
      'insert',
      'normal',
    ]);
    expect([...newLinesInPatch(parsed)]).toEqual([34, 35, 36, 37]);
  });
});

describe('placeTokens', () => {
  it('puts each side of a hunk at its absolute line numbers', () => {
    const parsed = parseFile(file());
    const sides = hunkSides(parsed);
    expect(sides[0]?.old.split('\n')).toHaveLength(3);
    expect(sides[0]?.new.split('\n')).toHaveLength(4);

    const line = (text: string) => [{ content: text, color: '#abc' }];
    const tokens = placeTokens(parsed, [
      {
        old: sides[0]!.old.split('\n').map(line),
        new: sides[0]!.new.split('\n').map(line),
      },
    ]);
    expect(tokens.old[33]?.[0]?.children?.[0]).toMatchObject({
      value: '  constructor(private readonly plan: Plan) {',
    });
    expect(tokens.old[34]?.[0]?.children?.[0]).toMatchObject({
      value: '    this.retryBudget = plan.maxRetries;',
    });
    expect(tokens.new[35]?.[0]?.children?.[0]).toMatchObject({
      value: '    this.remaining = remaining;',
    });
    expect(tokens.new[33]?.[0]?.properties).toEqual({
      style: { color: '#abc' },
    });
    expect(tokens.old[35]?.[0]?.children?.[0]).toMatchObject({
      value: '  }',
    });
    expect(tokens.old[36]).toBeUndefined();
  });
});

describe('compileComments', () => {
  it('groups by file, orders by line, and says when a line was removed', () => {
    const comments: DraftComment[] = [
      {
        id: '1',
        path: 'src/b.ts',
        line: 20,
        side: 'new',
        text: 'Name this.',
        createdAt: '',
      },
      {
        id: '2',
        path: 'src/a.ts',
        line: 9,
        side: 'old',
        text: 'Why drop the guard?',
        createdAt: '',
      },
      {
        id: '3',
        path: 'src/b.ts',
        line: 4,
        side: 'new',
        text: 'Typo',
        createdAt: '',
      },
    ];
    expect(compileComments(comments)).toBe(
      'src/b.ts:\n  line 4: Typo\n  line 20: Name this.\n\nsrc/a.ts:\n  line 9 (removed): Why drop the guard?',
    );
    expect(compileComments([])).toBe('');
  });
});

describe('buildTree', () => {
  it('folds single-child folders and sorts folders before files', () => {
    const tree = buildTree([
      file({ path: 'src/components/ui/button.tsx' }),
      file({ path: 'src/components/ui/input.tsx' }),
      file({ path: 'src/lib/cx.ts' }),
      file({ path: 'package.json' }),
    ]);
    expect(tree.map((node) => `${node.kind}:${node.name}`)).toEqual([
      'folder:src',
      'file:package.json',
    ]);
    const src = tree[0];
    expect(
      src?.kind === 'folder' &&
        src.children.map((node) => `${node.kind}:${node.name}`),
    ).toEqual(['folder:components/ui', 'folder:lib']);
  });
});
