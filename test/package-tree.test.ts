// The install tree OpenChamber loads (docs/SPEC.md §12, spec §U1.2). `openchamber-guest-check`
// (npm run guest-check) verifies the manifest, the pages and the service entry, but it does not
// look at `skills` or `opencodePlugin`, so this file does. Runs after the build in `npm run check`.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const at = (relative: string): string => path.join(root, ...relative.split('/'));
const read = (relative: string): string => {
  assert.ok(existsSync(at(relative)), `${relative} is missing. Run \`npm run build\` first.`);
  return readFileSync(at(relative), 'utf8');
};

/** The plugin is loaded with a bare import() where nothing is installed, so it may import nothing. */
const IMPORT_PATTERN = /^\s*import[\s{*]|\bimport\s*\(|\brequire\s*\(/m;

test('the import check catches a static import, a dynamic import and a require', () => {
  assert.match("import fs from 'node:fs';\nexport default {};", IMPORT_PATTERN);
  assert.match("import{a}from'x';", IMPORT_PATTERN);
  assert.match("const m = await import('node:fs');", IMPORT_PATTERN);
  assert.match("const m = require('node:fs');", IMPORT_PATTERN);
  assert.doesNotMatch('var index_default = { id: "design-chamber" };\nexport { index_default as default };', IMPORT_PATTERN);
});

test('dist/plugin is an OpenCode plugin folder that imports nothing', () => {
  const code = read('dist/plugin/index.js');
  assert.doesNotMatch(code, IMPORT_PATTERN, 'dist/plugin/index.js imports something; it must import nothing');
  assert.match(code, /export\s*\{[^}]*\bdefault\b/, 'dist/plugin/index.js must default-export the plugin');
  const pkg: unknown = JSON.parse(read('dist/plugin/package.json'));
  assert.ok(typeof pkg === 'object' && pkg !== null);
  const { name, version, type, exports } = pkg as Record<string, unknown>;
  assert.equal(name, 'design-chamber-tools');
  const manifest = JSON.parse(read('package.json')) as { version: string };
  assert.equal(version, manifest.version);
  assert.equal(type, 'module');
  assert.deepEqual(exports, { '.': './index.js' });
});

test('dist/skills/design-chamber/SKILL.md has the frontmatter and the rules, and ships the presets', () => {
  const skill = read('dist/skills/design-chamber/SKILL.md');
  assert.match(skill, /^---\r?\nname: design-chamber\r?\ndescription: .+\r?\n---\r?\n/, 'SKILL.md needs name and description frontmatter');
  assert.ok(skill.includes(read('rules/DESIGN-RULES.md').trim()), 'SKILL.md must carry rules/DESIGN-RULES.md in full');
  assert.ok(skill.includes(read('rules/QUESTIONS.md').trim()), 'SKILL.md must carry rules/QUESTIONS.md in full');
  assert.doesNotMatch(skill, /\/home\/|\/Users\/|[A-Za-z]:\\Users\\/, 'the skill is static and ships to everyone: no absolute path');
  for (const preset of ['editorial', 'minimal-saas', 'nocturne']) {
    assert.ok(existsSync(at(`dist/skills/design-chamber/presets/${preset}.md`)), `presets/${preset}.md is missing`);
  }
});

test('the status and block frames load scripts and styles that were built', () => {
  for (const frame of ['status', 'blocks']) {
    const html = read(`dist/${frame}/index.html`);
    const sources = [...html.matchAll(/<(?:script|link)[^>]*\s(?:src|href)=["']([^"']+)["']/g)].flatMap(([, source]) => (source ? [source] : []));
    assert.ok(sources.some((source) => source === 'main.js'), `dist/${frame}/index.html must load main.js`);
    for (const source of sources) {
      assert.ok(existsSync(at(`dist/${frame}/${source}`)), `dist/${frame}/index.html loads ${source}, which was not built`);
    }
  }
});

// ---- release workflow (read, not run: the first real run is the owner's tag) ----

const releaseYml = (): string => read('.github/workflows/release.yml');

test('release.yml runs only for v* tags, never for a branch', () => {
  const text = releaseYml();
  const on = text.slice(text.indexOf('\non:'), text.indexOf('\npermissions:'));
  assert.match(on, /push:\s*\n\s*tags: \['v\*'\]/);
  assert.doesNotMatch(on, /branches:|pull_request|workflow_dispatch|schedule/, 'release.yml may only start from a tag push');
});

test('release.yml refuses a tag that does not match package.json, before it builds anything', () => {
  const text = releaseYml();
  const tagCheck = text.indexOf('"$TAG" != "v$version"');
  assert.ok(tagCheck > 0, 'the tag check is missing');
  assert.ok(text.indexOf('exit 1', tagCheck) > tagCheck, 'the tag check must exit 1');
  assert.ok(tagCheck < text.indexOf('npm ci'), 'the tag check must run before npm ci');
  // A tag name is typed by a person: it may reach a shell only through an env variable.
  const lines = text.split('\n').filter((line) => /\$\{\{\s*github\.ref_name\s*\}\}/.test(line));
  assert.ok(lines.length > 0);
  for (const line of lines) assert.match(line.trim(), /^(?:TAG:|name:)/, `ref_name outside an env value: ${line.trim()}`);
});

test('release.yml installs the same files scripts/pack.mjs zips', () => {
  const pack = /const INCLUDE = \[([^\]]+)\]/.exec(read('scripts/pack.mjs'))?.[1];
  assert.ok(pack, 'INCLUDE not found in scripts/pack.mjs');
  const packed = [...pack.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const copied = /for item in ([^;]+);/.exec(releaseYml())?.[1]?.trim().split(/\s+/);
  assert.deepEqual(copied, packed);
});

test('release.yml publishes the release branch and a release-v tag, and never pushes master', () => {
  const text = releaseYml();
  assert.match(text, /refs\/heads\/release"/);
  assert.match(text, /refs\/tags\/release-v\$VERSION/);
  assert.doesNotMatch(text, /--force|push[^\n]*master/);
});
