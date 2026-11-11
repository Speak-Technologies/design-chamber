import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

import { noProject, type ProjectRules } from '../../src/shared/agent/context.ts';
import { CHECK_TOOL_NAME } from '../../src/shared/agent/guide.ts';
import { buildRulesDoc, checkSection } from '../../src/shared/agent/rules-doc.ts';
import { baseContext, REPO_RULES } from './helpers.ts';
import { assertSnapshot } from './snapshot.ts';

const read = (...parts: string[]): Promise<string> => readFile(path.join(REPO_RULES, ...parts), 'utf8');

const realFiles = async () => ({ designRules: await read('DESIGN-RULES.md'), questions: await read('QUESTIONS.md') });

const PRESET_TEXT = '# Test Preset\n**id:** test-preset · **best for:** tests\n\n```css\n:root { --accent: #123456; }\n```\n';

const project: ProjectRules = {
  state: 'scanned',
  directory: 'C:\\Users\\you\\code\\beans',
  note: null,
  sources: [
    { path: 'DESIGN.md', kind: 'design-doc', why: 'design document' },
    { path: 'AGENTS.md', kind: 'agent-rules', why: 'design sections: "Design system"', headings: ['Design system'] },
  ],
  sourcesOmitted: 3,
  breakpoints: [{ px: 768, directions: ['min'], origin: 'css', count: 5 }],
  viewports: [
    { id: 'phone', label: 'Phone', width: 390, height: 844 },
    { id: 'tablet', label: 'Tablet', width: 768, height: 1024 },
  ],
  truncated: true,
};

const indexOf = (text: string, needle: string): number => {
  const index = text.indexOf(needle);
  assert.ok(index >= 0, `missing: ${needle}`);
  return index;
};

