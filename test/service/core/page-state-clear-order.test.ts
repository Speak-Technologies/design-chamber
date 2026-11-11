// Regression (Q4): a Clear used to count itself only after `store.dir` answered
// (src/service/page-state.ts clear(), an `await pageStateDirOf` before `clears.set`). When a PATCH
// made with the old gen, started right after the Clear, had its own `store.dir` answer first, the
// PATCH was checked against the not-yet-counted Clear and accepted. The real store's `dir` is several
// filesystem calls, so the order flipped at random: the "same tick" test in page-state.test.ts failed
// about one run in twelve. This file forces each answer order with a store whose lookups are held.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatGen } from '../../../src/shared/page-state.ts';
import { ApiError } from '../../../src/service/http.ts';
import { createPageStateService, type Schedule } from '../../../src/service/page-state.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const noTimers: Schedule = () => () => undefined;

describe('page-state: a Clear is ordered by when it was asked, not by when its lookup answered', () => {
  // Lookups 2 and 3 belong to the Clear and the late PATCH, in whichever order the service issues
  // them; each run makes one of them a macrotask slower, so both answer orders are tried.
  for (const slow of [2, 3]) {
    test(`a PATCH with the old gen, started right after a Clear, is refused as stale (lookup ${slow} answers last)`, async (t) => {
      const tmp = await useTmpRoot(t);
      await tmp.writeDesign('demo', { 'design.json': { kind: 'page', title: 'Checklist' }, 'index.html': '<p>x</p>' });
      const ctx = createFakeContext({ root: tmp.root });

      let calls = 0;
      const store = {
        dir: async (slug: string): Promise<string> => {
          calls += 1;
          const mine = calls;
          const dir = await ctx.store.dir(slug);
          if (mine === slow) await new Promise((resolve) => setImmediate(resolve));
          return dir;
        },
      };
      const service = createPageStateService({ store, hub: ctx.hub, log: ctx.log, schedule: noTimers });
      t.after(() => service.dispose());

      const gen = formatGen(ctx.epoch, 0);
      await service.patch('demo', gen, { clear: false, changes: [['a', '1']] });

      const clearing = service.clear('demo');
      const late = service.patch('demo', gen, { clear: false, changes: [['b', '2']] });
      const [cleared, patched] = await Promise.allSettled([clearing, late]);

      assert.equal(cleared.status, 'fulfilled');
      assert.equal(patched.status, 'rejected', 'the PATCH made before the Clear was accepted');
      assert.ok(patched.reason instanceof ApiError && patched.reason.code === 'stale');
      assert.deepEqual((await service.read('demo')).items, []);
    });
  }
});
