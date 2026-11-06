'use client';

import type { PullRequest, Task } from '@forgemind/contract';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { ApiRequestError, request } from '@/lib/api-client';
import { keys, useSession } from '@/lib/queries';
import { toast } from '@/lib/toast';

/*
 * What a person can do to a task right now. Every action goes to the API,
 * which checks the role again; the buttons only mirror that rule.
 */

const RUNNERS = ['owner', 'admin', 'developer'];
const DECIDERS = [...RUNNERS, 'reviewer'];

const failed = (error: unknown) =>
  toast({
    title: 'That did not go through',
    description:
      error instanceof ApiRequestError
        ? error.message
        : 'The API did not answer.',
    tone: 'error',
  });

export function TaskActions({
  task,
  pullRequest,
  draftInstructions,
}: {
  task: Task;
  pullRequest: PullRequest | null;
  /** Text to start a revision request with, such as drafted review comments. */
  draftInstructions?: string;
}) {
  const session = useSession();
  const client = useQueryClient();
  const role = session.data?.role ?? '';
  const canRun = RUNNERS.includes(role);
  const canDecide = DECIDERS.includes(role);
  const [revising, setRevising] = useState(false);
  const [instructions, setInstructions] = useState('');

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.task(task.id) }),
      client.invalidateQueries({ queryKey: keys.tasks }),
      client.invalidateQueries({ queryKey: keys.pullRequests }),
    ]);

  const act = useMutation({
    mutationFn: (action: 'cancelTask' | 'approveTask' | 'rejectTask') =>
      request(action, { params: { id: task.id } }),
    onSuccess: async (_, action) => {
      toast({
        title:
          action === 'cancelTask'
            ? 'Run cancelled'
            : action === 'approveTask'
              ? 'Approved. Nothing merges until a pull request is reviewed.'
              : 'Rejected',
        tone: action === 'approveTask' ? 'success' : 'info',
      });
      await refresh();
    },
    onError: failed,
  });

  const revise = useMutation({
    mutationFn: (text: string) =>
      request('requestRevision', {
        params: { id: task.id },
        body: { instructions: text },
      }),
    onSuccess: async () => {
      setRevising(false);
      setInstructions('');
      toast({
        title: 'Changes requested. A new run starts now.',
        tone: 'info',
      });
      await refresh();
    },
    onError: failed,
  });

  const openPullRequest = useMutation({
    mutationFn: () => request('openPullRequest', { params: { id: task.id } }),
    onSuccess: async (pr) => {
      toast({
        title: `Pull request #${pr.number} opened`,
        description: 'It waits for a human review on GitHub.',
        tone: 'success',
      });
      await refresh();
    },
    onError: failed,
  });

  if (task.status === 'queued' || task.status === 'running') {
    if (!canRun) return null;
    return (
      <ConfirmDialog
        trigger={
          <Button variant="danger" size="sm" data-testid="cancel-run">
            Cancel run
          </Button>
        }
        destructive
        title="Cancel this run?"
        description="The run stops where it is. Nothing it has done becomes a patch, and the task is marked cancelled."
        confirmLabel="Cancel run"
        cancelLabel="Keep running"
        onConfirm={() => act.mutateAsync('cancelTask').then(() => undefined)}
      />
    );
  }

  if (task.status === 'awaiting_approval') {
    if (!canDecide) {
      return (
        <p className="text-sm text-fg-secondary">
          Waiting for an owner, admin, developer or reviewer to decide.
        </p>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ConfirmDialog
          trigger={
            <Button variant="primary" size="sm" data-testid="approve">
              Approve
            </Button>
          }
          title="Approve this result?"
          description="Approving records your decision. Nothing merges or deploys; the next step is a pull request for review on GitHub."
          confirmLabel="Approve"
          onConfirm={() => act.mutateAsync('approveTask').then(() => undefined)}
        />
        <Dialog open={revising} onOpenChange={setRevising}>
          <Button
            variant="secondary"
            size="sm"
            data-testid="request-changes"
            onClick={() => {
              if (instructions.length === 0 && draftInstructions)
                setInstructions(draftInstructions);
              setRevising(true);
            }}
          >
            Request changes
          </Button>
          <DialogContent
            title="Request changes"
            description="Say what should be different. A new run starts from the same base with your instructions."
          >
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (instructions.trim().length > 0)
                  revise.mutate(instructions.trim());
              }}
            >
              <Field label="Instructions">
                <Textarea
                  data-testid="revision-instructions"
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  rows={4}
                  required
                />
              </Field>
              <div className="flex justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="ghost" size="sm" type="button">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  loading={revise.isPending}
                  disabled={instructions.trim().length === 0}
                  data-testid="send-revision"
                >
                  Send and rerun
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        <ConfirmDialog
          trigger={
            <Button variant="danger" size="sm" data-testid="reject">
              Reject
            </Button>
          }
          destructive
          title="Reject this result?"
          description="The task closes as rejected. No pull request is opened."
          confirmLabel="Reject"
          onConfirm={() => act.mutateAsync('rejectTask').then(() => undefined)}
        />
      </div>
    );
  }

  if (task.status === 'completed' && task.decision === 'approved') {
    if (pullRequest) {
      return (
        <Button asChild variant="secondary" size="sm" icon={<ExternalLink />}>
          <a
            href={pullRequest.url}
            target="_blank"
            rel="noreferrer"
            data-testid="view-pull-request"
          >
            View pull request #{pullRequest.number}
          </a>
        </Button>
      );
    }
    if (!canRun) return null;
    return (
      <ConfirmDialog
        trigger={
          <Button variant="primary" size="sm" data-testid="open-pull-request">
            Open pull request
          </Button>
        }
        title="Open a pull request on GitHub?"
        description="ForgeMind pushes the working branch and opens a pull request for people to review. It never merges; merging stays on GitHub, with you."
        confirmLabel="Open pull request"
        onConfirm={() => openPullRequest.mutateAsync().then(() => undefined)}
      />
    );
  }

  return null;
}
