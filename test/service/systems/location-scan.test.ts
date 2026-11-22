// Discovery and location scans over HTTP (documentation/specs/phase-2-6-technical.md §3.2, §5.5 to
// §5.8, AD-7, AD-8, AD-12): a project scan answers `read`, `missed` and the candidates; a location scan
// walks only that folder and answers what it holds and its contract verdict (complete, each missing
// case, a root location, none); the body rules; making a system from a location records the project
// and the existing folder, re-checks it first, and the make message names the project and the files
// to read first.

import assert from 'node:assert/strict';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import type { CreateSystemResponse, SystemPromptResponse } from '../../../src/shared/api.ts';
import { resyncStampOf } from '../../../src/shared/system-json.ts';
import type { SystemDetail, SystemState } from '../../../src/shared/types.ts';
import { CONTRACT_MISSING, contractVerdict, LOCATION_RESYNC_MESSAGE } from '../../../src/service/systems/extract.ts';
import { LOCATION_GONE_SENTENCE, LOCATION_URL_SENTENCE } from '../../../src/service/systems/scan-folder.ts';
import { messageOf, setupLocation, summaryOf } from './location-fixture.ts';

test('POST /system-scans with a location refuses a missing or wrong token, and a location with a system id', async (t) => {
  const { call, project, tmp } = await setupLocation(t);
  for (const token of [null, 'wrong-token']) {
    assert.equal((await call('POST', '/system-scans', { directory: project, location: 'design-system' }, token)).status, 401);
  }
  const both = await call('POST', '/system-scans', { directory: project, location: 'design-system', systemId: 'acme' });
  assert.equal(both.status, 400);
  assert.equal(messageOf(both), LOCATION_RESYNC_MESSAGE);
  for (const location of [42, '', '   ', null]) {
    const answer = await call('POST', '/system-scans', { directory: project, location });
    assert.equal(answer.status, 400, JSON.stringify(location));
  }
  assert.deepEqual(await readdir(tmp.at('Designs')), ['.keep'], 'nothing was written');
});

