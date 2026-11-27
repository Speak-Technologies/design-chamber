// The owner's decisions for Use the project (documentation/specs/use-the-project-and-native-agent.md, "Decisions",
// 2026-11-27), held end to end through POST /chip with the real store, discovery and settings parse:
//   1. a thin project (only a Tailwind config) beats a global default system;
//   2. a project pinned to "No design system" links nothing, but RULES.md still puts the project's files first;
//   4. a hand-written legacy `default` pin reads as Use the project.

import assert from 'node:assert/strict';
import { lstat, mkdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';

import type { ServiceContext } from '../../../src/service/context.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerChatRoutes } from '../../../src/service/routes/chat.ts';
import { normalizeSettings } from '../../../src/service/settings.ts';
import { createDesignStore } from '../../../src/service/store.ts';
import { ensureSystemStore } from '../../../src/service/systems/store.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const TOKEN = 'use-the-project-decisions-token-01';

const serve = async (t: TestContext) => {
  const tmp = await useTmpRoot(t);
  const projects = await useTmpRoot(t, 'dc-projects-');
  const fake = createFakeContext({ root: tmp.root, overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } } });
  t.after(() => fake.dispose());
  const ctx: ServiceContext = Object.assign(fake, { store: createDesignStore({ settings: fake.settings, log: fake.log, hub: fake.hub }) });
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerChatRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const chip = async (projectDirectory: string): Promise<string> => {
    const answer = await fetch(`http://127.0.0.1:${port}/chip`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'page', brief: 'A pricing page', projectDirectory }),
    });
    const json = (await answer.json()) as { slug?: string };
    assert.equal(answer.status, 200, JSON.stringify(json));
    return json.slug as string;
  };
  const systems = ensureSystemStore(ctx);
  const acmeReady = async (): Promise<string> => {
    const { id } = await systems.create({ name: 'Acme' });
    await tmp.write(`_systems/${id}/tokens.css`, ':root {\n  --brand-500: #1a73e8;\n}\n');
    await tmp.write(`_systems/${id}/OVERVIEW.md`, 'Acme.\n');
    await systems.patch(id, { status: 'ready' });
    return id;
  };
  const project = async (name: string, files: Record<string, string>): Promise<string> => {
    const dir = projects.at(name);
    await mkdir(dir, { recursive: true });
    for (const [file, text] of Object.entries(files)) await projects.write(`${name}/${file}`, text);
    return dir;
  };
  const decisionOf = async (slug: string): Promise<unknown> => (JSON.parse(await tmp.read(`${slug}/.chamber/state.json`)) as { systemDecision?: unknown }).systemDecision;
  const linked = async (slug: string): Promise<boolean> => (await lstat(tmp.at(`${slug}/system`)).catch(() => null)) !== null;
  return { tmp, ctx, chip, acmeReady, project, decisionOf, linked };
};

test('decision 1: a project with only a Tailwind config beats a global default system', async (t) => {
  const { ctx, chip, acmeReady, project, decisionOf, linked } = await serve(t);
  const acme = await acmeReady();
  await ctx.settings.update({ systemDefault: { choice: 'system', id: acme, name: 'Acme' } });
  const thin = await project('thin', { 'tailwind.config.ts': 'export default { theme: { extend: {} } }', 'package.json': '{}' });
  const slug = await chip(thin);
  assert.equal(await decisionOf(slug), 'project');
  assert.equal(await linked(slug), false, 'the global default is not linked');
});

test('decision 2: a project pinned to No design system links nothing, and RULES.md still reads the project first', async (t) => {
  const { tmp, ctx, chip, acmeReady, project, decisionOf, linked } = await serve(t);
  const acme = await acmeReady();
  const shop = await project('shop', { 'DESIGN.md': '# Shop\n## Colours\n' });
  await ctx.settings.update({ systemDefault: { choice: 'system', id: acme, name: 'Acme' }, systemPins: [{ directory: shop, choice: 'none' }] });
  const slug = await chip(shop);
  assert.equal(await decisionOf(slug), 'none');
  assert.equal(await linked(slug), false);
  const rules = await tmp.read(`${slug}/.chamber/RULES.md`);
  assert.ok(rules.includes("### Layer 2: the active project's design rules (look for these FIRST)"), 'the project is layer 2');
  assert.ok(rules.includes('DESIGN.md'), 'the project file is named');
});

test('decision 4: a legacy `default` pin in settings.json reads as Use the project, not as the default', async (t) => {
  const { ctx, chip, acmeReady, project, decisionOf, linked } = await serve(t);
  const acme = await acmeReady();
  const shop = await project('shop', { 'DESIGN.md': '# Shop' });
  // What settings.json on disk would hold, read through the real parse.
  const parsed = normalizeSettings({ systemDefault: { choice: 'system', id: acme, name: 'Acme' }, systemPins: [{ directory: shop, choice: 'default' }] });
  assert.equal(parsed.systemPins, undefined, 'the legacy pin is dropped on read');
  await ctx.settings.update({ systemDefault: parsed.systemDefault, ...(parsed.systemPins === undefined ? {} : { systemPins: parsed.systemPins }) });
  const slug = await chip(shop);
  assert.equal(await decisionOf(slug), 'project');
  assert.equal(await linked(slug), false);
});
