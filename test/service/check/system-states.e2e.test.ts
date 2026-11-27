// Forced state pictures against a real browser (system-builder-depth T16; skipped, never silent, when
// none is installed). Each labelled hover, focus-visible or active instance is forced over CDP on the wide
// light board: a styled :hover is pictured with no finding, a missing :hover is `system-state-unstyled`
// naming the component and the state, a :focus-visible that only changes colour counts as styled and one
// with `outline: none` alone does not, a static `is-hover` copy is judged on its rest twin, and a slow
// stepped transition is read where it ends. The pictures are tight, real PNGs; the page never got a script.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { cliSystemStore, runSystemCheck } from '../../../src/service/check/system-run.ts';
import { chromeOrSkip } from '../../helpers/chrome-or-skip.ts';
import { probeSource } from '../../helpers/probe-source.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const BUTTON = 'button{padding:6px 12px;border:1px solid #888;background:#eee;color:#111;font:14px sans-serif}';

const fixture: Record<string, string> = {
  'tokens.css': ':root {\n  --brand: #1a73e8;\n  --space-2: 8px;\n}\n',
  'OVERVIEW.md': 'Calm and clear.',
  'system.json': JSON.stringify({
    version: 1,
    components: [
      { id: 'styled', name: 'Styled', layout: 'compact', example: 'components/styled.html' },
      { id: 'plain', name: 'Plain', layout: 'compact', example: 'components/plain.html' },
      { id: 'ring-colour', name: 'Ring colour', layout: 'compact', example: 'components/ring-colour.html' },
      { id: 'ring-none', name: 'Ring none', layout: 'compact', example: 'components/ring-none.html' },
      { id: 'copy', name: 'Copy', layout: 'compact', example: 'components/copy.html' },
      { id: 'slow', name: 'Slow', layout: 'compact', example: 'components/slow.html' },
    ],
  }),
  '.chamber/state.json': JSON.stringify({ name: 'Acme', status: 'ready' }),
  'components/styled.html': `<style>${BUTTON} button:hover{background:#333;color:#fff}</style><button data-dc-state="hover">Save</button>`,
  'components/plain.html': `<style>${BUTTON}</style><button data-dc-state="hover">Save</button><button data-dc-state="active">Save</button>`,
  'components/ring-colour.html': `<style>${BUTTON} button:focus-visible{outline:none;color:#c00}</style><button data-dc-state="focus-visible">Save</button>`,
  'components/ring-none.html': `<style>${BUTTON} button:focus-visible{outline:none}</style><button data-dc-state="focus-visible">Save</button>`,
  // The labels as the reference writes them: a static copy of hover with a class, beside the rest instance.
  'components/copy.html': `<style>${BUTTON} button:hover, button.is-hover{background:#333;color:#fff}</style><button data-dc-state="rest">Save</button> <button class="is-hover" data-dc-state="hover">Save</button>`,
  // Two seconds, and nothing moves until the end: read at normal speed it would look unstyled.
  'components/slow.html': `<style>${BUTTON} button{transition:background-color 2s steps(1, end)} button:hover{background:#333}</style><button data-dc-state="hover">Save</button>`,
};

test('labelled states are forced over CDP, pictured tight, and the unstyled ones named', { timeout: 180_000 }, async (t) => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) return;
  const tmp = await useTmpRoot(t);
  for (const [rel, text] of Object.entries(fixture)) await tmp.write(`_systems/acme/${rel}`, text);

  const store = cliSystemStore(tmp.root, { version: 1 });
  try {
    const started = Date.now();
    const result = await runSystemCheck(store, 'acme', {
      now: new Date(),
      tool: 'cli',
      render: { browserPath, probeSource: await probeSource(), platform: process.platform, isRoot: process.getuid?.() === 0 },
    });
    const elapsed = Date.now() - started;
    const render = result.report.render;
    assert.ok(render !== null);
    assert.equal(render.state, 'done', JSON.stringify(render.findings));

    const states = render.states ?? [];
    const verdict = (entry: string, state: string) => states.find((one) => one.entry === `component:${entry}` && one.state === state);
    assert.equal(verdict('styled', 'hover')?.styled, true, JSON.stringify(states));
    assert.equal(verdict('plain', 'hover')?.styled, false);
    assert.equal(verdict('plain', 'active')?.styled, false);
    assert.equal(verdict('ring-colour', 'focus-visible')?.styled, true, 'a colour change alone is a styled focus');
    assert.equal(verdict('ring-none', 'focus-visible')?.styled, false, 'outline: none and nothing else is not');
    assert.equal(verdict('copy', 'hover')?.styled, true, 'forced on the rest twin, the real :hover shows');
    assert.equal(verdict('slow', 'hover')?.styled, true, 'read where the transition ends');
    assert.equal(states.length, 7, JSON.stringify(states));

    const unstyled = render.findings.filter((finding) => finding.code === 'system-state-unstyled');
    assert.deepEqual(
      unstyled.map((finding) => [finding.file, finding.viewport, finding.detail, finding.params?.count]).sort(),
      [
        ['components/plain.html', 'wide', 'plain: hover, active', 2],
        ['components/ring-none.html', 'wide', 'ring-none: focus-visible', 1],
      ],
    );
    assert.ok(!render.findings.some((finding) => finding.code === 'system-board-partial'), JSON.stringify(render.findings));

    // Every state has a tight picture, named by component and state, kept in the run.
    const kept = new Set(render.widths.flatMap((width) => width.pngs));
    for (const one of states) {
      assert.ok(one.png !== null, `${one.entry} ${one.state} pictured`);
      assert.match(one.png, new RegExp(`${one.entry.slice('component:'.length)}-${one.state}@wide\\.png$`));
      assert.ok(kept.has(one.png), `${one.png} is kept`);
      const bytes = await readFile(tmp.at(`_systems/acme/${one.png}`));
      assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      assert.ok(width > 20 && width < 300, `${one.png} is ${width}px wide`);
      assert.ok(height > 20 && height < 120, `${one.png} is ${height}px tall`);
    }
    // The board's own budget still holds with the state pass in it.
    assert.ok(elapsed < 70_000, `${elapsed} ms`);
  } finally {
    await store.dispose();
  }
});
