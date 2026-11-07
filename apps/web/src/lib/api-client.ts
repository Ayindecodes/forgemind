import {
  ApiError,
  buildPath,
  DATA_SOURCE_HEADER,
  DataSource,
  type EndpointKey,
  endpoints,
  type ErrorCode,
  GITHUB_PROVIDER_HEADER,
  GitHubProviderKind,
} from '@forgemind/contract';
import type { z } from 'zod';

/*
 * The typed client for the contract. Every call names an endpoint, gets typed
 * params, query and body, and returns the parsed response or throws an error
 * the UI can show. It also notes whether the API serves demo or live data.
 */

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Endpoints = typeof endpoints;
type Infer<T> = T extends z.ZodType ? z.infer<T> : never;
type Input<T> = T extends z.ZodType ? z.input<T> : never;

type ParamsOf<K extends EndpointKey> = Endpoints[K] extends { params: infer P }
  ? Infer<P>
  : never;
type QueryOf<K extends EndpointKey> = Endpoints[K] extends { query: infer Q }
  ? Partial<Input<Q>>
  : never;
type BodyOf<K extends EndpointKey> = Endpoints[K] extends { body: infer B }
  ? Infer<B>
  : never;

export type ResponseOf<K extends EndpointKey> = Infer<Endpoints[K]['response']>;

type Maybe<T, Key extends string> = [T] extends [never]
  ? { [P in Key]?: undefined }
  : { [P in Key]: T };

export type RequestOptions<K extends EndpointKey> = {
  signal?: AbortSignal;
} & Maybe<ParamsOf<K>, 'params'> &
  ([QueryOf<K>] extends [never]
    ? { query?: undefined }
    : { query?: QueryOf<K> }) &
  Maybe<BodyOf<K>, 'body'>;

/** The API answered with an error it described. */
export class ApiRequestError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** The API could not be reached at all. */
export class ApiUnreachableError extends Error {
  constructor(readonly url: string) {
    super(`Could not reach the API at ${url}`);
    this.name = 'ApiUnreachableError';
  }
}

/** The API answered, but not with what the contract promises. */
export class ApiContractError extends Error {
  constructor(
    readonly endpoint: EndpointKey,
    readonly issues: z.core.$ZodIssue[],
  ) {
    super(`The response from ${endpoint} does not match the contract`);
    this.name = 'ApiContractError';
  }
}

/*
 * Facts every response states in headers: whether the data is demo or live,
 * and whether sign-in reaches github.com or simulated pages. Components read
 * them through useSyncExternalStore.
 */
let dataSource: DataSource | 'unknown' = 'unknown';
let githubProvider: GitHubProviderKind | 'unknown' = 'unknown';
const sourceListeners = new Set<() => void>();

export const getDataSource = () => dataSource;
export const getGitHubProvider = () => githubProvider;

export function subscribeDataSource(listener: () => void) {
  sourceListeners.add(listener);
  return () => {
    sourceListeners.delete(listener);
  };
}

function noteDataSource(response: Response) {
  const source = DataSource.safeParse(response.headers.get(DATA_SOURCE_HEADER));
  const provider = GitHubProviderKind.safeParse(
    response.headers.get(GITHUB_PROVIDER_HEADER),
  );
  const nextSource = source.success ? source.data : 'unknown';
  const nextProvider = provider.success ? provider.data : 'unknown';
  if (nextSource === dataSource && nextProvider === githubProvider) return;

  dataSource = nextSource;
  githubProvider = nextProvider;
  sourceListeners.forEach((listener) => listener());
}

/** The absolute URL of an endpoint, for callers that don't go through fetch. */
export function urlFor<K extends EndpointKey>(
  key: K,
  options: Pick<RequestOptions<K>, 'params' | 'query'>,
): string {
  const { params, query } = options as {
    params?: Record<string, string>;
    query?: Record<string, unknown>;
  };
  const url = new URL(buildPath(endpoints[key].path, params), API_URL);
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null)
      url.searchParams.set(name, String(value));
  }
  return url.toString();
}

export async function request<K extends EndpointKey>(
  key: K,
  options: RequestOptions<K>,
): Promise<ResponseOf<K>> {
  const endpoint = endpoints[key];
  const { body, signal } = options as { body?: unknown; signal?: AbortSignal };
  const url = urlFor(key, options);

  let response: Response;
  try {
    response = await fetch(url, {
      method: endpoint.method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError')
      throw error;
    throw new ApiUnreachableError(API_URL);
  }

  noteDataSource(response);

  if (!response.ok) {
    const failure = ApiError.safeParse(
      await response.json().catch(() => undefined),
    );
    if (failure.success) {
      const { code, message, details } = failure.data.error;
      throw new ApiRequestError(code, message, response.status, details);
    }
    throw new ApiRequestError(
      'internal',
      `The API answered ${response.status}`,
      response.status,
    );
  }

  const parsed = endpoint.response.safeParse(await response.json());
  if (!parsed.success) throw new ApiContractError(key, parsed.error.issues);

  return parsed.data as ResponseOf<K>;
}
