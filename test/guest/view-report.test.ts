// The guest's view reporter (use-the-project spec §2.4): one debounced request, a heartbeat only
// while the surface is visible, nothing sent twice, `slug: null` on the way out, and a body that
// carries ids and one short line, never more. Timers are fake, so the clock is the test's.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ViewBody } from '../../src/shared/api.ts';
import { attachViewReporter, createViewReporter, viewBodyOf, type ViewReporterTimers, type ViewReporterWindow } from '../../src/guest/view-report.ts';
import { VIEW_HEARTBEAT_MS, VIEW_REPORT_DEBOUNCE_MS, VIEW_SELECTION_TEXT_MAX, VIEW_SELECTOR_MAX } from '../../src/shared/view.ts';

type Rig = { sent: ViewBody[]; visible: { value: boolean }; reporter: ReturnType<typeof createViewReporter>; tick(ms: number): void; failNext(): void };

const rig = (surface: 'rail' | 'page' = 'rail'): Rig => {
  let now = 0;
  type Job = { id: number; at: number; fn: () => void; every: number | null };
  let jobs: Job[] = [];
  let nextId = 1;
  const timers: ViewReporterTimers = {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      jobs.push({ id, at: now + ms, fn, every: null });
      return id;
    },
    clearTimeout: (handle) => void (jobs = jobs.filter((job) => job.id !== handle)),
    setInterval: (fn, ms) => {
      const id = nextId++;
      jobs.push({ id, at: now + ms, fn, every: ms });
      return id;
    },
    clearInterval: (handle) => void (jobs = jobs.filter((job) => job.id !== handle)),
  };
  const sent: ViewBody[] = [];
  const visible = { value: true };
  let fail = false;
  const reporter = createViewReporter({
    surface,
    isVisible: () => visible.value,
    timers,
    send: (body) => {
      sent.push(body);
      if (fail) {
        fail = false;
        return Promise.reject(new Error('service down'));
      }
      return Promise.resolve({ ok: true });
    },
  });
  const tick = (ms: number): void => {
    const end = now + ms;
    for (;;) {
      const due = jobs.filter((job) => job.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      if (due.every === null) jobs = jobs.filter((job) => job.id !== due.id);
      else due.at += due.every;
      due.fn();
    }
    now = end;
  };
  return { sent, visible, reporter, tick, failNext: () => void (fail = true) };
};

test('a burst of changes sends one report, the last one, after the debounce', () => {
  const { sent, reporter, tick } = rig();
  reporter.report({ slug: 'demo', screen: 'home' });
  tick(VIEW_REPORT_DEBOUNCE_MS - 1);
  reporter.report({ slug: 'demo', screen: 'pricing' });
  tick(VIEW_REPORT_DEBOUNCE_MS - 1);
  assert.deepEqual(sent, []);
  tick(1);
  assert.deepEqual(sent, [{ surface: 'rail', slug: 'demo', screen: 'pricing', viewport: null, mode: null, selection: null }]);
});

test('the same state again sends nothing; a different one does', () => {
  const { sent, reporter, tick } = rig();
  reporter.report({ slug: 'demo', screen: 'home' });
  tick(VIEW_REPORT_DEBOUNCE_MS);
  reporter.report({ slug: 'demo', screen: 'home' });
  tick(VIEW_REPORT_DEBOUNCE_MS);
  assert.equal(sent.length, 1);
  reporter.report({ slug: 'demo', screen: 'home', mode: 'play' });
  tick(VIEW_REPORT_DEBOUNCE_MS);
  assert.equal(sent.length, 2);
});

test('the heartbeat repeats the last state every minute while visible, and not when hidden or before any report', () => {
  const { sent, visible, reporter, tick } = rig('page');
  tick(VIEW_HEARTBEAT_MS);
  assert.deepEqual(sent, [], 'nothing reported yet, nothing to repeat');
  reporter.report({ slug: 'demo', screen: 'home' });
  tick(VIEW_REPORT_DEBOUNCE_MS);
  assert.equal(sent.length, 1);
  tick(VIEW_HEARTBEAT_MS);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0]);
  visible.value = false;
  tick(VIEW_HEARTBEAT_MS * 3);
  assert.equal(sent.length, 2, 'a hidden surface stays quiet');
});

