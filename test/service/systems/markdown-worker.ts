// The worker side of the markdown render watchdog (markdown-watchdog.ts): it runs one render per
// message, off the test's own thread, so a render that never returns can be timed out and killed
// instead of hanging the test run. Test-only; nothing in src/ imports it.

import { performance } from 'node:perf_hooks';
import { workerData, type MessagePort } from 'node:worker_threads';

import { buildBoardHtml } from '../../../src/service/systems/board-html.ts';
import { renderMarkdown, walkBlocks, type MarkdownProfile } from '../../../src/service/systems/markdown-html.ts';
import type { SystemDetail } from '../../../src/shared/types.ts';
import { boardFixture } from './board-fixture.ts';
import { renderMarkdown as frozenRender } from './fixtures/markdown-d7453ba.ts';

export type WatchdogRequest =
  | { op: 'render'; source: string; profile: MarkdownProfile; frozen: boolean }
  /** Both profiles through the current and the frozen renderer; null when all four agree pairwise. */
  | { op: 'pair'; source: string }
  /** Best of `runs`, both profiles per run, timed inside the worker so messaging is not measured. */
  | { op: 'time'; source: string; runs: number }
  | { op: 'board'; notesJson: string; runs: number }
  /** `walkBlocks` over `count` lines with a step that never claims a line. */
  | { op: 'stuck'; count: number; next: 'same' | 'behind' }
  /** Never returns: the watchdog's own test. */
  | { op: 'spin' };

export type PairDifference = { board: string; living: string; frozenBoard: string; frozenLiving: string };
export type WatchdogInit = { port: MessagePort; signal: SharedArrayBuffer };

const { port, signal } = workerData as WatchdogInit;
const flag = new Int32Array(signal);

const best = (runs: number, run: () => void): number => {
  let ms = Infinity;
  for (let k = 0; k < runs; k += 1) {
    const started = performance.now();
    run();
    ms = Math.min(ms, performance.now() - started);
  }
  return ms;
};

const answer = (request: WatchdogRequest): unknown => {
  switch (request.op) {
    case 'render':
      return (request.frozen ? frozenRender : renderMarkdown)(request.source, request.profile);
    case 'pair': {
      const result: PairDifference = {
        board: renderMarkdown(request.source, 'board'),
        living: renderMarkdown(request.source, 'living'),
        frozenBoard: frozenRender(request.source, 'board'),
        frozenLiving: frozenRender(request.source, 'living'),
      };
      return result.board === result.frozenBoard && result.living === result.frozenLiving ? null : result;
    }
    case 'time':
      return best(request.runs, () => {
        renderMarkdown(request.source, 'board');
        renderMarkdown(request.source, 'living');
      });
    case 'board': {
      const notes = JSON.parse(request.notesJson) as SystemDetail['notes'];
      let html = '';
      const ms = best(request.runs, () => {
        html = buildBoardHtml({ ...boardFixture(), notes }, { scheme: 'dark' });
      });
      return { ms, ok: html.includes('id="dc-section-overview"') };
    }
    case 'stuck':
      return walkBlocks(
        request.count,
        (i) => ({ html: 'never', next: request.next === 'same' ? i : i - 1 }),
        (i) => `<p>line ${i}</p>`,
      );
    case 'spin':
      for (;;) {
        // Deliberately endless: only the watchdog ends it.
      }
  }
};

port.on('message', (request: WatchdogRequest) => {
  let reply: { value: unknown } | { error: string };
  try {
    reply = { value: answer(request) };
  } catch (error) {
    reply = { error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
  }
  port.postMessage(reply);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