describe('RULES.md assembly', () => {
  test('holds every precedence layer in order, then viewports, contract, both rules files, rendering constraints', async () => {
    const doc = buildRulesDoc(baseContext({ project, preset: { id: 'test-preset', name: 'Test Preset', text: PRESET_TEXT } }), await realFiles());
    const markers = [
      '# Design Chamber instructions for',
      '## Do this, in this order',
      '## Precedence',
      '### Layer 1: the user\'s words in chat',
      '### Layer 2: the active project\'s design rules (look for these FIRST)',
      '### Layer 3: style preset Test Preset',
      '### Layer 4: this design\'s own DESIGN.md + tokens.css, once confirmed',
      '### Layer 5: the built-in rules',
      '## Viewports',
      '## design.json contract',
      '<!-- BEGIN rules/DESIGN-RULES.md (verbatim) -->',
      '<!-- END rules/DESIGN-RULES.md -->',
      '<!-- BEGIN rules/QUESTIONS.md (verbatim) -->',
      '<!-- END rules/QUESTIONS.md -->',
      '## Rendering constraints',
    ];
    const positions = markers.map((marker) => indexOf(doc, marker));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'sections appear in the specified order');
  });

  test('contains both rules files verbatim, exactly as shipped', async () => {
    const files = await realFiles();
    const doc = buildRulesDoc(baseContext(), files);
    assert.ok(doc.includes(files.designRules), 'DESIGN-RULES.md verbatim');
    assert.ok(doc.includes(files.questions), 'QUESTIONS.md verbatim');
  });

  test('inlines the chosen preset verbatim; says "none chosen" otherwise', async () => {
    const files = await realFiles();
    const withPreset = buildRulesDoc(baseContext({ preset: { id: 'test-preset', name: 'Test Preset', text: PRESET_TEXT } }), files);
    assert.ok(withPreset.includes(PRESET_TEXT));
    assert.ok(withPreset.includes('### Layer 3: style preset Test Preset (`test-preset`)'));
    const minimal = await read('presets', 'minimal-saas.md');
    assert.ok(buildRulesDoc(baseContext({ preset: { id: 'minimal-saas', name: 'Minimal SaaS', text: minimal } }), files).includes(minimal), 'a real bundled preset');
    assert.ok(buildRulesDoc(baseContext(), files).includes('### Layer 3: style preset, none chosen'));
  });

  test('layer 2 lists the project sources, or explains why there are none', async () => {
    const files = await realFiles();
    const found = buildRulesDoc(baseContext({ project }), files);
    assert.ok(found.includes('- `DESIGN.md`: design document'));
    assert.ok(found.includes('- `AGENTS.md`: design sections: "Design system"'));
    assert.ok(found.includes('… and 3 more not listed.'));
    assert.ok(found.includes('The scan stopped early'));
    assert.ok(found.includes('Discover the project\'s design rules first'));

    assert.ok(buildRulesDoc(baseContext(), files).includes('No project folder is open in this chat (the chat has no project folder)'));
    const empty = { ...project, sources: [], sourcesOmitted: 0, truncated: false };
    assert.ok(buildRulesDoc(baseContext({ project: empty }), files).includes('found no design documents, token/theme files, or design sections'));
    const unreadable = { ...noProject('the folder does not exist', 'C:\\gone'), state: 'unreadable' as const };
    assert.ok(buildRulesDoc(baseContext({ project: unreadable }), files).includes('could not be read (the folder does not exist)'));
  });

  test('layer 4 reflects the design system status', async () => {
    const files = await realFiles();
    const status = (designSystem: { confirmed: boolean; hasDesignMd: boolean; hasTokensCss: boolean }): string =>
      buildRulesDoc(baseContext({ designSystem }), files).split('### Layer 4')[1]?.split('### Layer 5')[0] ?? '';
    assert.match(status({ confirmed: true, hasDesignMd: true, hasTokensCss: true }), /confirmed \(design\.json `designSystem\.confirmed` is true\)/);
    assert.match(status({ confirmed: false, hasDesignMd: true, hasTokensCss: false }), /not confirmed yet \(DESIGN\.md exists, no tokens\.css\)/);
    assert.match(status({ confirmed: false, hasDesignMd: false, hasTokensCss: false }), /not written yet/);
  });

  test('viewports: project suggestions, the defaults, and what design.json lists now', async () => {
    const files = await realFiles();
    const withProject = buildRulesDoc(baseContext({ project }), files);
    assert.ok(withProject.includes('768px (min-width; 5× in @media)'));
    assert.ok(withProject.includes('They suggest: Phone 390×844, Tablet 768×1024.'));
    const plain = buildRulesDoc(baseContext(), files);
    assert.ok(plain.includes('found no breakpoints in the project (or no project is open)'));
    assert.ok(plain.includes('**Laptop 1280×800 + Phone 390×844**'));
    assert.ok(plain.includes('design.json lists now: Laptop 1280×800, Phone 390×844 (the extension\'s defaults until you change them).'));
  });

  test('the design.json contract names every key, its owner and the page entry', async () => {
    const files = await realFiles();
    const canvas = buildRulesDoc(baseContext(), files);
    for (const key of ['version', 'kind', 'title', 'created', 'updated', 'brief', 'sessionId', 'projectDirectory', 'preset', 'entry', 'viewports', 'screens', 'designSystem', 'tweaks', 'comments']) {
      assert.ok(canvas.includes(`\`${key}\``), `contract table names ${key}`);
    }
    assert.ok(canvas.includes('"kind": "canvas"') && canvas.includes('"screens": ['));
    const page = buildRulesDoc(baseContext({ kind: 'page' }), files);
    assert.ok(page.includes('"kind": "page"') && page.includes('"entry": "index.html"'));
    assert.ok(!page.includes('"screens": ['));
    const pageHeader = page.split('## Precedence')[0] ?? '';
    assert.ok(pageHeader.includes('  - the page: C:\\Users\\you\\Documents\\Designs\\pricing-page\\index.html') && !pageHeader.includes('one file per screen'));
    assert.ok(page.includes('| `entry` | extension | Page only: always `"index.html"`. |'));
  });

  test('the contract names tweaks, direction marks and the re-read rule (Phase 2)', async () => {
    const files = await realFiles();
    const canvas = buildRulesDoc(baseContext(), files);
    assert.ok(canvas.includes('| `tweaks` | you | Optional, up to 12 knobs for the Tweaks panel.'));
    assert.ok(canvas.includes('"tweaks": [ { "var": "--accent-h", "label": "Accent hue", "kind": "number", "min": 0, "max": 360, "step": 1, "unit": "" } ],'));
    assert.ok(canvas.includes('A direction of another screen carries `"direction": { "of": "home", "letter": "A", "name": "Bold" }` (2 to 4 directions per screen, letters A to D, name up to 40 characters; never on the original).'));
    assert.ok(canvas.includes('Design Chamber also writes this list when the user reorders, duplicates, trashes or keeps a screen, so read design.json again right before you write it.'));
    assert.ok(canvas.includes("- The user's hand edits (text, tweaks, the screen list) land in your files directly. Re-read a file before you change it."));
    const page = buildRulesDoc(baseContext({ kind: 'page' }), files);
    assert.ok(page.includes('"tweaks": ['), 'a page can offer tweaks too');
    assert.ok(page.includes('| `tweaks` | you |'));
  });

  test('rendering constraints: localStorage is kept per design, sessionStorage per reload, no IndexedDB (Phase 2)', async () => {
    const doc = buildRulesDoc(baseContext(), await realFiles());
    assert.ok(doc.includes('`localStorage` works and is kept per design (up to 1 MB), so saved ticks and filters survive a reload'));
    assert.ok(doc.includes('`sessionStorage` lasts until the screen reloads'));
    assert.ok(doc.includes('There is no `top.location`, `window.open`, cookie, IndexedDB or network call.'));
    assert.ok(!doc.includes('cookie/localStorage assumption'), 'the old no-localStorage wording is gone');
  });

  test('the kind row: page or canvas, switchable only until the first HTML file is written', async () => {
    const doc = buildRulesDoc(baseContext(), await realFiles());
    assert.ok(
      doc.includes(
        '| `kind` | extension | `"page"` (one index.html shown full screen) or `"canvas"` (a wall of screens). Fixed once you have written the first screen or index.html; before that you may switch it, as long as the design has no comments yet. |',
      ),
    );
    assert.ok(doc.includes('- Write design.json before any HTML file'));
  });

  test('header names the designs root, the "nowhere else" rule and what the kind means', async () => {
    const files = await realFiles();
    const canvas = buildRulesDoc(baseContext(), files);
    const header = canvas.split('## Precedence')[0] ?? '';
    assert.ok(header.includes('- Designs folder: C:\\Users\\you\\Documents\\Designs. The user set it in Design Chamber settings (the default is ~/Documents/Designs).'));
    assert.ok(header.includes('Never save designs anywhere else, and never as a loose file.'));
    assert.ok(header.includes('(canvas: a canvas is an infinite wall of screens, each shown at every viewport side by side, like Claude Design)'));
    assert.ok(header.includes('5. Build only inside the folder above. Write design.json first, then the HTML.'));
    const page = buildRulesDoc(baseContext({ kind: 'page' }), files).split('## Precedence')[0] ?? '';
    assert.ok(page.includes('(page: a page is one index.html shown full screen, like a browser tab)'));
  });

  test('our own wording has no em dashes (the shipped rules files are quoted verbatim and checked separately)', async () => {
    const stub = { designRules: 'rules\n', questions: 'questions\n' };
    for (const kind of ['canvas', 'page'] as const) {
      for (const context of [baseContext({ kind }), baseContext({ kind, project, preset: { id: 'test-preset', name: 'Test Preset', text: 'preset' }, brief: '' })]) {
        assert.ok(!buildRulesDoc(context, stub).includes('\u2014'), kind);
      }
    }
  });

  test('header names the folder, the file map and the brief; rendering constraints cover the offline rules', async () => {
    const doc = buildRulesDoc(baseContext({ brief: 'Line one\nLine two' }), await realFiles());
    assert.ok(doc.includes('Folder (write ONLY inside it): C:\\Users\\you\\Documents\\Designs\\pricing-page'));
    assert.ok(doc.includes('design.json: C:\\Users\\you\\Documents\\Designs\\pricing-page\\design.json'));
    assert.ok(doc.includes('  > Line one\n  > Line two'));
    assert.ok(doc.includes('no CDN scripts, Google Fonts or other web fonts, remote images or analytics'));
    assert.ok(doc.includes('Remote files are blocked and listed back to you when the user sends comments.'));
    assert.ok(doc.includes('data-dc-goto="<screenId>"'));
  });

  test('the check section names design_check first, then the command, and RULES.md carries it as is (P15 §U2.4)', async () => {
    const command = "sh '/home/you/Documents/Designs/.chamber/bin/dc' check pricing-page";
    const withCommand = checkSection({ tool: CHECK_TOOL_NAME, command }).join('\n');
    assert.ok(withCommand.indexOf('design_check') < withCommand.indexOf(command));
    assert.ok(withCommand.includes('The command exits with 0 when there are no errors.'));
    const none = checkSection({ tool: CHECK_TOOL_NAME, command: null }).join('\n');
    assert.ok(none.includes("look for the check command in the Designs folder's AGENTS.md"));
    assert.ok(!none.includes('exits with 0'), 'no exit code without a command');
    const files = await realFiles();
    assert.ok(buildRulesDoc(baseContext({ checkCommand: command }), files).includes(withCommand));
    assert.ok(buildRulesDoc(baseContext({ checkCommand: null }), files).includes(none));
  });

  test('is deterministic: the same inputs give the same bytes (the service skips unchanged writes)', async () => {
    const files = await realFiles();
    assert.equal(buildRulesDoc(baseContext({ project }), files), buildRulesDoc(baseContext({ project }), files));
  });

  test('golden sample: a canvas in a Tailwind project with a preset (rules bodies stubbed so it only tracks our wording)', async () => {
    const stub = { designRules: '(rules/DESIGN-RULES.md text appears here)\n', questions: '(rules/QUESTIONS.md text appears here)\n' };
    const context = baseContext({
      project: {
        ...project,
        sourcesOmitted: 0,
        truncated: false,
        sources: [
          { path: 'DESIGN.md', kind: 'design-doc', why: 'design document' },
          { path: 'tailwind.config.ts', kind: 'tokens', why: 'Tailwind config (screens: sm 640 · md 768 · lg 1024)' },
          { path: 'AGENTS.md', kind: 'agent-rules', why: 'design sections: "Design system"; "UI conventions"', headings: ['Design system', 'UI conventions'] },
        ],
        breakpoints: [
          { px: 640, directions: ['min'], origin: 'tailwind', count: 1, name: 'sm' },
          { px: 768, directions: ['min'], origin: 'tailwind', count: 1, name: 'md' },
          { px: 1024, directions: ['min'], origin: 'tailwind', count: 1, name: 'lg' },
        ],
        viewports: [
          { id: 'phone', label: 'Phone', width: 390, height: 844 },
          { id: 'tablet', label: 'Tablet', width: 768, height: 1024 },
          { id: 'laptop', label: 'Laptop', width: 1280, height: 800 },
        ],
      },
      preset: { id: 'test-preset', name: 'Test Preset', text: PRESET_TEXT },
    });
    await assertSnapshot('rules.canvas-project-preset.md', buildRulesDoc(context, stub));
  });
});
