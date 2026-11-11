// Regression (Q4 re-check, 73069e7): clear() now looks the design up inside its chain slot and
// counts the Clear only once the folder is found. A Clear on a design that is not there answers 404
// and leaves the gen alone, so a design made under that name later starts at the first gen and its
// PATCHes are not refused as stale.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatGen } from '../../../src/shared/page-state.ts';
import { ApiError } from '../../../src/service/http.ts';
import { createPageStateService, type Schedule } from '../../../src/service/page-state.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const noTimers: Schedule = () => () => undefined;

test('a Clear on a design that is not there answers not-found and does not count', async (t) => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root });
  const service = createPageStateService({ store: ctx.store, hub: ctx.hub, log: ctx.log, schedule: noTimers });
  t.after(() => service.dispose());

  await assert.rejects(service.clear('ghost'), (error: unknown) => error instanceof ApiError && error.code === 'not-found');

  await tmp.writeDesign('ghost', { 'design.json': { kind: 'page', title: 'Later' }, 'index.html': '<p>x</p>' });
  const first = formatGen(ctx.epoch, 0);
  assert.equal((await service.read('ghost')).gen, first, 'the refused Clear was counted');
  const answer = await service.patch('ghost', first, { clear: false, changes: [['a', '1']] });
  assert.equal(answer.gen, first);
  assert.deepEqual((await service.read('ghost')).items, [['a', '1']]);
});
