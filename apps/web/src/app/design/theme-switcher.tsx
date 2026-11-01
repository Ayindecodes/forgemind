'use client';

import { setThemePreference, themePreferences } from '@/lib/theme';
import { useThemePreference } from '@/lib/use-theme-preference';

export function ThemeSwitcher() {
  const current = useThemePreference();

  return (
    <fieldset className="flex gap-0.5 rounded-lg border border-line bg-surface p-0.5">
      <legend className="sr-only">Theme</legend>
      {themePreferences.map((preference) => (
        <label
          key={preference}
          className="cursor-pointer rounded-md px-3 py-1 text-sm text-fg-secondary capitalize transition-colors hover:bg-hover has-checked:bg-elevated has-checked:text-fg has-checked:shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
        >
          <input
            type="radio"
            name="theme"
            value={preference}
            checked={current === preference}
            onChange={() => setThemePreference(preference)}
            className="sr-only"
          />
          {preference}
        </label>
      ))}
    </fieldset>
  );
}
