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
  'package.json': {
    path: 'package.json',
    previousPath: null,
    language: 'json',
    explanation:
      'Moves both packages past their advisories. jsonwebtoken 9 drops the insecure default algorithms, so the verify call is checked next.',
    patch: `@@ -19,11 +19,11 @@
   "dependencies": {
     "express": "^4.19.2",
     "hono": "^4.6.0",
-    "jsonwebtoken": "^8.5.1",
+    "jsonwebtoken": "^9.0.2",
     "knex": "^3.1.0",
-    "lodash": "^4.17.15",
+    "lodash": "^4.17.21",
     "pg": "^8.12.0",
     "zod": "^3.23.8"
   },
   "devDependencies": {
     "vitest": "^2.1.0"
`,
  },
  'pnpm-lock.yaml': {
    path: 'pnpm-lock.yaml',
    previousPath: null,
    language: 'yaml',
    explanation: null,
    patch: `@@ -1203,16 +1203,16 @@ packages:
-  jsonwebtoken@8.5.1:
-    resolution: {integrity: sha512-XjwVfRS6jTMsqYs0EsuJ4LGxXV14zQybNd4L2r0UvbVnSF9Af8x7p5MzbJ90Ioz/9TI41/hTCvznF/loiSzn8w==}
-    engines: {node: '>=4', npm: '>=1.4.28'}
+  jsonwebtoken@9.0.2:
+    resolution: {integrity: sha512-PRp66vJ865SSqOlgDS8Ouxt0hT3Xv+DJc8bv7bb0b9tOlJ1cIZaXp9/0fZlOEgqXSJ9/zc9S1kWz6XaO4m5hHw==}
+    engines: {node: '>=12', npm: '>=6'}

-  lodash@4.17.15:
-    resolution: {integrity: sha512-8xOcRHvCjnocdS5cpwXQXVzmmh5e5+saE2QGoeQmbKmRS6J3VQppPOIt0MnmE+4xlZoumy0GPG0D0MVIQbNA1A==}
+  lodash@4.17.21:
+    resolution: {integrity: sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==}

-  jws@3.2.2:
-    resolution: {integrity: sha512-YHlZCB6lMTllWDtSPHz/ZXTsi8S00usEV6v1tjq8tOUZzw7DpSDWVXjXDre6ed1w/pd495ODpHZYSdkRTsa0HA==}
+  jws@4.0.0:
+    resolution: {integrity: sha512-KDncfTmOQmnSeqpr0zc/zL5gfR5nmTv8QCy+tqbZT6tEtyf+p4Y/K8hR1YJ1Dz0rAvUsNcTtx0k3O/g6EGzUHw==}
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
