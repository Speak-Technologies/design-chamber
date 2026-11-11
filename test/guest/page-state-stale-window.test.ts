// Regression (Q4): the 409 path of the page-state controller (src/guest/page-state.ts
// handleStaleClear). The existing 409 test has no write landing while the stale PATCH is in
// flight, so removing `dirty.clear()` in handleStaleClear kept it green. These tests write while
// the PATCH (and then the refetch) is outstanding, after a Clear elsewhere.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PageStatePatchBody, PageStateResponse } from '../../src/shared/api.ts';
import { applyPageStateDelta, formatGen, isOlderClear } from '../../src/shared/page-state.ts';
import { createPageStateController, type Schedule } from '../../src/guest/page-state.ts';
import { ServiceError, type ServiceClient } from '../../src/guest/service-client.ts';

const EPOCH = 'qaepoch';
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** A service that applies the real pure rules; PATCH and GET can be held open by the test. */
const heldService = () => {
  const state = { items: new Map<string, string>(), chars: 0, clears: 0 };
  const gen = (): string => formatGen(EPOCH, state.clears);
  let holdPatch: Promise<void> | null = null;
  let holdGet: Promise<void> | null = null;
  const call = async (key: string, ...args: unknown[]): Promise<unknown> => {
    if (key === 'GET /designs/:slug/page-state') {
      if (holdGet) await holdGet;
      return { items: [...state.items], chars: state.chars, gen: gen() } satisfies PageStateResponse;
    }
    if (key === 'PATCH /designs/:slug/page-state') {
      const body = (args[0] as { body: PageStatePatchBody }).body;
      if (holdPatch) await holdPatch;
      if ('uploadId' in body) throw new Error('unexpected upload');
      if (isOlderClear(body.gen, gen())) throw new ServiceError('stale', 'cleared elsewhere');
      const outcome = applyPageStateDelta(state.items, state.chars, { clear: body.clear === true, changes: body.changes ?? [] });
      if (!outcome.ok) throw new ServiceError('too-large', 'cap');
      state.chars = outcome.chars;
      return { chars: state.chars, gen: gen() };
    }
    throw new Error(`unexpected route ${key}`);
  };
  // Safe: the controller only calls `call` and `upload` on the client.
  const client = { call, upload: async () => 'u_unused' } as unknown as ServiceClient;
  const gate = (): { wait: Promise<void>; open: () => void } => {
    let open: () => void = () => undefined;
    const wait = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { wait, open };
  };
  return {
    client,
    state,
    holdPatches(): () => void {
      const g = gate();
      holdPatch = g.wait;
      return () => {
        holdPatch = null;
        g.open();
      };
    },
    holdGets(): () => void {
      const g = gate();
      holdGet = g.wait;
      return () => {
        holdGet = null;
        g.open();
      };
    },
    clearElsewhere(): void {
      state.clears += 1;
      state.items.clear();
      state.chars = 0;
    },
  };
};

const rig = () => {
  const service = heldService();
  let at = 1_000_000;
  const timers: { due: number; run: () => void; cancelled: boolean }[] = [];
  const schedule: Schedule = (run, ms) => {
    const timer = { due: at + ms, run, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  const advance = (ms: number): void => {
    at += ms;
    for (const timer of [...timers]) {
      if (timer.cancelled || timer.due > at) continue;
      timer.cancelled = true;
      timer.run();
    }
  };
  const controller = createPageStateController({
    client: service.client,
    slug: 'demo',
    onNotice: () => undefined,
    syncFrames: () => undefined,
    reloadFrames: () => undefined,
    now: () => at,
    schedule,
    visibility: null,
  });
  return { service, controller, advance };
};

test('a write made while the stale PATCH is in flight is dropped with it, not saved after the Clear', async () => {
  const { service, controller, advance } = rig();
  await controller.load();
  const release = service.holdPatches();
  controller.apply('b', { clear: false, changes: [['checklist', '[1,2,3]']] });
  advance(0); // the flush starts; its PATCH is held open
  await tick();
  controller.apply('b', { clear: false, changes: [['checklist', '[1,2,3,4]']] }); // written while it is in flight
  service.clearElsewhere(); // another window clears before the PATCH is answered
  release();
  await tick();
  await tick();
  advance(5000);
  await controller.flush();
  assert.deepEqual([...service.state.items], [], 'the cleared checklist came back');
});

test('a write made while the 409 refetch is outstanding is not saved over the Clear', { todo: 'Q4: handleStaleClear drops dirty before the GET, not after it' }, async () => {
  const { service, controller, advance } = rig();
  await controller.load();
  const releasePatch = service.holdPatches();
  controller.apply('b', { clear: false, changes: [['checklist', '[1,2,3]']] });
  advance(0);
  await tick();
  service.clearElsewhere();
  const releaseGet = service.holdGets();
  releasePatch();
  await tick();
  await tick(); // the 409 arrived; handleStaleClear is waiting on its GET
  controller.apply('b', { clear: false, changes: [['checklist', '[1,2,3,4]']] }); // the old frame saves its whole list again
  releaseGet();
  await tick();
  await tick();
  advance(5000);
  await controller.flush();
  assert.deepEqual([...service.state.items], [], 'the cleared checklist came back');
});
