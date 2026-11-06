'use client';

import 'react-diff-view/style/index.css';
import '@/styles/diff.css';

import type {
  DiffFile,
  Finding,
  PullRequest,
  Run,
  Task,
} from '@forgemind/contract';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Columns2, Rows3 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { TaskActions } from '@/components/run/task-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SkeletonText } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Status } from '@/components/ui/status';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { request } from '@/lib/api-client';
import { usePullRequests, useRun, useTask } from '@/lib/queries';
import {
  compileComments,
  loadDrafts,
  saveDrafts,
  type DraftComment,
} from '@/lib/review/comments';
import { newLinesInPatch, parseFile } from '@/lib/review/parse';
import { useMediaQuery } from '@/lib/use-media-query';

import { anchorId, DiffView, type LineRef, type ViewType } from './diff-view';
import { EvidencePanel, type Placement } from './evidence-panel';
import { FileTree } from './file-tree';

/*
 * The code review workspace: the changed files, one file's diff with the
 * reviewer's draft comments, and the evidence beside it. On a phone it is
 * one panel at a time, file by file. Decisions go through the same actions
 * as the run page; drafted comments travel as the revision's instructions.
 */

const hashOf = (path: string, line: number) => `#${path}:L${line}`;
const parseHash = (hash: string) => {
  const match = /^#(.+):L(\d+)$/.exec(decodeURIComponent(hash));
  return match ? { path: match[1] ?? '', line: Number(match[2]) } : null;
};

export function ReviewWorkspace({ taskId }: { taskId: string }) {
  const task = useTask(taskId);
  const runId = task.data?.runId;
  const run = useRun(runId);
  const diff = useQuery({
    queryKey: ['run-diff', runId],
    queryFn: ({ signal }) =>
      request('runDiff', { params: { id: runId ?? '' }, signal }),
    enabled: runId !== undefined,
  });
  const findings = useQuery({
    queryKey: ['findings', runId],
    queryFn: async ({ signal }) =>
      (
        await request('findings', { query: { limit: 200 }, signal })
      ).items.filter((finding) => finding.runId === runId),
    enabled: runId !== undefined,
  });
  const pullRequests = usePullRequests(task.data?.status === 'completed');

  if (task.error || (!task.isPending && !task.data)) return null;
  if (diff.error) {
    return (
      <div className="material-solid">
        <ErrorState
          title="Could not load the patch"
          onRetry={async () => {
            await diff.refetch();
          }}
        />
      </div>
    );
  }
  if (
    task.isPending ||
    run.isPending ||
    diff.isPending ||
    findings.isPending ||
    !task.data ||
    !run.data ||
    !diff.data ||
    !runId
  ) {
    return (
      <div className="material-solid p-4" aria-busy="true">
        <SkeletonText lines={6} />
      </div>
    );
  }
  if (diff.data.files.length === 0) {
    return (
      <div className="material-solid">
        <EmptyState
          title="No patch to review"
          description={
            run.data.expectsPatch
              ? 'This run produced no change.'
              : 'This task was an investigation; it was not expected to change code.'
          }
        />
      </div>
    );
  }

  return (
    <ReviewBody
      key={runId}
      task={task.data}
      run={run.data}
      files={diff.data.files}
      findings={findings.data ?? []}
      pullRequest={
        pullRequests.data?.items.find((pr) => pr.taskId === taskId) ?? null
      }
    />
  );
}

