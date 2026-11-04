import { describe, expect, it } from 'vitest';

import {
  groupCommands,
  matchCommands,
  stepCommand,
  type Command,
} from './commands';

const commands: Command[] = [
  { id: 'overview', label: 'Overview', group: 'Go to', keywords: ['home'] },
  { id: 'tasks', label: 'Tasks', group: 'Go to', keywords: ['runs'] },
  { id: 'repos', label: 'Repositories', group: 'Go to', keywords: ['code'] },
  { id: 'dark', label: 'Use dark theme', group: 'Theme' },
  { id: 'light', label: 'Use light theme', group: 'Theme' },
];

const ids = (list: Command[]) => list.map(({ id }) => id);

describe('matchCommands', () => {
  it('returns everything, in order, for an empty query', () => {
    expect(ids(matchCommands(commands, ''))).toEqual(ids(commands));
    expect(ids(matchCommands(commands, '   '))).toEqual(ids(commands));
  });

  it('ignores case and surrounding space', () => {
    expect(ids(matchCommands(commands, '  REPO '))).toEqual(['repos']);
  });

  it('matches keywords as well as labels', () => {
    expect(ids(matchCommands(commands, 'home'))).toEqual(['overview']);
    expect(ids(matchCommands(commands, 'runs'))).toEqual(['tasks']);
  });

  it('needs every word to match', () => {
    expect(ids(matchCommands(commands, 'dark th'))).toEqual(['dark']);
    expect(ids(matchCommands(commands, 'dark repo'))).toEqual([]);
  });

  it('keeps the original order rather than ranking', () => {
    expect(ids(matchCommands(commands, 'theme'))).toEqual(['dark', 'light']);
  });
});

describe('groupCommands', () => {
  it('groups in the order groups first appear', () => {
    const grouped = groupCommands(commands);

    expect(grouped.map(({ name }) => name)).toEqual(['Go to', 'Theme']);
    expect(ids(grouped[0]?.items ?? [])).toEqual([
      'overview',
      'tasks',
      'repos',
    ]);
  });

  it('drops groups with nothing left', () => {
    expect(groupCommands(matchCommands(commands, 'light'))).toEqual([
      { name: 'Theme', items: [commands[4]] },
    ]);
  });
});

describe('stepCommand', () => {
  it('moves forward and back', () => {
    expect(stepCommand(commands, commands[1], 1)).toBe(commands[2]);
    expect(stepCommand(commands, commands[1], -1)).toBe(commands[0]);
  });

  it('wraps at both ends', () => {
    expect(stepCommand(commands, commands[4], 1)).toBe(commands[0]);
    expect(stepCommand(commands, commands[0], -1)).toBe(commands[4]);
  });

  it('starts at the first or last command when nothing is active', () => {
    expect(stepCommand(commands, undefined, 1)).toBe(commands[0]);
    expect(stepCommand(commands, undefined, -1)).toBe(commands[4]);
  });

  it('has nowhere to go in an empty list', () => {
    expect(stepCommand([], undefined, 1)).toBeUndefined();
  });
});
