import { Badge } from '@/components/ui/badge';
import type { RunView } from '@/lib/live/derive';
import { agentLabels } from '@/lib/run-labels';

/** The plan as the architect wrote it. An explanation, so it says so. */
export function PlanPanel({ view }: { view: RunView }) {
  const planning = view.stages.find((stage) => stage.id === 'planning');
  if (!planning || planning.attempts.length === 0) return null;

  return (
    <section
      aria-labelledby="plan-title"
      data-testid="plan"
      className="material-solid"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h2 id="plan-title" className="text-sm font-semibold">
          Plan
        </h2>
        <Badge tone="info">Agent note</Badge>
        {view.plan && (
          <span className="text-xs text-fg-muted">
            {agentLabels[view.plan.agent]}
          </span>
        )}
      </div>
      <div className="px-4 py-3 text-sm">
        {view.plan ? (
          <p className="whitespace-pre-wrap">{view.plan.text}</p>
        ) : (
          <p className="text-fg-secondary">
            The planning stage recorded no plan text.
          </p>
        )}
        {view.plan?.summary && (
          <p className="mt-2 text-fg-secondary">{view.plan.summary}</p>
        )}
      </div>
    </section>
  );
}