function ReviewBody({
  task,
  run,
  files,
  findings,
  pullRequest,
}: {
  task: Task;
  run: Run;
  files: DiffFile[];
  findings: Finding[];
  pullRequest: PullRequest | null;
}) {
  const wide = useMediaQuery('(min-width: 64rem)');
  // The reader's own choice wins; until they make one, the screen decides.
  const [chosenView, setChosenView] = useState<ViewType | null>(null);
  const viewType: ViewType = chosenView ?? (wide ? 'split' : 'unified');

  const [selection, setSelection] = useState<{
    path: string | null;
    line: LineRef | null;
  }>(() => {
    const fromHash =
      typeof window === 'undefined' ? null : parseHash(window.location.hash);
    const target =
      fromHash && files.some((file) => file.path === fromHash.path)
        ? fromHash
        : null;
    return {
      path: target?.path ?? files[0]?.path ?? null,
      line: target ? { side: 'new', line: target.line } : null,
    };
  });
  const [composer, setComposer] = useState<LineRef | null>(null);
  const [comments, setComments] = useState<DraftComment[]>(() =>
    typeof window === 'undefined' ? [] : loadDrafts(run.id),
  );
  const [mobileTab, setMobileTab] = useState('files');

  useEffect(() => {
    saveDrafts(run.id, comments);
  }, [run.id, comments]);

  // Bring the selected line into view once its row exists.
  useEffect(() => {
    if (!selection.path || !selection.line) return;
    const id = anchorId(selection.path, selection.line);
    const timer = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'center' });
    }, 0);
    return () => clearTimeout(timer);
  }, [selection]);

  const placements = useMemo(() => {
    const result: Record<string, Placement> = {};
    const parsed = new Map(
      files.map((file) => [file.path, newLinesInPatch(parseFile(file))]),
    );
    for (const finding of findings) {
      const lines = parsed.get(finding.location.path);
      result[finding.id] = !lines
        ? 'file-not-in-patch'
        : finding.location.line === null || lines.has(finding.location.line)
          ? 'in-patch'
          : 'line-not-in-patch';
    }
    return result;
  }, [files, findings]);

  const selectFile = useCallback((path: string) => {
    setSelection({ path, line: null });
    setComposer(null);
    setMobileTab('diff');
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const showFinding = (finding: Finding) => {
    const line = finding.location.line ?? 1;
    setSelection({
      path: finding.location.path,
      line: { side: 'new', line },
    });
    setComposer(null);
    setMobileTab('diff');
    window.history.replaceState(null, '', hashOf(finding.location.path, line));
  };

  const selectedFile =
    files.find((file) => file.path === selection.path) ?? files[0];
  const saveComment = (ref: LineRef, text: string) => {
    if (!selectedFile) return;
    setComments((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}`,
        path: selectedFile.path,
        line: ref.line,
        side: ref.side,
        text,
        createdAt: new Date().toISOString(),
      },
    ]);
    setComposer(null);
  };

  const commentCounts = comments.reduce<Record<string, number>>(
    (acc, comment) => {
      acc[comment.path] = (acc[comment.path] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const totals = files.reduce(
    (acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );

  const diffPanel = selectedFile && (
    <DiffView
      key={selectedFile.path}
      file={selectedFile}
      viewType={viewType}
      selected={selection.line}
      comments={comments}
      composer={composer}
      onOpenComposer={(ref) => setComposer(ref)}
      onCloseComposer={() => setComposer(null)}
      onSaveComment={saveComment}
      onDeleteComment={(id) =>
        setComments((current) => current.filter((comment) => comment.id !== id))
      }
    />
  );
  const treePanel = (
    <div className="material-solid py-1">
      <FileTree
        files={files}
        selected={selectedFile?.path ?? null}
        commentCounts={commentCounts}
        onSelect={selectFile}
      />
    </div>
  );
  const evidencePanel = (
    <EvidencePanel
      run={run}
      findings={findings}
      placements={placements}
      onShowFinding={showFinding}
    />
  );

  return (
    <div
      data-testid="review-workspace"
      data-files={files.length}
      data-selected={selectedFile?.path ?? ''}
      data-comments={comments.length}
      className="flex flex-col gap-4"
    >
      <section
        aria-label="Review summary"
        className="material-solid flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
      >
        <Button asChild size="sm" variant="ghost" icon={<ArrowLeft />}>
          <Link href={`/tasks/${task.id}`}>Run</Link>
        </Button>
        {run.outcome && (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/tasks/${task.id}/report`} data-testid="open-report">
              Report
            </Link>
          </Button>
        )}
        <span className="text-sm text-fg-secondary tabular-nums">
          {files.length} {files.length === 1 ? 'file' : 'files'},{' '}
          <span className="text-success-fg">+{totals.additions}</span>{' '}
          <span className="text-error-fg">−{totals.deletions}</span>
        </span>
        <Status
          status={
            run.verification === 'verified'
              ? 'verified'
              : run.verification === 'failed'
                ? 'failed'
                : run.verification === 'unverified'
                  ? 'unverified'
                  : 'pending'
          }
          size="sm"
        />
        {comments.length > 0 && (
          <Badge tone="accent" data-testid="draft-count">
            {comments.length} draft{' '}
            {comments.length === 1 ? 'comment' : 'comments'}
          </Badge>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Diff layout" className="flex gap-1">
            <Button
              size="sm"
              variant={viewType === 'unified' ? 'secondary' : 'ghost'}
              icon={<Rows3 />}
              aria-pressed={viewType === 'unified'}
              onClick={() => setChosenView('unified')}
              data-testid="view-unified"
            >
              Unified
            </Button>
            <Button
              size="sm"
              variant={viewType === 'split' ? 'secondary' : 'ghost'}
              icon={<Columns2 />}
              aria-pressed={viewType === 'split'}
              onClick={() => setChosenView('split')}
              data-testid="view-split"
            >
              Split
            </Button>
          </div>
          <TaskActions
            task={task}
            pullRequest={pullRequest}
            draftInstructions={compileComments(comments)}
          />
        </div>
      </section>

      {wide ? (
        <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_20rem]">
          <div className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
            {treePanel}
          </div>
          <div className="min-w-0 lg:col-start-2 lg:row-start-1">
            {diffPanel}
          </div>
          {/* Under the diff on a laptop, beside it on a wide screen. */}
          <div className="min-w-0 lg:col-start-2 lg:row-start-2 xl:col-start-3 xl:row-span-2 xl:row-start-1">
            {evidencePanel}
          </div>
        </div>
      ) : (
        <Tabs
          value={mobileTab}
          onValueChange={setMobileTab}
          data-testid="review-tabs"
        >
          <TabsList className="material-solid px-2" aria-label="Review panels">
            <TabsTrigger value="files">Files ({files.length})</TabsTrigger>
            <TabsTrigger value="diff">Diff</TabsTrigger>
            <TabsTrigger value="evidence">Evidence</TabsTrigger>
          </TabsList>
          <TabsContent value="files" className="pt-4">
            {treePanel}
          </TabsContent>
          <TabsContent value="diff" className="flex flex-col gap-3 pt-4">
            <Button
              size="sm"
              variant="ghost"
              icon={<ArrowLeft />}
              className="self-start"
              onClick={() => setMobileTab('files')}
              data-testid="back-to-files"
            >
              All files
            </Button>
            {diffPanel}
          </TabsContent>
          <TabsContent value="evidence" className="pt-4">
            {evidencePanel}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
