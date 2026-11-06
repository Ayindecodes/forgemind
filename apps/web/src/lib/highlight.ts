import { createCssVariablesTheme, createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguages } from 'shiki/langs';
import type { HighlighterCore, ThemedToken } from 'shiki/core';

/*
 * Syntax highlighting for code blocks. Runs on the server. Colors come out as
 * CSS variables, so the --color-code-* tokens style every language, and the
 * contrast audit covers them.
 */

export const codeLanguages = [
  'typescript',
  'tsx',
  'javascript',
  'json',
  'bash',
  'python',
  'diff',
  'yaml',
  'markdown',
  'css',
  'html',
  'go',
  'rust',
] as const;

export type CodeLanguage = (typeof codeLanguages)[number] | 'text';

export const isCodeLanguage = (value: string): value is CodeLanguage =>
  value === 'text' || codeLanguages.some((lang) => lang === value);

const THEME = 'forgemind';

const theme = createCssVariablesTheme({
  name: THEME,
  variablePrefix: '--color-code-',
});

let highlighterPromise: Promise<HighlighterCore> | undefined;

function getHighlighter() {
  highlighterPromise ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [theme],
    langs: [],
  });

  return highlighterPromise;
}

export type CodeLine = ThemedToken[];

export async function highlight(
  code: string,
  lang: CodeLanguage = 'text',
): Promise<CodeLine[]> {
  const highlighter = await getHighlighter();

  if (lang !== 'text' && !highlighter.getLoadedLanguages().includes(lang)) {
    await highlighter.loadLanguage(bundledLanguages[lang]);
  }

  // The JavaScript regex engine compiles each grammar on first use, which can
  // take longer than the default 500ms limit; past it, a line comes back as a
  // single token. Highlighting runs on the server, so waiting is fine.
  return highlighter.codeToTokens(code, {
    lang,
    theme: THEME,
    tokenizeTimeLimit: 30_000,
  }).tokens;
}
