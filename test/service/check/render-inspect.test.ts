// The render engine's inspect hook (documentation/specs/system-board-layout-and-visual-check.md §B.3)
// against a fake CDP session: the hook's result becomes the artboard check, console and blocked-request
// findings still apply, a null result is "could not be measured", and a timed-out artboard is abandoned.
// The PNG label (the board's area id) reaches savePng and names the file.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CdpEvent, CdpSession } from '../../../src/service/check/cdp.ts';
import { openCheckRun } from '../../../src/service/check/engine.ts';
import { renderArtboards, type InspectPage, type InspectResult, type PlannedArtboard } from '../../../src/service/check/render.ts';
import { pngOfSize } from '../systems/fake-cdp.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const ART: PlannedArtboard = { file: 'board.html', screen: null, viewport: { id: 'wide', label: 'Wide board', width: 1526, height: 900 } };

type FakeOptions = { probeValue?: unknown; probeDelayMs?: number; consoleError?: string; blockedUrl?: string };

/** The CDP conversation render.ts holds, answered from memory; the probe answer is configurable. */
const fakeSession = (options: FakeOptions = {}): CdpSession => {
  const listeners = new Map<string, Set<(event: CdpEvent) => void>>();
  const emit = (event: CdpEvent): void => {
    for (const listener of [...(listeners.get(event.method) ?? [])]) listener(event);
  };
  let closed = false;
  return {
    get exited() {
      return closed;
    },
    on(method, listener) {
      let set = listeners.get(method);
      if (set === undefined) listeners.set(method, (set = new Set()));
      set.add(listener);
      return () => set.delete(listener);
    },
    onExit: () => () => undefined,
    close: async () => {
      closed = true;
    },
    async send<T>(method: string, params: object = {}, sendOptions: { sessionId?: string } = {}): Promise<T> {
      const p = params as Record<string, unknown>;
      const sessionId = sendOptions.sessionId ?? 's1';
      const reply = (value: object): T => value as T;
      switch (method) {
        case 'Target.createTarget':
          return reply({ targetId: 't1' });
        case 'Target.attachToTarget':
          return reply({ sessionId: 's1' });
        case 'Page.navigate':
          setImmediate(() => emit({ method: 'Fetch.requestPaused', sessionId, params: { requestId: 'r1', request: { url: p.url } } }));
          return reply({ frameId: 'f1' });
        case 'Fetch.fulfillRequest':
          setImmediate(() => {
            emit({ method: 'Page.loadEventFired', sessionId, params: {} });
            if (options.consoleError !== undefined) {
              emit({ method: 'Runtime.consoleAPICalled', sessionId, params: { type: 'error', args: [{ value: options.consoleError }] } });
            }
            if (options.blockedUrl !== undefined) {
              emit({ method: 'Fetch.requestPaused', sessionId, params: { requestId: 'r2', request: { url: options.blockedUrl } } });
            }
          });
          return reply({});
        case 'Page.createIsolatedWorld':
          return reply({ executionContextId: 7 });
        case 'Runtime.evaluate': {
          const expression = String(p.expression ?? '');
          if (expression.includes('collectBoard')) {
            if (options.probeDelayMs !== undefined) {
              await new Promise((resolve) => setTimeout(resolve, options.probeDelayMs));
            }
            return reply({ result: { value: options.probeValue ?? null } });
          }
          return reply({ result: { value: true } });
        }
        case 'Page.captureScreenshot': {
          const clip = p.clip as { width: number; height: number } | undefined;
          return reply({ data: pngOfSize(clip?.width ?? 1526, clip?.height ?? 900).toString('base64') });
        }
        default:
          return reply({});
      }
    },
  };
};

const run = (session: CdpSession, inspect: (page: InspectPage, art: PlannedArtboard) => Promise<InspectResult | null>, over: { artboardTimeoutMs?: number } = {}) =>
  renderArtboards({
    openBrowser: async () => session,
    plan: [ART],
    kind: 'page',
    loadDocument: async () => ({ ok: true, html: '<!doctype html><html><body>board</body></html>' }),
    probeSource: '/* probe */',
    knownExternal: new Set(),
    savePng: async (art, slice, slices, bytes, label) => `.chamber/check/r-test/${label ?? art.screen ?? 'page'}@${art.viewport.id}${slices > 1 && slice > 1 ? `-${slice}` : ''}.png`,
    inspect,
    ...over,
  });

