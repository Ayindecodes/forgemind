import type { EndpointKey } from '@forgemind/contract';

/** Ids and tokens one probe learns and later probes need. */
export type Context = Record<string, string>;

/** Thrown by a probe that cannot run because an earlier result is missing. */
export class Blocked extends Error {}

export type Request = {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  /** Overrides the session cookie for this request; '' sends none. */
  cookie?: string;
};

export type Response = {
  status: number;
  headers: Headers;
  data: unknown;
  text: string;
};

export type Probe = {
  key: EndpointKey;
  /** Builds the request from what earlier probes learned. */
  build: (context: Context) => Request;
  /** The status a correct implementation answers with. */
  status?: number;
  /** Reads the first message of an event stream instead of a JSON body. */
  transport?: 'json' | 'sse';
  /** Retries the request until the data settles, for stores still playing. */
  settled?: (data: unknown) => boolean;
  /** Remembers what later probes need. */
  after?: (context: Context, data: unknown, response: Response) => void;
};

export type Verdict = 'pass' | 'fail' | 'unimplemented' | 'blocked';

export type Result = {
  key: EndpointKey;
  method: string;
  path: string;
  verdict: Verdict;
  note: string;
};
