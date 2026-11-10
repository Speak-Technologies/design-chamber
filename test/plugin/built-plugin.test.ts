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

test('setup registers exactly one tool, design_check, with plain JSON Schema input', async () => {
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
  assert.equal(added.length, 1);
  const [tool] = added;
  assert.ok(tool);
  assert.equal(tool.name, 'design_check');
  assert.deepEqual(tool.options, { codemode: false });
  assert.ok(tool.description.length > 0 && !tool.description.includes('\u2014'), 'a description without em dashes');
  // Plain JSON Schema: survives a JSON round trip unchanged and holds no functions or zod objects.
  assert.deepEqual(JSON.parse(JSON.stringify(tool.input)), tool.input);
  assert.equal(tool.input.type, 'object');
  assert.deepEqual(tool.input.required, ['design']);
  assert.deepEqual(Object.keys(tool.input.properties as object).sort(), ['design', 'screens', 'static']);
  assert.equal(typeof tool.execute, 'function');
});

test('the built tool refuses a path before it reads anything', async () => {
  const plugin = await loadPlugin();
  let tool: RegisteredTool | null = null;
  await plugin.setup({ tool: { transform: (fn: (tools: { add: (t: RegisteredTool) => void }) => void) => fn({ add: (t) => (tool = t) }) } });
  assert.ok(tool);
  const result = await (tool as RegisteredTool).execute({ design: '../../etc' }, { sessionID: 'ses_1' });
  assert.equal(result.content, 'That is not a design folder name. Use the name of a folder in the Designs folder, such as pricing-page.');
  assert.deepEqual(result.metadata, { designChamber: { exit: 2 } });
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
