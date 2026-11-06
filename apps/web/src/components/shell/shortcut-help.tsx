'use client';

import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { formatKeys, shortcuts, type ShortcutGroup } from '@/lib/shortcuts';
import { useModifierKey } from '@/lib/use-modifier-key';

const groups: ShortcutGroup[] = ['General', 'Go to', 'Actions'];

export function ShortcutHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mod = useModifierKey();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Keyboard shortcuts"
        description="Single keys work anywhere you are not typing."
        className="max-w-lg"
        data-testid="shortcut-help"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          {groups.map((group) => (
            <section key={group} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-fg-muted">{group}</h3>
              <dl className="flex flex-col gap-1">
                {shortcuts
                  .filter((shortcut) => shortcut.group === group)
                  .map((shortcut) => (
                    <div
                      key={shortcut.id}
                      className="flex items-center justify-between gap-4 text-sm"
                    >
                      <dt>{shortcut.label}</dt>
                      <dd className="flex items-center gap-1">
                        {formatKeys(shortcut.keys, mod).map((chord, index) => (
                          <span
                            key={index}
                            className="flex items-center gap-0.5"
                          >
                            {index > 0 && (
                              <span className="px-0.5 text-xs text-fg-muted">
                                then
                              </span>
                            )}
                            {chord.map((key) => (
                              <Kbd key={key}>{key}</Kbd>
                            ))}
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