test('the inspect result becomes the artboard check: findings, docHeight and the labelled PNG', async () => {
  const saved: { label: string | undefined; slice: number; slices: number }[] = [];
  const session = fakeSession({ probeValue: { ok: true } });
  const outcome = await renderArtboards({
    openBrowser: async () => session,
    plan: [ART],
    kind: 'page',
    loadDocument: async () => ({ ok: true, html: '<p>board</p>' }),
    probeSource: '/* probe */',
    knownExternal: new Set(),
    savePng: async (art, slice, slices, bytes, label) => {
      saved.push({ label, slice, slices });
      return `.chamber/check/r-test/${label}@${art.viewport.id}${slices > 1 && slice > 1 ? `-${slice}` : ''}.png`;
    },
    inspect: async (page, art) => {
      const value = await page.evaluate('/* probe */;__dcProbe.collectBoard()', { awaitPromise: false });
      assert.deepEqual(value, { ok: true });
      await page.scrollTo(900);
      const bytes = await page.capture({ y: 900, height: 400 });
      assert.ok(bytes.length > 8, 'a PNG came back');
      const rel = await page.save('components', 1, 2, bytes);
      const rel2 = await page.save('components', 2, 2, bytes);
      return {
        findings: [{ code: 'system-board-overflow', file: 'board.html', screen: null, viewport: art.viewport.id, params: { px: 1600, width: 1526 } }],
        docHeight: 2400,
        pngs: [rel, rel2],
      };
    },
  });
  assert.equal(outcome.artboards.length, 1);
  assert.equal(outcome.artboards[0]?.ok, true);
  assert.equal(outcome.artboards[0]?.docHeight, 2400);
  assert.deepEqual(outcome.artboards[0]?.pngs, ['.chamber/check/r-test/components@wide.png', '.chamber/check/r-test/components@wide-2.png']);
  assert.deepEqual(saved, [
    { label: 'components', slice: 1, slices: 2 },
    { label: 'components', slice: 2, slices: 2 },
  ]);
  assert.deepEqual(outcome.findings.map((finding) => finding.code), ['system-board-overflow']);
});

test('console errors and blocked requests still apply on the inspect path; a known external is not double-reported', async () => {
  const session = fakeSession({ probeValue: { ok: true }, consoleError: 'example broke', blockedUrl: 'https://evil.example/x.png' });
  const outcome = await run(session, async () => ({ findings: [], docHeight: 900, pngs: [] }));
  const codes = outcome.findings.map((finding) => finding.code);
  assert.ok(codes.includes('console-error'));
  assert.ok(codes.includes('request-blocked'));
  assert.equal(outcome.findings.find((finding) => finding.code === 'console-error')?.detail, 'example broke');

  const known = fakeSession({ probeValue: { ok: true }, blockedUrl: 'https://evil.example/x.png' });
  const knownOutcome = await renderArtboards({
    openBrowser: async () => known,
    plan: [ART],
    kind: 'page',
    loadDocument: async () => ({ ok: true, html: '<p>board</p>' }),
    probeSource: '/* probe */',
    knownExternal: new Set(['https://evil.example/x.png']),
    savePng: async () => 'x.png',
    inspect: async () => ({ findings: [], docHeight: 900, pngs: [] }),
  });
  assert.ok(!knownOutcome.findings.some((finding) => finding.code === 'request-blocked'));
});

test('a null inspect result is "could not be measured"; a late probe answer after the timeout is abandoned', async () => {
  const nullSession = fakeSession({ probeValue: null });
  const failed = await run(nullSession, async (page) => {
    const value = await page.evaluate('collectBoard', { awaitPromise: false });
    return value === null ? null : { findings: [], docHeight: 0, pngs: [] };
  });
  assert.equal(failed.artboards[0]?.ok, false);
  assert.deepEqual(failed.findings.map((finding) => [finding.code, finding.detail]), [['render-failed', 'The page could not be measured.']]);

  // The probe answers after the artboard timeout: the guard abandons it, the run reports the timeout.
  const late = fakeSession({ probeValue: { ok: true }, probeDelayMs: 400 });
  const timedOut = await run(late, async (page) => {
    await page.evaluate('collectBoard', { awaitPromise: false });
    return { findings: [], docHeight: 900, pngs: [] };
  }, { artboardTimeoutMs: 150 });
  assert.deepEqual(timedOut.findings.map((finding) => finding.code), ['render-timeout']);
  assert.equal(timedOut.artboards[0]?.ok, false);
  // Let the late answer land: it must not throw out of the run.
  await new Promise((resolve) => setTimeout(resolve, 500));
});

test('openCheckRun names the PNGs by label, uniquely case-insensitively, and refuses a linked .chamber/check with the system wording', async (t) => {
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('demo', { 'index.html': '<p>x</p>' });
  const space = await openCheckRun(dir, { now: () => new Date('2026-11-08T10:15:00.000Z'), platform: process.platform, withRunDir: true });
  try {
    const first = await space.savePng(ART, 1, 2, pngOfSize(1526, 900), 'components');
    const second = await space.savePng(ART, 2, 2, pngOfSize(1526, 900), 'components');
    assert.ok(first.endsWith('/components@wide.png'), first);
    assert.ok(second.endsWith('/components@wide-2.png'), second);
    await space.finish([first, second], Date.now());
  } finally {
    await space.close();
  }

  const { mkdir, symlink, readdir } = await import('node:fs/promises');
  const sys = await tmp.writeDesign('sys', { 'system.json': '{}' });
  await mkdir(tmp.at('elsewhere'));
  await mkdir(tmp.at('sys/.chamber'));
  await symlink(tmp.at('elsewhere'), tmp.at('sys/.chamber/check'), 'dir');
  await assert.rejects(
    () => openCheckRun(sys, { now: () => new Date(), platform: process.platform, withRunDir: true, owner: "This design system's" }),
    (error: unknown) => error instanceof Error && error.message === "This design system's .chamber/check entry is not a normal folder, so Design Chamber cannot save the check there. Remove it and run the check again.",
  );
  assert.deepEqual(await readdir(tmp.at('elsewhere')), []);
});