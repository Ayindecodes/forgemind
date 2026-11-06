import { describe, expect, it } from 'vitest';

import {
  chordMatches,
  formatKeys,
  goTargets,
  parseChord,
  ShortcutMatcher,
  shortcuts,
  type KeyLike,
} from './shortcuts';

const key = (overrides: Partial<KeyLike> & Pick<KeyLike, 'key'>): KeyLike => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe('chordMatches', () => {
  it('accepts either modifier for mod', () => {
    const chord = parseChord('mod+k');

    expect(chordMatches(key({ key: 'k', metaKey: true }), chord)).toBe(true);
    expect(chordMatches(key({ key: 'K', ctrlKey: true }), chord)).toBe(true);
    expect(chordMatches(key({ key: 'k' }), chord)).toBe(false);
    expect(
      chordMatches(key({ key: 'k', ctrlKey: true, altKey: true }), chord),
    ).toBe(false);
  });

  it('matches shifted characters as typed', () => {
    expect(
      chordMatches(key({ key: '?', shiftKey: true }), parseChord('?')),
    ).toBe(true);
    expect(
      chordMatches(key({ key: '/', shiftKey: false }), parseChord('?')),
    ).toBe(false);
  });

  it('keeps plain letters plain', () => {
    expect(chordMatches(key({ key: 'g' }), parseChord('g'))).toBe(true);
    expect(
      chordMatches(key({ key: 'G', shiftKey: true }), parseChord('g')),
    ).toBe(false);
  });
});

describe('ShortcutMatcher', () => {
  const matcher = () => new ShortcutMatcher(shortcuts, 1000);

  it('fires single-chord shortcuts', () => {
    expect(
      matcher().handle(key({ key: 'k', ctrlKey: true }), {
        editable: false,
        now: 0,
      }),
    ).toBe('palette');
    expect(
      matcher().handle(key({ key: 'n' }), { editable: false, now: 0 }),
    ).toBe('newTask');
  });

  it('fires a sequence within the timeout and forgets it after', () => {
    const m = matcher();
    expect(m.handle(key({ key: 'g' }), { editable: false, now: 0 })).toBeNull();
    expect(m.handle(key({ key: 's' }), { editable: false, now: 500 })).toBe(
      'go.security',
    );

    expect(
      m.handle(key({ key: 'g' }), { editable: false, now: 1000 }),
    ).toBeNull();
    expect(
      m.handle(key({ key: 's' }), { editable: false, now: 2500 }),
    ).toBeNull();
  });

  it('ignores single keys while typing but keeps modifier chords', () => {
    const m = matcher();
    expect(m.handle(key({ key: 'n' }), { editable: true, now: 0 })).toBeNull();
    expect(m.handle(key({ key: 'g' }), { editable: true, now: 0 })).toBeNull();
    expect(m.handle(key({ key: 'o' }), { editable: true, now: 10 })).toBeNull();
    expect(
      m.handle(key({ key: 'k', metaKey: true }), { editable: true, now: 20 }),
    ).toBe('palette');
  });

  it('has a target for every go-to shortcut', () => {
    for (const { id } of shortcuts.filter((item) =>
      item.id.startsWith('go.'),
    )) {
      expect(goTargets[id], id).toBeTruthy();
    }
  });
});

describe('formatKeys', () => {
  it('renders chords and sequences for the platform', () => {
    expect(formatKeys('mod+k', '⌘')).toEqual([['⌘', 'K']]);
    expect(formatKeys('mod+k', 'Ctrl')).toEqual([['Ctrl', 'K']]);
    expect(formatKeys('g ,', 'Ctrl')).toEqual([['G'], [',']]);
    expect(formatKeys('?', 'Ctrl')).toEqual([['?']]);
  });
});
