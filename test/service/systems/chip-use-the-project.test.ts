// POST /chip and Use the project (documentation/specs/use-the-project-and-native-agent.md §1.2, §1.5, T3): the scan
// runs before the rules; a project with its own Ready system links it at creation; a project with only design files
// follows the project (decision `project`, RULES.md names its components and screens); a project with nothing of its
// own gets the default; the New dialog's `@project` is accepted. Real store, real link service, real systems.

import assert from 'node:assert/strict';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import type { DesignSystemView } from '../../../src/shared/api.ts';
import { PROJECT_CHOICE } from '../../../src/shared/systems.ts';
import type { ServiceContext } from '../../../src/service/context.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerChatRoutes } from '../../../src/service/routes/chat.ts';
import { registerDesignSystemRoutes } from '../../../src/service/routes/design-system.ts';
import { createDesignStore } from '../../../src/service/store.ts';
import { ensureSystemStore } from '../../../src/service/systems/store.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const TOKEN = 'use-the-project-token-0123456789';
const AT = '2026-11-27T09:00:00.000Z';

const serve = async (t: TestContext) => {
  const tmp = await useTmpRoot(t);
  const projects = await useTmpRoot(t, 'dc-projects-');
  const fake = createFakeContext({ root: tmp.root, overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } } });
  t.after(() => fake.dispose());
  const ctx: ServiceContext = Object.assign(fake, { store: createDesignStore({ settings: fake.settings, log: fake.log, hub: fake.hub }) });
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerChatRoutes(router, ctx);
  registerDesignSystemRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, url: string, body?: unknown, token: string | null = TOKEN) => {
    const answer = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: answer.status, json: (await answer.json()) as Record<string, unknown> };
  };
  const systems = ensureSystemStore(ctx);
  /** A Ready system with a tokens.css and an overview; `from` records the project it was scanned from. */
  const readySystem = async (name: string, from?: string): Promise<string> => {
    const { id } = await systems.create({ name });
    await tmp.write(`_systems/${id}/tokens.css`, ':root {\n  --brand-500: #1a73e8;\n}\n');
    await tmp.write(`_systems/${id}/OVERVIEW.md`, `${name}.\n`);
    if (from !== undefined) {
      const file = tmp.at(`_systems/${id}/.chamber/state.json`);
      const state = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown> & { sources: Record<string, unknown> };
      state.sources = { ...state.sources, code: { directory: from, lastScan: AT, partial: false, scanned: [] } };
      await writeFile(file, `${JSON.stringify(state, null, 2)}\n`);
    }
    await systems.patch(id, { status: 'ready' });
    return id;
  };
  /** A project folder with the given files. */
  const project = async (name: string, files: Record<string, string>): Promise<string> => {
    const dir = projects.at(name);
    await mkdir(dir, { recursive: true });
    for (const [file, text] of Object.entries(files)) await projects.write(`${name}/${file}`, text);
    return dir;
  };
  const stateOf = async (slug: string): Promise<Record<string, unknown>> => JSON.parse(await tmp.read(`${slug}/.chamber/state.json`)) as Record<string, unknown>;
  return { tmp, ctx, call, systems, readySystem, project, stateOf };
};

test("a project with its own Ready system: linked at creation, RULES.md says why", async (t) => {
  const { tmp, call, readySystem, project, ctx } = await serve(t);
  const shop = await project('shop', { 'DESIGN.md': '# Shop' });
  await readySystem('Acme');
  const own = await readySystem('Shop UI', shop);
  await ctx.settings.update({ systemDefault: { choice: 'none' } });
  const reply = await call('POST', '/chip', { kind: 'canvas', brief: 'A pricing page', projectDirectory: shop });
  assert.equal(reply.status, 200, JSON.stringify(reply.json));
  const slug = reply.json.slug as string;
  const copy = JSON.parse(await tmp.read(`${slug}/system/COPY.json`)) as { id: string; by: string };
  assert.deepEqual([copy.id, copy.by], [own, 'creation']);
  const rules = await tmp.read(`${slug}/.chamber/RULES.md`);
  assert.ok(rules.includes("Design Chamber picked this system because it is shop's own design system."));
});

test('a project with only design files follows the project: decision project, RULES.md names components and screens', async (t) => {
  const { tmp, call, readySystem, project, stateOf, ctx } = await serve(t);
  const shop = await project('shop', { 'DESIGN.md': '# Shop', 'src/components/Button.tsx': '', 'src/components/Button.stories.tsx': '', 'app/page.tsx': '' });
  const acme = await readySystem('Acme');
  await ctx.settings.update({ systemDefault: { choice: 'system', id: acme, name: 'Acme' } });
  const reply = await call('POST', '/chip', { kind: 'canvas', brief: 'A pricing page', projectDirectory: shop });
  assert.equal(reply.status, 200, JSON.stringify(reply.json));
  const slug = reply.json.slug as string;
  assert.equal((await stateOf(slug)).systemDecision, 'project');
  assert.equal(await lstat(tmp.at(`${slug}/system`)).catch(() => null), null, 'nothing linked');
  const rules = await tmp.read(`${slug}/.chamber/RULES.md`);
  assert.ok(rules.includes("### Layer 2: this project's design system and patterns (this design follows the project)"));
  assert.ok(rules.includes('Its components live in: `src/components`.'));
  assert.ok(rules.includes('Its existing screens live in: `app`.'));
  assert.ok(rules.includes("It has 1 Storybook story; read a component's story before you draw it."));
  const chip = (reply.json.chip as { text: string }).text;
  assert.ok(chip.includes('Its components live in src/components; its screens in app. Build it the way the project already looks.'));
  // The viewer's chip reads the same decision.
  const view = await call('GET', `/designs/${slug}/system`);
  assert.deepEqual((view.json as unknown as DesignSystemView).status, { state: 'project' });
});

