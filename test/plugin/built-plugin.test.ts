// The built OpenCode plugin (documentation/specs/phase-1-5-sdk-2-7.md §U3.4 1, §6): imported the
// way OpenCode imports it, it registers exactly one tool, `design_check`, with plain JSON Schema
// input, and nothing in it can reach the service or its token. Runs after the build in
// `npm run check` (test/package-tree.test.ts checks that it imports nothing).

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const BUILT = path.join(REPO_ROOT, 'dist', 'plugin', 'index.js');

type RegisteredTool = {
  name: string;
  description: string;
  options: { codemode: boolean };
  input: Record<string, unknown>;
  execute: (input: unknown, context: unknown) => Promise<{ content: string; metadata?: unknown }>;
};

const loadPlugin = async (): Promise<{ id: string; setup: (ctx: unknown) => Promise<void> | void }> => {
  assert.ok(existsSync(BUILT), 'dist/plugin/index.js is missing. Run `npm run build` first.');
  const module = (await import(pathToFileURL(BUILT).href)) as { default: { id: string; setup: (ctx: unknown) => Promise<void> | void } };
  return module.default;
};

test('setup registers design_check, design_list and design_read, each with plain JSON Schema input', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.id, 'design-chamber');
  const added: RegisteredTool[] = [];
  let transforms = 0;
  await plugin.setup({
    tool: {
      transform: async (fn: (tools: { add: (tool: RegisteredTool) => void }) => void) => {
        transforms += 1;
        fn({ add: (tool) => added.push(tool) });
      },
    },
  });
  assert.equal(transforms, 1);
  assert.deepEqual(added.map((one) => one.name), ['design_check', 'design_list', 'design_read']);
  for (const one of added) {
    assert.deepEqual(one.options, { codemode: false }, one.name);
    assert.ok(one.description.length > 0 && one.description.length <= 200 && !one.description.includes('—'), one.name);
    assert.deepEqual(JSON.parse(JSON.stringify(one.input)), one.input, one.name);
    assert.equal(one.input.type, 'object');
    assert.equal(typeof one.execute, 'function');
  }
  assert.deepEqual(Object.keys(added[1]?.input.properties as object).sort(), ['kind', 'project', 'text']);
  assert.deepEqual(Object.keys(added[2]?.input.properties as object), ['design']);
  const [tool] = added;
  assert.ok(tool);
  assert.equal(tool.name, 'design_check');
  assert.deepEqual(tool.options, { codemode: false });
  assert.ok(tool.description.length > 0 && !tool.description.includes('\u2014'), 'a description without em dashes');
  // Plain JSON Schema: survives a JSON round trip unchanged and holds no functions or zod objects.
  assert.deepEqual(JSON.parse(JSON.stringify(tool.input)), tool.input);
  assert.equal(tool.input.type, 'object');
  // One of design or system (Phase 2.5 §10.2): the schema can't say "exactly one", parseToolInput does.
  assert.equal(tool.input.required, undefined);
  // area and scheme are the system check's closed enums (system-builder-depth D8).
  assert.deepEqual(Object.keys(tool.input.properties as object).sort(), ['area', 'design', 'scheme', 'screens', 'static', 'system']);
  assert.equal(typeof tool.execute, 'function');
});

test('the built tools refuse a path before they read anything', async () => {
  const plugin = await loadPlugin();
  const tools: RegisteredTool[] = [];
  await plugin.setup({ tool: { transform: (fn: (tools: { add: (t: RegisteredTool) => void }) => void) => fn({ add: (t) => tools.push(t) }) } });
  const byName = (name: string): RegisteredTool => {
    const found = tools.find((one) => one.name === name);
    assert.ok(found, name);
    return found;
  };
  for (const name of ['design_check', 'design_read']) {
    const result = await byName(name).execute({ design: '../../etc' }, { sessionID: 'ses_1' });
    assert.equal(result.content, 'That is not a design folder name. Use the name of a folder in the Designs folder, such as pricing-page.', name);
    assert.deepEqual(result.metadata, { designChamber: { exit: 2 } });
  }
  const list = await byName('design_list').execute({ project: '../../etc' }, { sessionID: 'ses_1' });
  assert.match(list.content, /^project must be the full path of a project folder/);
  assert.deepEqual(list.metadata, { designChamber: { exit: 2 } });
});

test('the plugin never talks to the service: no token, no port, no fetch, in the source or the build', () => {
  const pluginDir = path.join(REPO_ROOT, 'src', 'plugin');
  const sources = readdirSync(pluginDir).map((name) => [`src/plugin/${name}`, readFileSync(path.join(pluginDir, name), 'utf8')] as const);
  const files = [...sources, ['dist/plugin/index.js', readFileSync(BUILT, 'utf8')] as const];
  for (const [name, text] of files) {
    for (const forbidden of [/OPENCHAMBER_SERVICE_TOKEN/, /OPENCHAMBER_SERVICE_PORT/, /OPENCHAMBER_HOST_CALLBACK_URL/, /\bfetch\s*\(/, /authorization/i, /bearer/i]) {
      assert.doesNotMatch(text, forbidden, `${name} must not reach the service (${forbidden})`);
    }
  }
  const record = readFileSync(path.join(REPO_ROOT, 'src', 'service', 'runtime-record.ts'), 'utf8');
  assert.doesNotMatch(record, /token/i, 'runtime-record.ts must not touch the token');
});
