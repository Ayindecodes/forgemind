import type { DiffFile } from '@forgemind/contract';

/* Unified diffs for the files the scenarios change. Invented, like the rest. */

export const patches: Record<
  string,
  Omit<DiffFile, 'additions' | 'deletions' | 'change'>
> = {
  'src/retry.ts': {
    path: 'src/retry.ts',
    previousPath: null,
    language: 'typescript',
    explanation:
      'Carries the remaining budget across revisions instead of resetting it from the plan, so the exhaustion check at line 41 can actually fire.',
    patch: `@@ -34,12 +34,24 @@ export class RetryPolicy {
-  constructor(private readonly plan: Plan) {
-    this.retryBudget = plan.maxRetries;
-  }
+  constructor(
+    private readonly plan: Plan,
+    remaining: number = plan.maxRetries,
+  ) {
+    this.retryBudget = Math.min(remaining, plan.maxRetries);
+  }
 
   canRetry(): boolean {
-    if (this.retryBudget < 0) return;
-    return true;
+    return this.retryBudget > 0;
   }
 
-  consume() {
-    this.retryBudget -= 1;
+  consume(): RetryPolicy {
+    if (!this.canRetry()) {
+      throw new RetryBudgetExhausted(this.plan);
+    }
+    return new RetryPolicy(this.plan, this.retryBudget - 1);
   }
+
+  get remaining(): number {
+    return this.retryBudget;
+  }
 }
`,
  },
  'tests/retry.test.ts': {
    path: 'tests/retry.test.ts',
    previousPath: null,
    language: 'typescript',
    explanation: 'Regression test for the budget carrying across revisions.',
    patch: `@@ -0,0 +1,42 @@
+import { describe, expect, it } from 'vitest';
+
+import { RetryBudgetExhausted, RetryPolicy } from '../src/retry';
+
+const plan = { maxRetries: 2 };
+
+describe('RetryPolicy', () => {
+  it('keeps the remaining budget across revisions', () => {
+    const first = new RetryPolicy(plan).consume();
+    const second = first.consume();
+
+    expect(first.remaining).toBe(1);
+    expect(second.remaining).toBe(0);
+    expect(second.canRetry()).toBe(false);
+  });
+
+  it('refuses to retry past the budget', () => {
+    const exhausted = new RetryPolicy(plan, 0);
+
+    expect(() => exhausted.consume()).toThrow(RetryBudgetExhausted);
+  });
+
+  it('never carries more than the plan allows', () => {
+    expect(new RetryPolicy(plan, 10).remaining).toBe(2);
+  });
+});
`,
  },
  'src/types.ts': {
    path: 'src/types.ts',
    previousPath: null,
    language: 'typescript',
    explanation:
      'Exposes the remaining budget on the run so the orchestrator can show it.',
    patch: `@@ -18,5 +18,6 @@ export type RunState = {
   status: RunStatus;
-  retryBudget: number;
+  retriesUsed: number;
+  retriesRemaining: number;
   startedAt: string;
 };
`,
  },
};
