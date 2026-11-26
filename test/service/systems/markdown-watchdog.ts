// A per-render watchdog for the markdown renderer's tests. The renderer runs untrusted text on the
// service's main thread, and its worst failure is a render that never returns (an endless loop that
// ends in an out-of-memory crash). In the test's own thread that would hang the whole run, so every
// render goes to a worker and the test waits for it synchronously with a deadline: past it the
// worker is killed and the test fails with the source that hung. Test-only.

import { MessageChannel, Worker, receiveMessageOnPort, type MessagePort } from 'node:worker_threads';

import type { MarkdownProfile } from '../../../src/service/systems/markdown-html.ts';
import type { PairDifference, WatchdogInit, WatchdogRequest } from './markdown-worker.ts';

/** One render at the service cap takes milliseconds; this only has to outlast a slow shared runner. */
export const RENDER_DEADLINE_MS = 10_000;
/** The first call also loads the worker's modules. */
const START_DEADLINE_MS = 60_000;

type Running = { worker: Worker; port: MessagePort; flag: Int32Array; started: boolean };
let running: Running | null = null;

const start = (): Running => {
  const signal = new SharedArrayBuffer(4);
  const channel = new MessageChannel();
  const init: WatchdogInit = { port: channel.port2, signal };
  const worker = new Worker(new URL('./markdown-worker.ts', import.meta.url), { workerData: init, transferList: [channel.port2] });
  // The worker must not keep the test process alive once the tests are done.
  worker.unref();
  return { worker, port: channel.port1, flag: new Int32Array(signal), started: false };
};

const preview = (request: WatchdogRequest): string => {
  const text = JSON.stringify(request);
  return text.length > 400 ? `${text.slice(0, 400)}… (${text.length} characters)` : text;
};

/** Runs one request in the worker and waits for it; a render past the deadline kills the worker and throws. */
export const guarded = (request: WatchdogRequest, deadlineMs: number = RENDER_DEADLINE_MS): unknown => {
  running ??= start();
  const { worker, port, flag } = running;
  Atomics.store(flag, 0, 0);
  port.postMessage(request);
  const waited = Atomics.wait(flag, 0, 0, running.started ? deadlineMs : Math.max(deadlineMs, START_DEADLINE_MS));
  if (waited === 'timed-out') {
    const limit = running.started ? deadlineMs : Math.max(deadlineMs, START_DEADLINE_MS);
    running = null;
    port.close();
    void worker.terminate();
    throw new Error(`the render did not finish in ${limit} ms and was killed: ${preview(request)}`);
  }
  running.started = true;
  const reply = receiveMessageOnPort(port)?.message as { value: unknown } | { error: string } | undefined;
  if (reply === undefined) throw new Error(`the render worker signalled without a reply: ${preview(request)}`);
  if ('error' in reply) throw new Error(`the render threw: ${reply.error}`);
  return reply.value;
};

export const render = (source: string, profile: MarkdownProfile): string => guarded({ op: 'render', source, profile, frozen: false }) as string;
export const renderFrozen = (source: string, profile: MarkdownProfile): string => guarded({ op: 'render', source, profile, frozen: true }) as string;
export const pairDifference = (source: string): PairDifference | null => guarded({ op: 'pair', source }) as PairDifference | null;
/** Best-of-`runs` milliseconds for both profiles; the one deadline covers all the runs together. */
export const timeRender = (source: string, runs: number): number => guarded({ op: 'time', source, runs }) as number;
export const timeBoard = (notesJson: string, runs: number): { ms: number; ok: boolean } =>
  guarded({ op: 'board', notesJson, runs }) as { ms: number; ok: boolean };
export const stuckWalk = (count: number, next: 'same' | 'behind', deadlineMs?: number): string => guarded({ op: 'stuck', count, next }, deadlineMs) as string;
