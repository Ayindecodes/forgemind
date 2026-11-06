'use client';

import {
  CreateTask,
  TaskCategory,
  type TaskCategory as Category,
} from '@forgemind/contract';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { SkeletonText } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/states';
import { ApiRequestError, request } from '@/lib/api-client';
import { keys, useRepositories, useSession } from '@/lib/queries';
import { categoryHelp, categoryLabels, defaultBudget } from '@/lib/tasks';
import { toast } from '@/lib/toast';

/*
 * Where a task begins. What is asked is kept verbatim; the type sets the
 * agents the run needs; the budget caps time, retries and tokens, so a run
 * cannot spend more than agreed. On success the page becomes the live run.
 */

const RUNNERS = ['owner', 'admin', 'developer'];

export function TaskComposer() {
  const router = useRouter();
  const client = useQueryClient();
  const params = useSearchParams();
  const session = useSession();
  const repositories = useRepositories();
  const connected = (repositories.data?.items ?? []).filter(
    ({ status }) => status === 'connected' || status === 'analyzing',
  );

  const [repositoryId, setRepositoryId] = useState(
    params.get('repository') ?? '',
  );
  const [category, setCategory] = useState<Category>('fix_bug');
  const [title, setTitle] = useState('');
  const [requestText, setRequestText] = useState('');
  const [budget, setBudget] = useState({ ...defaultBudget });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: () => {
      const parsed = CreateTask.safeParse({
        repositoryId: repositoryId || connected[0]?.id,
        title: title.trim(),
        request: requestText.trim(),
        category,
        budget,
      });
      if (!parsed.success) {
        const next: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = String(issue.path[0] ?? 'form');
          next[key] ??=
            key === 'title'
              ? 'Give the task a short title.'
              : key === 'request'
                ? 'Say what should change, in your own words.'
                : key === 'repositoryId'
                  ? 'Pick a repository.'
                  : issue.message;
        }
        setErrors(next);
        return Promise.reject(new Error('invalid'));
      }
      setErrors({});
      return request('createTask', { body: parsed.data });
    },
    onSuccess: async (task) => {
      toast({
        title: 'Task started',
        description: task.title,
        tone: 'success',
      });
      await client.invalidateQueries({ queryKey: keys.tasks });
      router.push(`/tasks/${task.id}`);
    },
    onError: (error) => {
      if (error.message === 'invalid') return;
      toast({
        title: 'Could not start the task',
        description:
          error instanceof ApiRequestError
            ? error.message
            : 'The API did not answer.',
        tone: 'error',
      });
    },
  });

  const canRun = RUNNERS.includes(session.data?.role ?? '');
  if (session.data && !canRun) {
    return (
      <div className="material-solid">
        <EmptyState
          title="Your role cannot start tasks"
          description="Owners, admins and developers can. Ask one of them, or review what is already running."
        />
      </div>
    );
  }
  if (repositories.isPending) {
    return (
      <div className="material-solid p-4" aria-busy="true">
        <SkeletonText lines={6} />
      </div>
    );
  }
  if (connected.length === 0) {
    return (
      <div className="material-solid">
        <EmptyState
          title="Connect a repository first"
          description="A task needs a repository ForgeMind can read."
          action={
            <Button asChild variant="primary">
              <Link href="/repositories">Repositories</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <form
      className="material-solid flex flex-col gap-5 p-5"
      data-testid="task-composer"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Repository" error={errors.repositoryId}>
          <Select
            aria-label="Repository"
            value={repositoryId || connected[0]?.id || ''}
            onValueChange={setRepositoryId}
            data-testid="composer-repository"
          >
            {connected.map((repo) => (
              <SelectItem key={repo.id} value={repo.id}>
                {repo.fullName}
              </SelectItem>
            ))}
          </Select>
        </Field>
        <Field label="Type" description={categoryHelp[category]}>
          <Select
            aria-label="Type"
            value={category}
            onValueChange={(value) => setCategory(value as Category)}
            data-testid="composer-category"
          >
            {TaskCategory.options.map((option) => (
              <SelectItem key={option} value={option}>
                {categoryLabels[option]}
              </SelectItem>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Title" error={errors.title}>
        <Input
          data-testid="composer-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          placeholder="Fix the retry budget overflow"
        />
      </Field>
      <Field
        label="What should happen"
        description="Kept word for word. Say what is wrong, what done looks like, and anything that must not change."
        error={errors.request}
      >
        <Textarea
          data-testid="composer-request"
          value={requestText}
          onChange={(event) => setRequestText(event.target.value)}
          rows={6}
          maxLength={5000}
        />
      </Field>
      <fieldset className="grid gap-4 rounded-md border border-line p-4 md:grid-cols-3">
        <legend className="px-1 text-sm font-medium">Budget</legend>
        <Field label="Minutes" description="1 to 480">
          <Input
            type="number"
            min={1}
            max={480}
            data-testid="composer-minutes"
            value={budget.maxMinutes}
            onChange={(event) =>
              setBudget({ ...budget, maxMinutes: Number(event.target.value) })
            }
          />
        </Field>
        <Field label="Retries" description="0 to 10">
          <Input
            type="number"
            min={0}
            max={10}
            data-testid="composer-retries"
            value={budget.maxRetries}
            onChange={(event) =>
              setBudget({ ...budget, maxRetries: Number(event.target.value) })
            }
          />
        </Field>
        <Field label="Tokens" description="At least 1,000">
          <Input
            type="number"
            min={1000}
            step={1000}
            data-testid="composer-tokens"
            value={budget.maxTokens}
            onChange={(event) =>
              setBudget({ ...budget, maxTokens: Number(event.target.value) })
            }
          />
        </Field>
        {errors.budget && (
          <p className="text-sm text-error-fg md:col-span-3">{errors.budget}</p>
        )}
      </fieldset>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="submit"
          variant="primary"
          loading={create.isPending}
          data-testid="composer-start"
        >
          Start task
        </Button>
      </div>
    </form>
  );
}
