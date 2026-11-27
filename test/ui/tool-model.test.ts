// Plain words for the call the linked agent is making (native-extras §1.2, §1.3). The name and the target come
// from the model, so an unknown name says nothing and a target is only ever shown, cleaned, as text.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeTool, toolDesignOf, type ToolDesign } from '../../src/ui/model/tool-model.ts';

const DESIGN: ToolDesign = { slug: 'coffee', entry: null, files: ['screens/home.html', 'screens/pricing.html', 'tokens.css', 'DESIGN.md'] };
const of = (name: string, target: string | null = null, design: ToolDesign | null = DESIGN) => describeTool({ name, target }, design);
const words = (name: string, target: string | null = null, design: ToolDesign | null = DESIGN) => {
  const said = of(name, target, design);
  return said && [said.kind, said.full, said.short];
};

test('every table row, with a target', () => {
  for (const name of ['edit', 'multiedit', 'patch', 'apply_patch', 'str_replace_based_edit_tool']) {
    assert.deepEqual(words(name, 'screens/pricing.html'), ['edit', 'Editing screens/pricing.html', 'Editing pricing.html'], name);
  }
  assert.deepEqual(words('write', 'screens/pricing.html'), ['write', 'Writing screens/pricing.html', 'Writing pricing.html']);
  assert.deepEqual(words('read', 'src/styles/theme.css'), ['read', 'Reading src/styles/theme.css', 'Reading theme.css'], 'work outside the design is shown too');
  for (const name of ['glob', 'grep', 'list', 'ls', 'codesearch']) {
    assert.deepEqual(words(name, 'src/components'), ['search', 'Looking through src/components', 'Looking through components'], name);
  }
  for (const name of ['webfetch', 'websearch']) assert.deepEqual(words(name, 'https://example.com'), ['web', 'Looking something up online', 'Looking something up online'], name);
  for (const name of ['todowrite', 'todoread']) assert.deepEqual(words(name), ['plan', 'Planning the next steps', 'Planning'], name);
  assert.deepEqual(words('task'), ['helper', 'A helper agent is working', 'Helper agent working']);
  assert.deepEqual(words('design_check', 'coffee'), ['check', 'Checking the design', 'Checking']);
  for (const name of ['design_list', 'design_read']) assert.deepEqual(words(name), ['designs', 'Reading your designs', 'Reading designs'], name);
});

test('a shell command never shows its target, in the text or the tooltip', () => {
  for (const name of ['bash', 'shell']) {
    assert.deepEqual(of(name, 'rm -rf /'), { kind: 'run', full: 'Running a command', short: 'Running a command', path: null }, name);
  }
});

test('no target: a file, or the files', () => {
  assert.deepEqual(words('edit'), ['edit', 'Editing a file', 'Editing a file']);
  assert.deepEqual(words('write'), ['write', 'Writing a file', 'Writing a file']);
  assert.deepEqual(words('read'), ['read', 'Reading a file', 'Reading a file']);
  assert.deepEqual(words('grep'), ['search', 'Searching the files', 'Searching the files']);
  assert.deepEqual(words('glob', '.'), ['search', 'Searching the files', 'Searching the files'], 'the folder itself is not a name');
  assert.equal(of('read')?.path, null);
});

test('names are case-folded and lose an mcp server and a namespace', () => {
  assert.equal(of('Read', 'a.css')?.kind, 'read');
  assert.equal(of('mcp__opencode__edit', 'a.css')?.kind, 'edit');
  assert.equal(of('mcp__design_chamber__design_check')?.kind, 'check');
  assert.equal(of('tools.read', 'a.css')?.kind, 'read');
  assert.equal(of('mcp__x__ns.sub.Write', 'a.css')?.kind, 'write');
});

test('an unknown tool says nothing, object keys included', () => {
  for (const name of ['question', 'skill', 'mcp__x__deploy', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'read.', '']) {
    assert.equal(of(name, 'a.css'), null, name);
  }
});

test('a bare name that is exactly one design file shows the design path', () => {
  assert.equal(of('edit', 'pricing.html')?.full, 'Editing screens/pricing.html');
  assert.equal(of('edit', 'pricing.html')?.path, 'screens/pricing.html');
  assert.equal(of('read', 'tokens.css')?.full, 'Reading tokens.css');
  assert.equal(of('write', 'index.html', { slug: 'p', entry: 'index.html', files: [] })?.full, 'Writing index.html');
});

test('a bare name two design files share, or none has, stays as the host gave it', () => {
  const twins: ToolDesign = { slug: 'coffee', entry: null, files: ['screens/a/pricing.html', 'screens/b/pricing.html'] };
  assert.equal(of('edit', 'pricing.html', twins)?.full, 'Editing pricing.html');
  assert.equal(of('edit', 'theme.css')?.full, 'Editing theme.css');
  assert.equal(of('edit', 'pricing.html', null)?.full, 'Editing pricing.html', 'no design known');
});

test('a path through the design folder is shortened to the design path, on a whole segment only', () => {
  assert.equal(of('edit', 'coffee/screens/pricing.html')?.full, 'Editing screens/pricing.html');
  assert.equal(of('edit', '../Designs/coffee/screens/pricing.html')?.full, 'Editing screens/pricing.html');
  assert.equal(of('edit', 'Designs\\coffee\\screens\\pricing.html')?.full, 'Editing screens/pricing.html', 'Windows separators');
  assert.equal(of('edit', 'screens\\pricing.html')?.full, 'Editing screens/pricing.html');
  assert.equal(of('edit', 'iced-coffee/screens/pricing.html')?.full, 'Editing iced-coffee/screens/pricing.html', 'another design is not this one');
  assert.equal(of('edit', 'src/screens/pricing.html')?.full, 'Editing src/screens/pricing.html', 'a project file of the same name stays itself');
});

test('long paths: the full text cuts the middle, the short one the name, the tooltip keeps everything', () => {
  const long = `src/${'deeply-nested-folder/'.repeat(4)}a-very-long-component-file-name.module.css`;
  const said = of('read', long);
  assert.ok(said);
  assert.ok(said.full.length <= 'Reading '.length + 48 && said.full.includes('…'), said.full);
  assert.ok(said.short.length <= 'Reading '.length + 24 && said.short.includes('…'), said.short);
  assert.equal(said.path, long);
});

test('bidi and control characters are removed before the name is matched or cut', () => {
  const said = of('edit', 'screens/‮gnp.⁦exe\u0007.html');
  assert.equal(said?.full, 'Editing screens/gnp.exe.html');
  assert.equal(said?.short, 'Editing gnp.exe.html');
  assert.equal(said?.path, 'screens/gnp.exe.html');
  assert.equal(of('edit', 'pri‏cing.html')?.full, 'Editing screens/pricing.html', 'cleaned first, then matched');
  assert.equal(of('read', '‮‏')?.full, 'Reading a file', 'nothing left is no target');
  // Cut after cleaning: invisible characters never use up the room or leave half a name behind.
  assert.equal(of('read', `${'‎'.repeat(60)}theme.css`)?.full, 'Reading theme.css');
});

test('toolDesignOf: the entry, every screen, the tokens and the notes', () => {
  const screens = [{ id: 'home', title: 'Home', file: 'screens/home.html' }];
  assert.deepEqual(toolDesignOf('coffee', { entry: null, screens }), { slug: 'coffee', entry: null, files: ['screens/home.html', 'tokens.css', 'DESIGN.md'] });
  assert.deepEqual(toolDesignOf('p', { entry: 'index.html', screens: [] }), { slug: 'p', entry: 'index.html', files: ['tokens.css', 'DESIGN.md'] });
});
