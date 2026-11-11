// Regression (Q4): a Clear counts itself only after `store.dir` answers
// (src/service/page-state.ts clear(), the `await pageStateDirOf` before `clears.set`). When a PATCH
// made with the old gen, started right after the Clear, has its own `store.dir` answer first, the
// PATCH is checked against the not-yet-counted Clear and accepted. The real store's `dir` is several
// filesystem calls, so the order flips at random: the "same tick" test in page-state.test.ts fails
// about one run in twelve. This file forces that order with a store whose first lookup is slow.
//
// Marked `todo` so the suite stays green until the fix lands; remove `todo` with the fix.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatGen } from '../../../src/shared/page-state.ts';
import { ApiError } from '../../../src/service/http.ts';
import { createPageStateService, type Schedule } from '../../../src/service/page-state.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const noTimers: Schedule = () => () => undefined;

describe('page-state: a Clear is ordered by when it was asked, not by when its lookup answered', () => {
  test('a PATCH with the old gen, started after a Clear whose design lookup is slower, is refused as stale', { todo: 'Q4 race: clear() counts the Clear after await pageStateDirOf (src/service/page-state.ts:383-385)' }, async (t) => {
    const tmp = await useTmpRoot(t);
    await tmp.writeDesign('demo', { 'design.json': { kind: 'page', title: 'Checklist' }, 'index.html': '<p>x</p>' });
    const ctx = createFakeContext({ root: tmp.root });

    let calls = 0;
    const store = {
      dir: async (slug: string): Promise<string> => {
        calls += 1;
        const mine = calls;
        const dir = await ctx.store.dir(slug);
        // The second lookup (the Clear's, below) answers a macrotask later than the third (the PATCH's).
        if (mine === 2) await new Promise((resolve) => setImmediate(resolve));
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
});
