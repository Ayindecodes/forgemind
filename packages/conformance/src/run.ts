import {
  ApiError,
  DATA_SOURCE_HEADER,
  endpoints,
  type DataSource,
  type Endpoint,
  type EndpointKey,
} from '@forgemind/contract';

import { call, firstEvent, redirectParams, type Fetch } from './client';
import { isImplemented, readImplemented, type Implemented } from './openapi';
import { plan } from './plan';
import { Blocked, type Context, type Probe, type Result } from './types';

export type Options = {
  baseUrl: string;
  cookie: string;
  dataSource: DataSource;
  fetchImpl?: Fetch;
  /** Treat every endpoint as implemented, ignoring any OpenAPI document. */
  allImplemented?: boolean;
  probes?: Probe[];
};

export type Summary = {
  results: Result[];
  passed: number;
  failed: number;
  unimplemented: number;
  blocked: number;
  /** Implemented endpoints the plan has no probe for; a gap in this harness. */
  unprobed: EndpointKey[];
};

/** `&amp;` and numeric entities back to characters, enough for a URL. */
const unescape = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    );

/** The links on a simulated GitHub page, with their visible text. */
const links = (page: string, marker: string) =>
  [...page.matchAll(/href="([^"]*)"[^>]*>([^<]*)</g)]
    .map((match) => ({ href: unescape(match[1]!), text: match[2]!.trim() }))
    .filter((link) => link.href.includes(marker));

/** Follows the dev API's simulated GitHub pages between the auth probes. */
async function simulatedGitHub(
  key: EndpointKey,
  context: Context,
  fetchImpl: Fetch,
) {
  if (key === 'githubCallback' && context.authorizeUrl && !context.authCode) {
    const page = await (await fetchImpl(context.authorizeUrl)).text();
    const choices = links(page, 'authorize/continue');
    // A person without an organization, so the onboarding endpoints apply.
    const chosen =
      choices.find((link) => link.text.includes('Sam Rivera')) ?? choices[0];
    if (chosen) {
      const params = await redirectParams(
        fetchImpl,
        new URL(chosen.href, context.authorizeUrl).toString(),
        '',
      );
      if (params.code) context.authCode = params.code;
      if (params.state) context.authState = params.state;
    }
  }
  if (
    key === 'installCallback' &&
    context.installUrl &&
    !context.installationId
  ) {
    const page = await (
      await fetchImpl(context.installUrl, {
        headers: { cookie: context.newSession ?? '' },
      })
    ).text();
    const chosen = links(page, 'install/continue')[0];
    if (chosen) {
      const params = await redirectParams(
        fetchImpl,
        new URL(chosen.href, context.installUrl).toString(),
        context.newSession ?? '',
      );
      const id = params.installation_id ?? params.installationId;
      if (id) context.installationId = id;
      if (params.state) context.installState = params.state;
    }
  }
}

export async function run(options: Options): Promise<Summary> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const probes = options.probes ?? plan;
  const implemented: Implemented = options.allImplemented
    ? 'all'
    : await readImplemented(fetchImpl, options.baseUrl);
  const context: Context = {};
  const results: Result[] = [];

  for (const probe of probes) {
    const endpoint: Endpoint = endpoints[probe.key];
    const base = {
      key: probe.key,
      method: endpoint.method,
      path: endpoint.path,
    };
    if (!isImplemented(implemented, endpoint)) {
      results.push({
        ...base,
        verdict: 'unimplemented',
        note: 'not in the OpenAPI document',
      });
      continue;
    }
    try {
      await simulatedGitHub(probe.key, context, fetchImpl);
      const request = probe.build(context);
      if (endpoint.body && request.body !== undefined) {
        const valid = endpoint.body.safeParse(request.body);
        if (!valid.success) {
          results.push({
            ...base,
            verdict: 'fail',
            note: `the probe's body breaks the contract: ${valid.error.message}`,
          });
          continue;
        }
      }
      const send = () =>
        probe.transport === 'sse'
          ? firstEvent(
              fetchImpl,
              options.baseUrl,
              endpoint,
              request,
              options.cookie,
            )
          : call(fetchImpl, options.baseUrl, endpoint, request, options.cookie);
      let response = await send();
      for (
        let attempt = 0;
        probe.settled && !probe.settled(response.data) && attempt < 40;
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        response = await send();
      }
      const expected = probe.status ?? 200;
      if (response.status !== expected) {
        const error = ApiError.safeParse(response.data);
        const detail = error.success
          ? `${error.data.error.code}: ${error.data.error.message}`
          : response.text.slice(0, 160);
        results.push({
          ...base,
          verdict: 'fail',
          note: `expected ${expected}, got ${response.status} ${detail}`,
        });
        continue;
      }
      const source = response.headers.get(DATA_SOURCE_HEADER);
      if (source !== options.dataSource) {
        results.push({
          ...base,
          verdict: 'fail',
          note: `${DATA_SOURCE_HEADER} is ${source ?? 'missing'}, expected ${options.dataSource}`,
        });
        continue;
      }
      const parsed = endpoint.response.safeParse(response.data);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .slice(0, 3)
          .map(
            (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
          )
          .join('; ');
        results.push({
          ...base,
          verdict: 'fail',
          note: `response breaks the contract: ${issues}`,
        });
        continue;
      }
      probe.after?.(context, parsed.data, response);
      results.push({ ...base, verdict: 'pass', note: `${response.status}` });
    } catch (error) {
      if (error instanceof Blocked) {
        results.push({ ...base, verdict: 'blocked', note: error.message });
      } else {
        results.push({
          ...base,
          verdict: 'fail',
          note: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const probed = new Set(probes.map((probe) => probe.key));
  const unprobed = (Object.keys(endpoints) as EndpointKey[]).filter(
    (key) => !probed.has(key) && isImplemented(implemented, endpoints[key]),
  );
  const count = (verdict: Result['verdict']) =>
    results.filter((result) => result.verdict === verdict).length;
  return {
    results,
    passed: count('pass'),
    failed: count('fail'),
    unimplemented: count('unimplemented'),
    blocked: count('blocked'),
    unprobed,
  };
}
