# Quality review

The design brief ends with a quality bar: "Do not consider the UI complete
merely because all pages exist." This document records, for each item on
that bar, what was checked, how, and the result. Every claim points at a
test that runs in the gate (`pnpm test`, `pnpm test:e2e`, `pnpm test:visual`)
or at a measurement from one of them. Items that are not fully met say so.

Reviewed on 6 November 2026 against the frontend running on the contract
dev API. The product's real analysis, agents and pull requests need the
backend; this review covers the interface and its behaviour on dev data.

## The design quality bar

| #   | Question                                                                  | Result                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Does the interface feel cohesive across every route?                      | Met                        | One shell, one token set and three materials on every route. `e2e/visual.spec.ts` records 15 routes in both themes plus 4 phone views and fails on any pixel drift; `e2e/responsive.spec.ts` visits all 14 app routes at three widths.                                                                                                                                                                                                                        |
| 2   | Is the hierarchy immediately understandable?                              | Met                        | Every route has exactly one `h1` and a one-line description, asserted for all routes in `e2e/a11y.spec.ts`. The overview orders sections by what needs a person first (`e2e/overview.spec.ts`).                                                                                                                                                                                                                                                               |
| 3   | Does every glass effect improve the experience?                           | Met, with a measured limit | Glass is used only where something floats over content: popovers, menus, dialogs and the sign-in card (`material-popover` 5 uses, `material-overlay` 6). Content panels are solid (`material-solid` 70 uses). Ten stacked glass layers over moving colour cost 31 to 45 ms a frame on the test machine's software renderer (`e2e/perf/glass.spec.ts`), so the product never stacks more than two.                                                             |
| 4   | Are code and logs comfortable to read for long periods?                   | Met                        | Code uses the theme's own token colours in both themes through Shiki, not a bundled theme (`e2e/theme.spec.ts`, `e2e/review.spec.ts`). Logs are fixed 22 px rows, no wrapping, search with highlighted matches and stepping, and a follow mode that yields when you scroll up (`e2e/logs.spec.ts`). Every route passes axe's contrast rules (`e2e/a11y.spec.ts`).                                                                                             |
| 5   | Are interactions immediate and predictable?                               | Met                        | Motion stays between 120 and 280 ms and respects reduced motion (`e2e/motion.spec.ts`). Irreversible actions go through a confirm dialog that says what happens next: approve, reject, cancel, disconnect, open a pull request (`e2e/workspace.spec.ts`, `e2e/repositories.spec.ts`). Buttons show a busy state while a request is in flight (`e2e/product.spec.ts`).                                                                                         |
| 6   | Does the application remain usable during long-running tasks?             | Met                        | The live layer batches events every 32 ms, keeps order, fills gaps, reconnects with backoff, and marks a stale or offline stream (`src/lib/live/*.test.ts`, `e2e/live.spec.ts`). A person can leave a running task and come back, or cancel it (`e2e/mvp.spec.ts`, `e2e/workspace.spec.ts`).                                                                                                                                                                  |
| 7   | Are loading, empty, error and success states fully designed?              | Met                        | Every page component renders a loading state and an error state with retry, and every list that can be empty has an empty state with a way forward (`ErrorState` appears in all 13 page components, `EmptyState` in the 11 that have lists). Error, offline and maintenance pages share one shape (`e2e/system.spec.ts`). Success is explicit: verified, approved, pull request opened.                                                                       |
| 8   | Does the layout work at narrow widths?                                    | Met, with one trade-off    | No route overflows horizontally at 390, 820 or 1280 px, and on touch screens no visible control is under 36 px (`e2e/responsive.spec.ts`). Trade-off: data tables scroll sideways inside their panel on a phone rather than reflowing into cards.                                                                                                                                                                                                             |
| 9   | Is keyboard navigation reliable?                                          | Met                        | A skip link is the first tab stop; the core path from the overview to a running task and a decision works with the keyboard alone, dialogs trap and return focus, and a live region announces run changes (`e2e/a11y.spec.ts`). Shortcuts and the command palette have their own suite (`e2e/palette.spec.ts`).                                                                                                                                               |
| 10  | Does the application remain performant under frequent updates?            | Met                        | Fifty events a second keep frame medians at 16.7 ms; a 500-file diff is visible in under a second and its tree scrolls at 17 ms a frame; 100,000 log lines and 10,000 table rows scroll within budget (`e2e/perf/*.spec.ts`, budgets: median under 45 ms, p95 under 150 ms).                                                                                                                                                                                  |
| 11  | Does the design communicate technical trust rather than visual gimmickry? | Met                        | The data source badge is always visible. A run is verified only when every required check ran and passed, enforced in the contract itself (`packages/contract`). Estimated, actual and unavailable costs carry different labels (`e2e/usage.spec.ts`). Confirmed findings and suspicions are separate sections (`e2e/security.spec.ts`). Nothing in the interface merges (`e2e/pull-requests.spec.ts`). Agent notes are labelled apart from execution events. |

