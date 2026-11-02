'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useState } from 'react';

import { useMotionPresets } from '@/lib/use-motion-presets';

const statuses = ['Queued', 'Running', 'Passed'] as const;

const button =
  'press rounded-md border border-line-control bg-elevated px-3 py-1.5 text-sm font-medium hover:bg-hover';

export function MotionDemos() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(0);
  const titleId = useId();
  const presets = useMotionPresets();

  useEffect(() => {
    if (!dialogOpen) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDialogOpen(false);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialogOpen]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="press"
          className={button}
          onClick={() => undefined}
        >
          Press me
        </button>

        <button
          type="button"
          data-testid="open-dialog"
          className={button}
          onClick={() => setDialogOpen(true)}
        >
          Open dialog
        </button>

        <div className="relative">
          <button
            type="button"
            data-testid="toggle-popover"
            aria-expanded={popoverOpen}
            className={button}
            onClick={() => setPopoverOpen((open) => !open)}
          >
            Toggle popover
          </button>
          <AnimatePresence>
            {popoverOpen && (
              <motion.div
                data-testid="popover"
                role="region"
                aria-label="Popover"
                variants={presets.popover('bottom')}
                initial="initial"
                animate="animate"
                exit="exit"
                className="material-popover absolute top-full left-0 z-10 mt-2 w-60 px-3 py-2 text-sm"
              >
                <p className="font-medium">Attached to its control</p>
                <p className="text-fg-secondary">
                  Rises out of the button and settles in place.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button
          type="button"
          data-testid="toggle-expand"
          aria-expanded={expanded}
          className={button}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? 'Collapse details' : 'Expand details'}
        </button>

        <button
          type="button"
          data-testid="advance-status"
          className={button}
          onClick={() => setStatus((index) => (index + 1) % statuses.length)}
        >
          Advance status
        </button>
        <span
          key={status}
          data-testid="status"
          className="motion-fade-in rounded-md bg-accent-subtle px-2 py-0.5 text-sm font-medium text-accent-fg"
        >
          {statuses[status]}
        </span>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            data-testid="expand"
            variants={presets.collapse}
            initial="initial"
            animate="animate"
            exit="exit"
            className="material-solid overflow-hidden"
          >
            <div className="p-4 font-mono text-code text-fg-secondary">
              <p>$ pnpm test</p>
              <p>Tests 19 passed (19)</p>
              <p>Duration 1.2s</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {dialogOpen && (
          <motion.div
            data-testid="scrim"
            variants={presets.fade}
            initial="initial"
            animate="animate"
            exit="exit"
            className="material-scrim fixed inset-0 z-40 flex items-center justify-center p-6"
            onClick={() => setDialogOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              data-testid="dialog"
              variants={presets.panel}
              className="material-overlay w-full max-w-sm p-5"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 id={titleId} className="text-md font-semibold">
                Approve this patch?
              </h3>
              <p className="mt-1 text-fg-secondary">
                Verification passed. A pull request will be opened on the
                working branch.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className={button}
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="close-dialog"
                  className="press rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
                  onClick={() => setDialogOpen(false)}
                >
                  Approve
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