test('location refusals: traversal, a folder elsewhere, a web address, the Designs folder, a gone folder', async (t) => {
  const { call, project, base, root } = await setupLocation(t);
  const cases: [string, string | RegExp][] = [
    ['../Designs', /Designs folder|inside shop/],
    ['..', 'Pick a folder inside shop.'],
    [base, 'Pick a folder inside shop.'],
    ['https://speakappi.com/design-system', LOCATION_URL_SENTENCE],
    ['http://localhost:3000/design-system', LOCATION_URL_SENTENCE],
    [root, "Pick your app's folder, not the Designs folder."],
    ['no-such-folder', /doesn't exist/],
    ['design-system/tokens.css', /isn't a folder/],
  ];
  for (const [location, sentence] of cases) {
    const answer = await call('POST', '/system-scans', { directory: project, location });
    assert.equal(answer.status, 400, location);
    assert.equal((answer.json as { error: string }).error, 'bad-path', location);
    if (typeof sentence === 'string') assert.equal(messageOf(answer), sentence, location);
    else assert.match(messageOf(answer), sentence, location);
  }
  // The project itself still passes validateScanFolder first.
  const projectInRoot = await call('POST', '/system-scans', { directory: root, location: '.' });
  assert.equal(projectInRoot.status, 400);
});

test('a project scan: files read, what was missed, and the candidates (contract first, then the page)', async (t) => {
  const { project, scan } = await setupLocation(t);
  const summary = summaryOf((await scan({ directory: project })).answer);
  assert.equal(summary.read, 3, 'src/theme.css, design-system/extra.css and design-system/tokens.css were opened');
  assert.deepEqual(summary.missed, { pages: 3, components: 3, codeThemes: 1 });
  assert.equal(summary.location, undefined);
  assert.deepEqual(summary.candidates?.map((one) => one.path), ['design-system', 'app/design-system']);
  assert.equal(summary.candidatesMore, 0);
  const ds = summary.candidates?.[0];
  assert.deepEqual(ds?.marks, ['contract', 'page', 'tokens', 'docs', 'components']);
  assert.deepEqual([ds?.counts.docs, ds?.counts.components, ds?.counts.pages], [4, 1, 1]);
  assert.equal(ds?.strong, true);
  assert.equal(ds?.registered, null);
  const page = summary.candidates?.[1];
  assert.deepEqual(page?.marks, ['page']);
  // Never a secret file, and nothing but paths and counts travels.
  assert.ok(!JSON.stringify(summary).includes('deploy.pem'));
  assert.ok(!JSON.stringify(summary).includes('#1a73e8'));
});

test('a location scan walks only that folder and answers what it holds, with a complete contract', async (t) => {
  const { project, scan } = await setupLocation(t);
  const { answer } = await scan({ directory: project, location: 'design-system' });
  const summary = summaryOf(answer);
  assert.equal(summary.directory, path.join(project, 'design-system'));
  assert.equal(summary.candidates, undefined);
  assert.equal(summary.read, 2);
  assert.deepEqual(summary.location, {
    path: 'design-system',
    marks: ['contract', 'page', 'tokens', 'docs', 'components'],
    read: {
      page: ['design-system/index.html'],
      docs: ['design-system/OVERVIEW.md', 'design-system/README.md', 'design-system/notes/history.md', 'design-system/notes/deep/nested.md'],
      components: ['design-system/components/button.html'],
    },
    contract: { complete: true },
  });
  // No file outside the location was read.
  assert.ok(summary.files.every((one) => !one.path.startsWith('src/')));
});

test('the contract verdict: each missing part, an unreadable system.json, a root location, none at all', async (t) => {
  const { project, scan, tmp } = await setupLocation(t);
  const contractOf = async (location: string) => summaryOf((await scan({ directory: project, location })).answer).location?.contract;

  await tmp.write('shop/half/system.json', '{"version":1}\n');
  assert.deepEqual(await contractOf('half'), { complete: false, missing: [CONTRACT_MISSING.tokensCss] });
  await tmp.write('shop/broken/system.json', 'not json');
  await tmp.write('shop/broken/tokens.css', ':root { --a: #fff; }\n');
  assert.deepEqual(await contractOf('broken'), { complete: false, missing: [CONTRACT_MISSING.unreadableJson] });
  await tmp.write('shop/empty/system.json', '{"version":1}\n');
  await tmp.write('shop/empty/tokens.css', '/* nothing yet */\n');
  assert.deepEqual(await contractOf('empty'), { complete: false, missing: [CONTRACT_MISSING.tokensCss] });
  await tmp.write('shop/my system/system.json', '{"version":1}\n');
  await tmp.write('shop/my system/tokens.css', ':root { --a: #fff; }\n');
  assert.deepEqual(await contractOf('my system'), { complete: false, missing: [CONTRACT_MISSING.folderPath] });
  assert.equal(await contractOf('app'), null, 'no system.json: no verdict, no Complete badge');

  // The project root holding the contract is never registrable: a repo home needs a folder.
  await tmp.write('shop/system.json', '{"version":1}\n');
  await tmp.write('shop/tokens.css', ':root { --a: #fff; }\n');
  assert.deepEqual(await contractOf('.'), { complete: false, missing: [CONTRACT_MISSING.rootFolder] });
  const root = summaryOf((await scan({ directory: project, location: '.' })).answer);
  assert.equal(root.location?.path, '');

  // The pure verdict.
  const files = (entries: Record<string, string>): Map<string, Buffer> => new Map(Object.entries(entries).map(([rel, text]) => [rel, Buffer.from(text)]));
  assert.deepEqual(contractVerdict({ files: files({ 'system.json': '{"version":1}', 'tokens.css': ':root{--a:1px}' }) }), { complete: true });
  assert.deepEqual(contractVerdict({ files: files({}) }), { complete: false, missing: [CONTRACT_MISSING.systemJson, CONTRACT_MISSING.tokensCss] });
});

test('making a system from a location: project and existing recorded, the location re-checked, the make message names them', async (t) => {
  const { project, scan, call, tmp } = await setupLocation(t);
  const { scanId } = await scan({ directory: project, location: 'design-system' });
  const made = await call('POST', '/systems', { name: 'Shop', code: { scanId, assets: [] } });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const { id, system } = made.json as CreateSystemResponse;
  const state = JSON.parse(await tmp.read(`Designs/_systems/${id}/.chamber/state.json`)) as SystemState;
  assert.equal(state.home?.kind, 'internal', 'the sheet makes an internal Draft');
  assert.equal(state.sources.code?.directory, path.join(project, 'design-system'), 'the location is the code source, so a re-sync reads the same place');
  assert.equal(state.sources.code?.project, project);
  assert.deepEqual(state.sources.code?.existing, {
    location: 'design-system',
    marks: ['contract', 'page', 'tokens', 'docs', 'components'],
    read: {
      page: ['design-system/index.html'],
      docs: ['design-system/OVERVIEW.md', 'design-system/README.md', 'design-system/notes/history.md', 'design-system/notes/deep/nested.md'],
      components: ['design-system/components/button.html'],
    },
  });
  assert.deepEqual(system.sources.code?.existing, { location: 'design-system' });
  assert.equal(system.sources.code?.project, project);

  const prompt = await call('POST', `/systems/${id}/prompt`, { purpose: 'make' });
  assert.equal(prompt.status, 200, JSON.stringify(prompt.json));
  const text = (prompt.json as SystemPromptResponse).text;
  assert.ok(text.includes(`Project: ${project}\n`), text);
  assert.ok(text.includes(`Start from the design system already in ${path.join(project, 'design-system')}.`), text);
  assert.ok(text.includes('Read these first: design-system/index.html; docs design-system/OVERVIEW.md, design-system/README.md'), text);
  assert.ok(text.includes('components design-system/components/button.html.'), text);
  assert.ok(text.includes("Build from what is there and reconcile to it. Don't invent a parallel system."), text);
  assert.ok(text.includes(`Don't change anything in ${project}. Write only in `), 'the repo rule names the project, not the location');

  // A location deleted between the scan and Make: "That folder is gone." and nothing is made.
  const again = await scan({ directory: project, location: 'app/design-system' });
  await rm(path.join(project, 'app', 'design-system'), { recursive: true });
  const gone = await call('POST', '/systems', { name: 'Gone', code: { scanId: again.scanId, assets: [] } });
  assert.equal(gone.status, 400);
  assert.equal(messageOf(gone), LOCATION_GONE_SENTENCE);
  assert.ok(!((await call('GET', '/systems')).json as { systems: { name: string }[] }).systems.some((one) => one.name === 'Gone'));
});

test('re-sync re-point rule: a re-sync inside the project keeps the project and location; one outside drops them', async (t) => {
  const { project, scan, call, tmp, base, jobs } = await setupLocation(t);
  const made = (await call('POST', '/systems', { name: 'Shop', code: { scanId: (await scan({ directory: project, location: 'design-system' })).scanId, assets: [] } })).json as CreateSystemResponse;
  const id = made.id;
  const stampOf = async (): Promise<string> => resyncStampOf(((await call('GET', `/systems/${id}`)).json as SystemDetail).stamps);
  const resync = async (directory: string): Promise<void> => {
    const { scanId } = (await call('POST', '/system-scans', { directory, systemId: id })).json as { scanId: string };
    await jobs.settled(scanId);
    const applied = await call('POST', `/systems/${id}/resync`, { scanId, stamp: await stampOf(), changes: [], useCode: [], add: ['--fresh'], remove: [], assets: [] });
    assert.equal(applied.status, 200, JSON.stringify(applied.json));
  };
  const codeOf = async () => (JSON.parse(await tmp.read(`Designs/_systems/${id}/.chamber/state.json`)) as SystemState).sources.code;

  // Inside the project (the same folder, a new token in it): both stay.
  await tmp.write('shop/design-system/more.css', ':root { --fresh: #123456; }\n');
  await resync(path.join(project, 'design-system'));
  assert.equal((await codeOf())?.project, project);
  assert.equal((await codeOf())?.existing?.location, 'design-system');

  // Re-pointed outside the project: a plain code source now.
  await tmp.write('elsewhere/theme.css', ':root { --fresh: #654321; --other: 1px; }\n');
  const elsewhere = path.join(base, 'elsewhere');
  const { scanId } = (await call('POST', '/system-scans', { directory: elsewhere, systemId: id })).json as { scanId: string };
  await jobs.settled(scanId);
  const applied = await call('POST', `/systems/${id}/resync`, { scanId, stamp: await stampOf(), changes: [], useCode: [], add: ['--other'], remove: [], assets: [] });
  assert.equal(applied.status, 200, JSON.stringify(applied.json));
  const code = await codeOf();
  assert.equal(code?.directory, elsewhere);
  assert.equal(code?.project, undefined);
  assert.equal(code?.existing, undefined);
});
