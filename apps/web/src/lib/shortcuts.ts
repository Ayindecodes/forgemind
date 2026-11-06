/*
 * Keyboard shortcuts. A shortcut is one chord ("mod+k") or a two-chord
 * sequence ("g o"). "mod" is Command on a Mac and Control elsewhere, and
 * either modifier is accepted so a shortcut never depends on detection.
 */

export type ShortcutGroup = 'General' | 'Go to' | 'Actions';

export type ShortcutId =
  | 'palette'
  | 'help'
  | 'sidebar'
  | 'newTask'
  | 'go.overview'
  | 'go.repositories'
  | 'go.tasks'
  | 'go.security'
  | 'go.pullRequests'
  | 'go.history'
  | 'go.usage'
  | 'go.settings';

export type Shortcut = {
  id: ShortcutId;
  keys: string;
  label: string;
  group: ShortcutGroup;
};

export const shortcuts: Shortcut[] = [
  {
    id: 'palette',
    keys: 'mod+k',
    label: 'Open the command palette',
    group: 'General',
  },
  { id: 'help', keys: '?', label: 'Show keyboard shortcuts', group: 'General' },
  {
    id: 'sidebar',
    keys: 'mod+b',
    label: 'Collapse or expand the sidebar',
    group: 'General',
  },
  { id: 'newTask', keys: 'n', label: 'New task', group: 'Actions' },
  { id: 'go.overview', keys: 'g o', label: 'Overview', group: 'Go to' },
  { id: 'go.repositories', keys: 'g r', label: 'Repositories', group: 'Go to' },
  { id: 'go.tasks', keys: 'g t', label: 'Engineering Tasks', group: 'Go to' },
  { id: 'go.security', keys: 'g s', label: 'Security', group: 'Go to' },
  {
    id: 'go.pullRequests',
    keys: 'g p',
    label: 'Pull Requests',
    group: 'Go to',
  },
  { id: 'go.history', keys: 'g h', label: 'Execution History', group: 'Go to' },
  { id: 'go.usage', keys: 'g u', label: 'Usage', group: 'Go to' },
  { id: 'go.settings', keys: 'g ,', label: 'Settings', group: 'Go to' },
];

export const goTargets: Partial<Record<ShortcutId, string>> = {
  'go.overview': '/',
  'go.repositories': '/repositories',
  'go.tasks': '/tasks',
  'go.security': '/security',
  'go.pullRequests': '/pull-requests',
  'go.history': '/history',
  'go.usage': '/usage',
  'go.settings': '/settings',
};

export const shortcutById = (id: ShortcutId) =>
  shortcuts.find((item) => item.id === id);

export type Chord = { key: string; mod: boolean; shift: boolean };

export function parseChord(token: string): Chord {
  const parts = token.split('+');
  const key = parts.at(-1) ?? '';
  return { key, mod: parts.includes('mod'), shift: parts.includes('shift') };
}

export const parseKeys = (keys: string) => keys.split(' ').map(parseChord);

export type KeyLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/** Characters that need Shift, and the key they sit on. */
const SHIFTED: Record<string, string> = { '?': '/' };

export function chordMatches(event: KeyLike, chord: Chord) {
  const mod = event.metaKey || event.ctrlKey;
  if (mod !== chord.mod || event.altKey) return false;

  // Browsers report "?" as the key; synthetic input may report "/" with Shift.
  if (chord.key.length === 1 && !/[a-z0-9]/i.test(chord.key)) {
    const base = SHIFTED[chord.key];
    return (
      event.key === chord.key ||
      (base !== undefined && event.key === base && event.shiftKey)
    );
  }

  return (
    event.key.toLowerCase() === chord.key.toLowerCase() &&
    event.shiftKey === chord.shift
  );
}

/** Typing in a field must never trigger a single-key shortcut. */
export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Labels for the shortcut hint: [["⌘", "K"]] or [["G"], ["O"]] for a sequence. */
export function formatKeys(keys: string, mod: '⌘' | 'Ctrl'): string[][] {
  return parseKeys(keys).map((chord) => [
    ...(chord.mod ? [mod] : []),
    ...(chord.shift ? ['⇧'] : []),
    chord.key.length === 1 ? chord.key.toUpperCase() : chord.key,
  ]);
}

type Pending = { chord: Chord; at: number };

/** Matches key events against the shortcuts, remembering the first key of a sequence. */
export class ShortcutMatcher {
  private pending: Pending | null = null;

  constructor(
    private readonly items: readonly Shortcut[],
    private readonly sequenceTimeout: number,
  ) {}

  handle(
    event: KeyLike,
    { editable, now }: { editable: boolean; now: number },
  ): ShortcutId | null {
    const pending = this.pending;
    this.pending = null;

    if (pending && now - pending.at <= this.sequenceTimeout && !editable) {
      for (const item of this.items) {
        const chords = parseKeys(item.keys);
        if (
          chords.length === 2 &&
          chords[0] &&
          chords[1] &&
          sameChord(chords[0], pending.chord) &&
          chordMatches(event, chords[1])
        ) {
          return item.id;
        }
      }
    }

    for (const item of this.items) {
      const chords = parseKeys(item.keys);
      const [first] = chords;
      if (!first || !chordMatches(event, first)) continue;
      if (editable && !first.mod) continue;

      if (chords.length === 1) return item.id;
      this.pending = { chord: first, at: now };
      return null;
    }

    return null;
  }
}

const sameChord = (a: Chord, b: Chord) =>
  a.key === b.key && a.mod === b.mod && a.shift === b.shift;
