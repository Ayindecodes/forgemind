import type { Endpoint } from '@forgemind/contract';

import type { Fetch } from './client';

/**
 * Which endpoints a service implements, read from its OpenAPI document. A
 * service without one, like the dev API, is taken to implement everything.
 */
export type Implemented = Set<string> | 'all';

/** `/tasks/{id}` in OpenAPI is `/tasks/:id` in the contract. */
export const contractPath = (openApiPath: string) =>
  openApiPath.replace(/\{(\w+)\}/g, ':$1');

/**
 * A route's identity: the method and the path with every parameter reduced
 * to a wildcard, so `/tasks/:id` and `/tasks/:taskId` are the same route and
 * a naming difference cannot hide an implemented endpoint.
 */
export const routeKey = (method: string, path: string) =>
  `${method.toUpperCase()} ${path.replace(/:\w+/g, ':*')}`;

export function implementedFromDocument(document: unknown): Set<string> {
  const routes = new Set<string>();
  const paths =
    typeof document === 'object' && document !== null && 'paths' in document
      ? (document as { paths: Record<string, Record<string, unknown>> }).paths
      : {};
  for (const [path, operations] of Object.entries(paths)) {
    for (const method of Object.keys(operations)) {
      routes.add(routeKey(method, contractPath(path)));
    }
  }
  return routes;
}

export async function readImplemented(
  fetchImpl: Fetch,
  baseUrl: string,
): Promise<Implemented> {
  const response = await fetchImpl(new URL('/openapi.json', baseUrl), {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) return 'all';
  return implementedFromDocument(await response.json());
}

export const isImplemented = (implemented: Implemented, endpoint: Endpoint) =>
  implemented === 'all' ||
  implemented.has(routeKey(endpoint.method, endpoint.path));
