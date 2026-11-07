import { z } from 'zod';

export const Id = z.string().min(1);
export const Timestamp = z.iso.datetime();

/** Where a response came from. The dev API answers "demo" so the UI can say so. */
export const DataSource = z.enum(['demo', 'live']);
export const DATA_SOURCE_HEADER = 'x-forgemind-data';
/** Whether sign-in goes to github.com or to look-alike pages the API serves. */
export const GitHubProviderKind = z.enum(['simulated', 'github']);
export const GITHUB_PROVIDER_HEADER = 'x-forgemind-github';

export const PageQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const ErrorCode = z.enum([
  'unauthorized',
  'forbidden',
  'not_found',
  'invalid',
  'conflict',
  'rate_limited',
  'internal',
]);

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type Id = z.infer<typeof Id>;
export type DataSource = z.infer<typeof DataSource>;
export type GitHubProviderKind = z.infer<typeof GitHubProviderKind>;
export type PageQuery = z.infer<typeof PageQuery>;
export type ErrorCode = z.infer<typeof ErrorCode>;
export type ApiError = z.infer<typeof ApiError>;
