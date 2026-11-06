import { describe, expect, it } from 'vitest';

import { highlight, isCodeLanguage } from './highlight';

const colorsOf = (lines: Awaited<ReturnType<typeof highlight>>) =>
  new Set(lines.flat().map(({ color }) => color));

describe('highlight', () => {
  it('colors tokens with the code color tokens', async () => {
    const [line = []] = await highlight('const total = 1;', 'typescript');
    const keyword = line.find(({ content }) => content === 'const');

    expect(keyword?.color).toBe('var(--color-code-token-keyword)');
    expect(colorsOf([line]).size).toBeGreaterThan(1);
  });

  it('keeps every line, including blank ones', async () => {
    const lines = await highlight('a\n\nb', 'text');

    expect(lines).toHaveLength(3);
    expect(
      lines.map((line) => line.map(({ content }) => content).join('')),
    ).toEqual(['a', '', 'b']);
  });

  it('uses one color for plain text', async () => {
    expect(colorsOf(await highlight('const total = 1;', 'text')).size).toBe(1);
  });

  it('loads languages on demand', async () => {
    const [line = []] = await highlight('def run():\n    pass', 'python');

    expect(line.some(({ color }) => color?.includes('keyword'))).toBe(true);
  });
});

describe('isCodeLanguage', () => {
  it('accepts the supported languages and plain text', () => {
    expect(isCodeLanguage('tsx')).toBe(true);
    expect(isCodeLanguage('text')).toBe(true);
    expect(isCodeLanguage('cobol')).toBe(false);
  });
});
