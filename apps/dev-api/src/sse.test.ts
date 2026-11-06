import { Event, Task } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { createApp } from './app';
import { createStore } from './store';

type Frame = { id: string | null; event: string | null; data: string };

function parseFrames(text: string): Frame[] {
  return text
    .split('\n\n')
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const frame: Frame = { id: null, event: null, data: '' };
      for (const line of chunk.split('\n')) {
        if (line.startsWith('id:')) frame.id = line.slice(3).trim();
        else if (line.startsWith('event:')) frame.event = line.slice(6).trim();
        else if (line.startsWith('data:')) frame.data += line.slice(5).trim();
      }
      return frame;
    });
}

async function readUntil(
  response: Response,
  done: (frames: Frame[]) => boolean,
) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';

  for (;;) {
    const { value, done: ended } = await reader.read();
    if (value) text += decoder.decode(value, { stream: true });
    const frames = parseFrames(text);
    if (ended || done(frames)) {
      await reader.cancel().catch(() => undefined);
      return frames;
    }
  }
}

const clock = () => new Date('2026-11-02T12:00:00Z');
const OWNER = { cookie: 'fm_session=dev-owner' };

describe('the event stream', () => {
  it('replays a finished run from a sequence number and then closes', async () => {
    const store = createStore({ speed: Infinity, now: clock });
    const app = createApp(store);
    const all = store.eventsAfter('org-1', 'run-5', 0);

    const response = await app.request('/runs/run-5/events/stream?after=10', {
      headers: OWNER,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const frames = parseFrames(await response.text());
    expect(frames.map(({ id }) => Number(id))).toEqual(
      all.slice(10).map(({ seq }) => seq),
    );
    expect(frames.at(-1)?.event).toBe('run.finished');
    expect(Event.parse(JSON.parse(frames[0]?.data ?? ''))).toMatchObject({
      seq: 11,
    });
  });

  it('follows a live run, resumes from Last-Event-ID, and ends with the run', async () => {
    const store = createStore({ speed: 2000 });
    const app = createApp(store);
    const task = Task.parse(
      await (
        await app.request('/tasks', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...OWNER },
          body: JSON.stringify({
            repositoryId: 'repo-1',
            title: 'Live',
            request: 'x',
            category: 'fix_bug',
          }),
        })
      ).json(),
    );

    const first = await readUntil(
      await app.request(`/runs/${task.runId}/events/stream`, {
        headers: OWNER,
      }),
      (frames) => frames.length >= 5,
    );
    const seqs = first.map(({ id }) => Number(id));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);

    const resumedFrom = seqs.at(-1) ?? 0;
    const resumed = readUntil(
      await app.request(`/runs/${task.runId}/events/stream`, {
        headers: { 'last-event-id': String(resumedFrom), ...OWNER },
      }),
      (frames) => frames.some(({ event }) => event === 'run.finished'),
    );

    // Wait for the scenario to reach approval, then approve so the run ends.
    await new Promise<void>((resolve) => {
      const check = () => {
        if (store.run('org-1', task.runId).status === 'awaiting_approval')
          resolve();
        else setTimeout(check, 10);
      };
      check();
    });
    store.decide(store.sessionFor('dev-owner'), task.id, 'approved');

    const frames = await resumed;
    const resumedSeqs = frames.map(({ id }) => Number(id));
    expect(resumedSeqs[0]).toBe(resumedFrom + 1);
    expect(resumedSeqs).toEqual([...resumedSeqs].sort((a, b) => a - b));
    expect(frames.at(-1)?.event).toBe('run.finished');
    expect(resumedSeqs.at(-1)).toBe(
      store.eventsAfter('org-1', task.runId, 0).at(-1)?.seq,
    );
  });
});