## The product brief's design section

The product brief asks for a professional, minimal design with clean
typography, restrained colour, a clear hierarchy, dark and light themes,
clear execution status, readable code, dense information without clutter,
and responsive layouts. Items 1, 2, 4 and 8 above cover those. The two it
adds:

| Requirement                                                                                                                          | Result | Evidence                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main navigation: Overview, Repositories, Engineering Tasks, Security, Pull Requests, Execution History, Usage, Organization Settings | Met    | All eight are in the sidebar in that order under the brief's names, and `e2e/shell.spec.ts` asserts the list. The phone's bottom bar shortens the labels.                                                                                                                     |
| Move from repository selection to task execution, code inspection and final review without unrelated pages                           | Met    | A repository page starts a task with the repository preselected (added in this review, `e2e/repository.spec.ts`); the task page links to its review and report; the review page carries the decision. The twelve-step walk in `e2e/mvp.spec.ts` follows that path end to end. |

## The twelve MVP steps

`e2e/mvp.spec.ts` walks the acceptance criteria as one person in one
session, on a repository and a task of their own: sign in, connect a
repository and see its permissions, request a task, inspect the plan, watch
it run, see the files, read the diff, review commands and checks, read the
verdict, approve, open a pull request, and come back later through the
history and the report. It also confirms that unverified and failed runs are
labelled as such. Result: passes against the dev API in under three
minutes, in the gate's browser suite. On the way it exposed the stale
decision controls described below.

## Visual regression

`pnpm test:visual` compares 15 routes in both themes and 4 phone views
against baselines in `apps/web/e2e/visual/`, with relative times, the
report's generation time and the unread badge masked. The baselines were
captured on Linux headless Chromium; on another platform they must be
regenerated with `--update-snapshots` before the comparison means anything.
Result: all 40 pictures matched on a second run against a fresh server, and
changing the accent colour fails the overview and composer pictures.

## What the review changed

- The repository page had no way to start a task on that repository, so the
  path from a repository to execution went through the Tasks list. It now has
  a New task action that preselects the repository (`e2e/repository.spec.ts`).
- Signing in from a protected page always landed on the overview, although
  the sign-in link carried the original page. The target now survives the
  GitHub round trip in session storage, on that tab alone, and is accepted
  only as a path on this app (`src/lib/auth.test.ts`, `e2e/auth.spec.ts`).
- Watching a run reach "awaiting approval" never showed the decision
  controls: they key off the task record, which was only read once. The
  workspace now reads the task again whenever the live run's status moves,
  so approve, request changes and reject appear the moment the run waits
  (`e2e/mvp.spec.ts`, step 7).
- Seeded history was stamped with the server's start time whenever a run
  reached "awaiting approval", so every such task read "updated n minutes
  ago" with the server's own age, and near-ties reordered rows between
  runs. The dev API now dates the task and its notification to the event
  that moved them (`apps/dev-api/src/runs.test.ts`).

## Open points

- Data tables on phones scroll sideways inside their panel. A card layout
  for narrow screens would read better. Not done in this phase.
- Stacked glass is expensive under software rendering. The ten-layer stress
  test sits at 31 to 45 ms against a 45 ms budget on the test machine; the
  product keeps to two layers, and the budget guards against regressions.
- The visual baselines are platform-specific.
