// Existing-system discovery (documentation/specs/phase-2-6-technical.md §5.5, AD-7, AD-12): the
// path-only rules over a walk's file list, on fixtures shaped like real repos (Next.js, Vite,
// SvelteKit, a contract folder, a docs site), the rank, the merge, `strong`, the counts, a system
// already registered, the caps, the missed counts and the location view.

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import type { SystemCandidate } from '../../../src/shared/api.ts';
import { SYSTEM_CANDIDATES_MAX } from '../../../src/shared/limits.ts';
import { CANDIDATE_PATH_MAX, findSystemCandidates, locationView, missedCounts, type CandidateToken } from '../../../src/service/systems/candidates.ts';

const ROOT = path.resolve('/projects/shop');

const find = (files: string[], tokens: CandidateToken[] = [], registered: { id: string; name: string; abs: string }[] = []): { candidates: SystemCandidate[]; total: number } =>
  findSystemCandidates({ files, tokens, registered, root: ROOT });

const pathsOf = (found: { candidates: SystemCandidate[] }): string[] => found.candidates.map((one) => one.path);
const one = (found: { candidates: SystemCandidate[] }, at: string): SystemCandidate => {
  const hit = found.candidates.find((candidate) => candidate.path === at);
  assert.ok(hit, `a candidate at "${at}" in ${JSON.stringify(pathsOf(found))}`);
  return hit;
};
const colours = (file: string, n: number): CandidateToken[] => Array.from({ length: n }, () => ({ file, section: 'colours' as const }));

test('Next.js: app/design-system/page.tsx is a page in a system folder, with its components', () => {
  const found = find([
    'package.json',
    'app/page.tsx',
    'app/layout.tsx',
    'app/design-system/page.tsx',
    'app/design-system/components/Button.tsx',
    'app/design-system/components/Card.tsx',
    'app/design-system/components/notes.txt',
    'app/design-system/README.md',
    'src/components/Header.tsx',
  ]);
  assert.deepEqual(pathsOf(found), ['app/design-system']);
  const ds = one(found, 'app/design-system');
  assert.deepEqual(ds.marks, ['page', 'docs', 'components']);
  assert.deepEqual(ds.counts, { colours: 0, tokens: 0, docs: 1, components: 2, pages: 1 });
  assert.equal(ds.strong, true);
  assert.equal(ds.registered, null);
});

test('Vite: src/styles/tokens.css alone is not a system; DESIGN.md at the root is (weakly)', () => {
  const tokens = [...colours('src/styles/tokens.css', 12), { file: 'src/styles/tokens.css', section: 'spacing' as const }];
  const lone = find(['index.html', 'src/main.ts', 'src/styles/tokens.css'], tokens);
  assert.deepEqual(pathsOf(lone), [], 'a lone token file does not qualify');
  const withDoc = find(['index.html', 'DESIGN.md', 'src/main.ts', 'src/styles/tokens.css'], tokens);
  assert.deepEqual(pathsOf(withDoc), ['']);
  const root = one(withDoc, '');
  assert.deepEqual(root.marks, ['docs']);
  assert.equal(root.strong, false, 'a named doc alone is the weakest rank');
  // Docs and tokens together in one folder qualify.
  const together = find(['docs/design-tokens.css', 'docs/design-guide.md'], colours('docs/design-tokens.css', 6));
  const docs = one(together, 'docs');
  assert.deepEqual(docs.marks, ['tokens', 'docs']);
  assert.deepEqual(docs.counts, { colours: 6, tokens: 6, docs: 1, components: 0, pages: 0 });
});

test('SvelteKit and public pages: +page.svelte and index.html in a design-system folder, design-system.tsx anywhere', () => {
  const found = find(['src/routes/design-system/+page.svelte', 'public/styleguide/index.html', 'src/pages/design-system.tsx', 'src/pages/home.tsx']);
  assert.deepEqual(pathsOf(found), ['public/styleguide', 'src/pages', 'src/routes/design-system']);
  for (const candidate of found.candidates) {
    assert.ok(candidate.marks.includes('page'), candidate.path);
    assert.equal(candidate.strong, true);
  }
  // A page deeper inside the system folder is not its page (components/x/index.tsx is a component).
  const deep = find(['design-system/components/button/index.tsx']);
  assert.deepEqual(one(deep, 'design-system').counts.pages, 0);
});

test("a contract folder ranks first and is Complete; one without tokens.css isn't a contract", () => {
  const found = find(
    ['brand-kit/system.json', 'brand-kit/tokens.css', 'brand-kit/OVERVIEW.md', 'brand-kit/components/button.html', 'design-system/notes.md', 'half/system.json'],
    colours('brand-kit/tokens.css', 24),
  );
  assert.deepEqual(pathsOf(found), ['brand-kit', 'design-system']);
  const kit = one(found, 'brand-kit');
  assert.deepEqual(kit.marks, ['contract', 'tokens', 'docs', 'components']);
  assert.deepEqual(kit.counts, { colours: 24, tokens: 24, docs: 1, components: 1, pages: 0 });
  assert.equal(kit.strong, true);
  // A contract inside a system folder stays its own place to register.
  const nested = find(['design-system/index.html', 'design-system/tokens/system.json', 'design-system/tokens/tokens.css']);
  assert.deepEqual(pathsOf(nested), ['design-system/tokens', 'design-system']);
  assert.ok(one(nested, 'design-system/tokens').marks.includes('contract'));
  assert.ok(!one(nested, 'design-system').marks.includes('contract'), 'the parent is never marked Complete for a child');
});

