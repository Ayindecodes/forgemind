import { z } from 'zod';

import { Id, Timestamp } from './common';

export const Severity = z.enum(['critical', 'high', 'medium', 'low', 'info']);

/** Confirmed findings have evidence; the rest are suspicions and say so. */
export const Confidence = z.enum(['confirmed', 'likely', 'suspected']);

export const FindingCategory = z.enum([
  'vulnerable_dependency',
  'exposed_credential',
  'injection',
  'deserialization',
  'xss',
  'access_control',
  'subprocess',
  'configuration',
  'missing_tests',
  'other',
]);

export const Finding = z.object({
  id: Id,
  repositoryId: Id,
  runId: Id.nullable(),
  title: z.string().min(1),
  severity: Severity,
  confidence: Confidence,
  category: FindingCategory,
  location: z.object({
    path: z.string().min(1),
    line: z.int().min(1).nullable(),
  }),
  evidence: z.string(),
  remediation: z.string(),
  advisoryUrl: z.url().nullable(),
  /** The scanner or agent that raised it. */
  tool: z.string().min(1),
  status: z.enum(['open', 'fixed', 'dismissed']),
  detectedAt: Timestamp,
});

export const FindingQuery = z.object({
  repositoryId: Id.optional(),
  severity: Severity.optional(),
  status: Finding.shape.status.optional(),
});

export type Severity = z.infer<typeof Severity>;
export type Confidence = z.infer<typeof Confidence>;
export type Finding = z.infer<typeof Finding>;
export type FindingQuery = z.infer<typeof FindingQuery>;
