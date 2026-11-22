// A project that already has a design system, served over HTTP, for the Phase 2.6 existing-system
// tests (documentation/specs/phase-2-6-technical.md §5.5 to §5.10): the P25 fixture repo (a complete
// `design-system/` contract folder with a living page, a secret file and non-contract files) plus
// app code around it (a page in code, components, a Tailwind config, docs), and the Designs folder
// beside it. Every route the flows use is mounted behind the bearer check.

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { TestContext } from 'node:test';

import type { CreateSystemScanResponse, ScanSummary, SystemScanResponse } from '../../../src/shared/api.ts';
import type { ServiceContext } from '../../../src/service/context.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemBuildRoutes } from '../../../src/service/routes/system-build.ts';
import { registerSystemChatRoutes } from '../../../src/service/routes/system-chat.ts';
import { registerSystemEditRoutes } from '../../../src/service/routes/system-edits.ts';
import { registerSystemRegisterRoutes } from '../../../src/service/routes/system-register.ts';
import { registerSystemScanRoutes } from '../../../src/service/routes/system-scans.ts';
import { registerSystemsRoutes } from '../../../src/service/routes/systems.ts';
import { installScanJobs, type ScanJobs, type ScanJobsOptions } from '../../../src/service/systems/extract.ts';
import { configureLivingExamples } from '../../../src/service/systems/living-examples.ts';
import { ensureSystemStore, type SystemStore } from '../../../src/service/systems/store.ts';
import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { createTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';
import { REPO_FILES } from './repo-fixture.ts';

export const TOKEN = 'location-routes-token-0123456789ab';

/** App code around the system folder: what discovery and the missed line see. */
export const APP_FILES: Record<string, string> = {
  'app/page.tsx': 'export default function Home() { return null; }\n',
  'app/design-system/page.tsx': 'export default function DesignSystem() { return null; }\n',
  'src/components/Button.tsx': 'export const Button = () => null;\n',
  'src/components/Card.tsx': 'export const Card = () => null;\n',
  'tailwind.config.js': 'module.exports = {};\n',
  'docs/brand.md': '# Brand\n',
};

export type Answer = { status: number; json: unknown };

export type LocationRig = {
  tmp: TmpRoot;
  base: string;
  project: string;
  root: string;
  ctx: FakeContext & ServiceContext;
  systems: SystemStore;
  jobs: ScanJobs;
  call(method: string, url: string, body?: unknown, token?: string | null): Promise<Answer>;
  /** Start a scan (optionally of a location) and wait for its end: the id and the final answer. */
  scan(body: { directory: string; location?: string }): Promise<{ scanId: string; answer: SystemScanResponse }>;
};

export const summaryOf = (answer: SystemScanResponse): ScanSummary => {
  assert.equal(answer.state, 'done', JSON.stringify(answer));
  return (answer as Extract<SystemScanResponse, { state: 'done' }>).summary;
};

export const messageOf = (answer: Answer): string => (answer.json as { message: string }).message;

export const setupLocation = async (t: TestContext, options: ScanJobsOptions = {}, layout: { rootInsideProject?: boolean } = {}): Promise<LocationRig> => {
  const tmp = await createTmpRoot('dc-location-');
  const base = tmp.root;
  const project = path.join(base, 'shop');
  for (const [rel, text] of Object.entries({ ...REPO_FILES, ...APP_FILES })) await tmp.write(`shop/${rel}`, text);
  const root = layout.rootInsideProject === true ? path.join(project, 'Designs') : path.join(base, 'Designs');
  await tmp.write(path.relative(base, path.join(root, '.keep')).split(path.sep).join('/'), '');
  const ctx = createFakeContext({ root, overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } } }) as FakeContext & ServiceContext;
  t.after(() => ctx.dispose());
  configureLivingExamples(ctx, { openBrowser: null });
  const jobs = installScanJobs(ctx, options);
  const systems = ensureSystemStore(ctx);
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerSystemsRoutes(router, ctx);
  registerSystemScanRoutes(router, ctx);
  registerSystemRegisterRoutes(router, ctx);
  registerSystemChatRoutes(router, ctx);
  registerSystemBuildRoutes(router, ctx);
  registerSystemEditRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, url: string, body?: unknown, token: string | null = TOKEN): Promise<Answer> => {
    const answer = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: answer.status, json: (await answer.json()) as unknown };
  };
  const scan = async (body: { directory: string; location?: string }): Promise<{ scanId: string; answer: SystemScanResponse }> => {
    const started = await call('POST', '/system-scans', body);
    assert.equal(started.status, 200, JSON.stringify(started.json));
    const { scanId } = started.json as CreateSystemScanResponse;
    await jobs.settled(scanId);
    const got = await call('GET', `/system-scans/${scanId}`);
    assert.equal(got.status, 200, JSON.stringify(got.json));
    return { scanId, answer: got.json as SystemScanResponse };
  };
  // Added last: node:test runs `after` hooks in order, so the services stop before the files go.
  t.after(() => tmp.cleanup());
  return { tmp, base, project, root, ctx, systems, jobs, call, scan };
};