test('a docs site: a lone generic doc or brand.md is not a system; a style-guide folder name is', () => {
  assert.deepEqual(pathsOf(find(['docs/brand.md', 'docs/getting-started.md', 'README.md'])), []);
  const named = find(['docs/style-guide/colours.md', 'docs/style-guide/type.md']);
  assert.deepEqual(pathsOf(named), ['docs/style-guide']);
  assert.deepEqual(one(named, 'docs/style-guide').marks, ['docs']);
  assert.equal(one(named, 'docs/style-guide').strong, true);
});

test('rank, then shallower first, then by path; the totals and the cap', () => {
  const found = find(['a/b/ui-kit/x.md', 'ui-kit/x.md', 'z/design-system/index.html', 'contract/system.json', 'contract/tokens.css', 'DESIGN.md']);
  assert.deepEqual(pathsOf(found), ['contract', 'z/design-system', 'ui-kit', 'a/b/ui-kit', '']);
  assert.equal(found.total, 5);
  const many = find(Array.from({ length: SYSTEM_CANDIDATES_MAX + 7 }, (_, n) => `app${String(n).padStart(3, '0')}/design-system/index.html`));
  assert.equal(many.candidates.length, SYSTEM_CANDIDATES_MAX);
  assert.equal(many.total, SYSTEM_CANDIDATES_MAX + 7);
});

test('a system already registered from this folder (repo home or code folder) is marked, compared as paths', () => {
  const registered = [
    { id: 'speak-ui', name: 'Speak UI', abs: path.join(ROOT, 'apps', 'web', 'design-system') },
    { id: 'other', name: 'Other', abs: path.join(ROOT, 'elsewhere') },
  ];
  const found = find(['apps/web/design-system/index.html', 'design-system/index.html'], [], registered);
  assert.deepEqual(one(found, 'apps/web/design-system').registered, { id: 'speak-ui', name: 'Speak UI' });
  assert.equal(one(found, 'design-system').registered, null);
  // The comparison is the injected one (case-folded on win32 and darwin by default).
  const folded = findSystemCandidates({
    files: ['Design-System/index.html'],
    tokens: [],
    registered: [{ id: 'x', name: 'X', abs: path.join(ROOT, 'design-system') }],
    root: ROOT,
    same: (a, b) => a.toLowerCase() === b.toLowerCase(),
  });
  assert.deepEqual(folded.candidates[0]?.registered, { id: 'x', name: 'X' });
});

test('hostile names: a path with a control character or past the length cap is never offered', () => {
  const long = `${'a'.repeat(CANDIDATE_PATH_MAX)}/design-system`;
  const found = find(['bad\nname/design-system/index.html', `${long}/index.html`, 'ok/design-system/index.html']);
  assert.deepEqual(pathsOf(found), ['ok/design-system']);
});

test('a CSS file counts as a token file by name or by yielding five tokens in this scan', () => {
  const four = find(['look/app.css', 'look/design-system.md'], colours('look/app.css', 4));
  assert.deepEqual(one(four, 'look').marks, ['docs']);
  const five = find(['look/app.css', 'look/notes.md', 'look/DESIGN.md'], colours('look/app.css', 5));
  assert.deepEqual(one(five, 'look').marks, ['tokens', 'docs']);
  const named = find(['look/variables.css', 'look/notes.md', 'docs/design/x.md']);
  assert.deepEqual(pathsOf(named), []);
  const theme = find(['design-system/theme.ts', 'design-system/tailwind.config.js', 'design-system/tokens.json']);
  assert.deepEqual(one(theme, 'design-system').marks, ['tokens', 'theme']);
});

test('missedCounts: pages, component files and themes written in code', () => {
  assert.deepEqual(
    missedCounts([
      'app/page.tsx',
      'app/settings/page.tsx',
      'src/routes/+page.svelte',
      'public/index.html',
      'src/pages/about.astro',
      'src/pages/blog.tsx',
      'src/components/Button.tsx',
      'src/components/ui/Card.vue',
      'src/components/README.md',
      'tailwind.config.ts',
      'src/theme.ts',
      'src/Button.styles.ts',
      'src/styled-system.ts',
      'src/styles/app.css',
      'src/main.ts',
    ]),
    { pages: 6, components: 2, codeThemes: 4 },
  );
  assert.deepEqual(missedCounts([]), { pages: 0, components: 0, codeThemes: 0 });
});

test('locationView: marks and read lists of the folder, project-relative, ≤ 20 each, shallowest first', () => {
  const files = ['index.html', 'docs/b.md', 'a.md', 'system.json', 'tokens.css', ...Array.from({ length: 25 }, (_, n) => `components/c${String(n).padStart(2, '0')}.html`)];
  const view = locationView({ location: 'design-system', files, tokens: colours('tokens.css', 3) });
  assert.equal(view.path, 'design-system');
  assert.deepEqual(view.marks, ['contract', 'page', 'tokens', 'docs', 'components']);
  assert.deepEqual(view.read.page, ['design-system/index.html']);
  assert.deepEqual(view.read.docs, ['design-system/a.md', 'design-system/docs/b.md']);
  assert.equal(view.read.components.length, 20);
  assert.equal(view.read.components[0], 'design-system/components/c00.html');
  const root = locationView({ location: '', files: ['DESIGN.md'], tokens: [] });
  assert.deepEqual(root.read.docs, ['DESIGN.md']);
});
