// QA regression: what the Checks badge counts and what "Ask the agent to fix" sends must agree.
// A render whose every artboard failed (state 'failed', keys still matching the files) is counted
// by GET /checks, so the prompt has to carry those findings too.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ensureLauncherService } from '../../src/service/check/launcher.ts';
import { ensureChecksService } from '../../src/service/check/service.ts';
import { runStaticChecks } from '../../src/service/check/static.ts';
import { useTmpRoot } from '../helpers/tmp-root.ts';
import { createChatContext, seedDesign, serveRoutes } from './helpers.ts';

const GOOD = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Home</title></head><body><p>Hi</p></body></html>';

test('a failed render that the badge counts is also in the fix prompt', async (t) => {
  const tmp = await useTmpRoot(t);
  await seedDesign(tmp, 'demo', { kind: 'page' });
  await tmp.write('demo/index.html', GOOD);
  const ctx = createChatContext(tmp);
  t.after(() => ctx.dispose());
  const checks = ensureChecksService(ctx, { resolveBrowser: () => ({ path: null, source: 'none' }) });
  const cli = await tmp.write('ext/dist/cli/dc.mjs', 'x');
  ensureLauncherService(ctx, { cliPath: cli, execPath: '/opt/oc/openchamber', platform: 'linux' });
  const { call } = await serveRoutes(t, ctx);

  const run = await runStaticChecks(tmp.at('demo'), 10_000);
  await tmp.write('demo/.chamber/check.json', {
    version: 1,
    slug: 'demo',
    kind: 'page',
    createdAt: '2026-11-08T10:15:00.000Z',
    tool: 'cli',
    static: { findings: [] },
    render: {
      state: 'failed',
      browser: 'chrome',
      keys: run.keys,
      artboards: [{ screen: null, viewport: 'laptop', width: 1280, height: 800, docHeight: 0, pngs: [], ok: false, ms: 0 }],
      skipped: 0,
      findings: [{ code: 'render-timeout', file: 'index.html', screen: null, viewport: 'laptop' }],
    },
  });

  const counted = await checks.get('demo');
  assert.equal(counted.render.state, 'failed');
  const toFix = counted.counts.errors + counted.counts.warnings;
  assert.equal(toFix, 1, 'the badge counts the timed-out artboard');

  const reply = await call('/designs/demo/prompt', { body: { purpose: 'checks' } });
  assert.equal(reply.status, 200, `the badge says ${toFix} issue, the prompt answered ${JSON.stringify(reply.json)}`);
  assert.ok((reply.json.text as string).includes('took too long to render'));
});
