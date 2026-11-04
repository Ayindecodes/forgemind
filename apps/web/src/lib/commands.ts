export type Command = {
  id: string;
  label: string;
  group: string;
  /** Other words that should find this command. */
  keywords?: readonly string[];
};

const normalize = (text: string) => text.toLocaleLowerCase('en-US').trim();

/**
 * The commands that match a query, in their original order so groups stay
 * together. Every word typed has to appear in the label or the keywords, so
 * "dark th" finds "Use dark theme" while "dark repo" finds nothing.
 */
export function matchCommands<T extends Command>(
  commands: readonly T[],
  query: string,
): T[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...commands];

  return commands.filter((command) => {
    const haystack = normalize(
      [command.label, ...(command.keywords ?? [])].join(' '),
    );

    return terms.every((term) => haystack.includes(term));
  });
}

/** Splits commands into their groups, keeping the order each group first appears in. */
export function groupCommands<T extends Command>(commands: readonly T[]) {
  const groups = new Map<string, T[]>();

  for (const command of commands) {
    const group = groups.get(command.group);

    if (group) group.push(command);
    else groups.set(command.group, [command]);
  }

  return [...groups].map(([name, items]) => ({ name, items }));
}

/** The next command for the arrow keys, wrapping at both ends. */
export function stepCommand<T extends Command>(
  commands: readonly T[],
  current: T | undefined,
  step: 1 | -1,
): T | undefined {
  if (commands.length === 0) return undefined;

  const index = current ? commands.indexOf(current) : -1;
  if (index === -1) return step === 1 ? commands[0] : commands.at(-1);

  return commands[(index + step + commands.length) % commands.length];
}