test('leaving sends slug null at once and drops a report still waiting', () => {
  const { sent, reporter, tick } = rig();
  reporter.report({ slug: 'demo', screen: 'home' });
  reporter.leave();
  assert.deepEqual(sent, [{ surface: 'rail', slug: null }]);
  tick(VIEW_REPORT_DEBOUNCE_MS * 2);
  assert.equal(sent.length, 1);
});

test('resume sends the last state again; with nothing reported it sends nothing', () => {
  const { sent, reporter, tick } = rig();
  reporter.resume();
  assert.equal(sent.length, 0);
  reporter.report({ slug: 'demo', screen: 'home' });
  tick(VIEW_REPORT_DEBOUNCE_MS);
  reporter.leave();
  reporter.resume();
  assert.equal(sent.length, 3);
  assert.equal(sent[2]?.slug, 'demo');
});

test('a failed request is dropped without a throw, and the next heartbeat sends the state again', async () => {
  const { sent, reporter, tick, failNext } = rig();
  failNext();
  reporter.report({ slug: 'demo' });
  tick(VIEW_REPORT_DEBOUNCE_MS);
  await Promise.resolve();
  tick(VIEW_HEARTBEAT_MS);
  assert.equal(sent.length, 2);
});

test('after dispose nothing is sent, not even what was waiting', () => {
  const { sent, reporter, tick } = rig();
  reporter.report({ slug: 'demo' });
  reporter.dispose();
  reporter.leave();
  tick(VIEW_HEARTBEAT_MS * 2);
  assert.deepEqual(sent, []);
});

test('the body is ids and one short line: a null slug carries nothing else, a selection is flattened and clipped', () => {
  assert.deepEqual(viewBodyOf('page', { slug: null, screen: 'home', selection: { selector: 'h1', text: 'x' } }), { surface: 'page', slug: null });
  const body = viewBodyOf('page', {
    slug: 'demo',
    selection: { selector: `main\n > ${'a'.repeat(VIEW_SELECTOR_MAX)}`, text: `Ship\tfaster ${'b'.repeat(VIEW_SELECTION_TEXT_MAX)}` },
  });
  assert.ok(body.selection);
  assert.ok(body.selection.selector.length <= VIEW_SELECTOR_MAX);
  assert.ok(body.selection.text.length <= VIEW_SELECTION_TEXT_MAX);
  assert.match(body.selection.selector, /^main > a+…$/);
  assert.match(body.selection.text, /^Ship faster b+…$/);
  // A selection with no selector is no selection.
  assert.equal(viewBodyOf('rail', { slug: 'demo', selection: { selector: '  ', text: 'x' } }).selection, null);
});

test('the window wiring: pagehide leaves, becoming visible resumes, and the undo detaches both', () => {
  const { sent, reporter, tick } = rig();
  const listeners = new Map<string, () => void>();
  const win: ViewReporterWindow = {
    addEventListener: (type, listener) => void listeners.set(type, listener),
    removeEventListener: (type) => void listeners.delete(type),
    document: { visibilityState: 'hidden' },
  };
  const detach = attachViewReporter(reporter, win);
  reporter.report({ slug: 'demo' });
  tick(VIEW_REPORT_DEBOUNCE_MS);
  listeners.get('pagehide')?.();
  assert.deepEqual(sent.at(-1), { surface: 'rail', slug: null });
  listeners.get('visibilitychange')?.();
  assert.equal(sent.length, 2, 'still hidden: no resume');
  win.document.visibilityState = 'visible';
  listeners.get('visibilitychange')?.();
  const last: ViewBody | undefined = sent[sent.length - 1];
  assert.equal(last?.slug, 'demo');
  detach();
  assert.equal(listeners.size, 0);
});