test('an unreadable project follows the project too', async (t) => {
  const { call, readySystem, stateOf, ctx, tmp } = await serve(t);
  const acme = await readySystem('Acme');
  await ctx.settings.update({ systemDefault: { choice: 'system', id: acme, name: 'Acme' } });
  const reply = await call('POST', '/chip', { kind: 'page', brief: 'x', projectDirectory: `${tmp.root}-gone` });
  assert.equal(reply.status, 200);
  assert.equal((await stateOf(reply.json.slug as string)).systemDecision, 'project');
});

test('an empty project with a default system links the default; Use my default skips the project', async (t) => {
  const { tmp, call, readySystem, project, ctx } = await serve(t);
  const empty = await project('empty', { 'README.md': 'hi' });
  const shop = await project('shop', { 'DESIGN.md': '# Shop' });
  const acme = await readySystem('Acme');
  await ctx.settings.update({ systemDefault: { choice: 'system', id: acme, name: 'Acme' }, systemPins: [{ directory: shop, choice: 'follow-default' }] });
  for (const dir of [empty, shop]) {
    const reply = await call('POST', '/chip', { kind: 'page', brief: 'x', projectDirectory: dir });
    assert.equal(reply.status, 200);
    const copy = JSON.parse(await tmp.read(`${reply.json.slug as string}/system/COPY.json`)) as { id: string; by: string };
    assert.deepEqual([copy.id, copy.by], [acme, 'creation'], dir);
  }
});

test("the New dialog's @project is accepted; a system folder named project stays a system", async (t) => {
  const { tmp, call, readySystem, project, stateOf, ctx } = await serve(t);
  const shop = await project('shop', { 'DESIGN.md': '# Shop' });
  const acme = await readySystem('Acme');
  await ctx.settings.update({ systemPins: [{ directory: shop, choice: 'system', id: acme, name: 'Acme' }] });
  const follow = await call('POST', '/chip', { kind: 'page', brief: 'x', projectDirectory: shop, system: PROJECT_CHOICE });
  assert.equal(follow.status, 200, JSON.stringify(follow.json));
  assert.equal((await stateOf(follow.json.slug as string)).systemDecision, 'project', 'the explicit pick beats the pin');
  const named = await readySystem('Project');
  assert.equal(named, 'project');
  const picked = await call('POST', '/chip', { kind: 'page', brief: 'y', projectDirectory: shop, system: 'project' });
  assert.equal(picked.status, 200);
  assert.equal((JSON.parse(await tmp.read(`${picked.json.slug as string}/system/COPY.json`)) as { id: string }).id, 'project');
  assert.equal((await call('POST', '/chip', { kind: 'page', brief: 'z', system: '@other' })).status, 400);
});

test('POST /chip without the token, or with a wrong one, makes nothing', async (t) => {
  const { call, tmp } = await serve(t);
  for (const token of [null, 'wrong-token']) {
    assert.equal((await call('POST', '/chip', { kind: 'page', brief: 'x', system: PROJECT_CHOICE }, token)).status, 401);
  }
  assert.deepEqual((await readdir(tmp.root)).filter((name) => !name.startsWith('.') && !name.startsWith('_')), []);
});

test('a project folder that tries a traversal is read-only input: it is refused or only scanned, never written', async (t) => {
  const { call } = await serve(t);
  for (const projectDirectory of ['../escape', 'relative/dir', 'C:relative']) {
    const reply = await call('POST', '/chip', { kind: 'page', brief: 'x', projectDirectory });
    assert.equal(reply.status, 400, projectDirectory);
  }
});

test('discovery runs before the rules: a design folder inside the designs root is not a project', async (t) => {
  const { tmp, call, readySystem, ctx, stateOf } = await serve(t);
  const acme = await readySystem('Acme');
  await ctx.settings.update({ systemDefault: { choice: 'none' } });
  await tmp.write('other/DESIGN.md', '# not a project');
  const reply = await call('POST', '/chip', { kind: 'page', brief: 'x', projectDirectory: path.join(tmp.root, 'other') });
  assert.equal(reply.status, 200);
  assert.equal((await stateOf(reply.json.slug as string)).systemDecision, 'none');
  assert.ok(acme);
});
