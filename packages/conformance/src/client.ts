import { buildPath, type Endpoint } from '@forgemind/contract';

import type { Request, Response } from './types';

export type Fetch = typeof fetch;

export function url(baseUrl: string, endpoint: Endpoint, request: Request) {
  const target = new URL(buildPath(endpoint.path, request.params), baseUrl);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    target.searchParams.set(key, value);
  }
  return target;
}

/** One JSON request to one endpoint. */
export async function call(
  fetchImpl: Fetch,
  baseUrl: string,
  endpoint: Endpoint,
  request: Request,
  cookie: string,
): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const sent = request.cookie ?? cookie;
  if (sent) headers.cookie = sent;
  if (request.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetchImpl(url(baseUrl, endpoint, request), {
    method: endpoint.method,
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    redirect: 'manual',
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: response.status, headers: response.headers, data, text };
}

/** Reads the first message of a server-sent event stream, then hangs up. */
export async function firstEvent(
  fetchImpl: Fetch,
  baseUrl: string,
  endpoint: Endpoint,
  request: Request,
  cookie: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const headers: Record<string, string> = { accept: 'text/event-stream' };
    const sent = request.cookie ?? cookie;
    if (sent) headers.cookie = sent;
    const response = await fetchImpl(url(baseUrl, endpoint, request), {
      headers,
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      return {
        status: response.status,
        headers: response.headers,
        data: null,
        text: await response.text(),
      };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!buffer.includes('\n\n')) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    controller.abort();
    const message = buffer.split('\n\n')[0] ?? '';
    const payload = message
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    let data: unknown = null;
    try {
      data = payload ? JSON.parse(payload) : null;
    } catch {
      data = null;
    }
    return {
      status: response.status,
      headers: response.headers,
      data,
      text: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Follows one simulated GitHub redirect and returns its query parameters. */
export async function redirectParams(
  fetchImpl: Fetch,
  target: string,
  cookie: string,
): Promise<Record<string, string>> {
  const response = await fetchImpl(target, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual',
  });
  const location = response.headers.get('location');
  if (!location) {
    throw new Error(
      `expected a redirect from ${target}, got ${response.status}`,
    );
  }
  return Object.fromEntries(new URL(location, target).searchParams.entries());
}
