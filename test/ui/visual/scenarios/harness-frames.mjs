// Visual scenario for the harness itself (Phase 1.5 seams): the Work Status frame and a chat block
// frame mount behind the mock host with the fake service, a block call can be injected, route
// answers can be overridden by a scenario, and the host's rules hold (a block answers only from a
// click, once; a failed open-surface says why). It runs the harness probe frame (`entry: 'probe'`),
// which does what a real status or block frame does, so it keeps working while the real frames are
// still empty; the real entries are mounted at the end to prove their bundles load.
// `helpers` is what the other scenarios use: openPage, check, sleep, outDir, root.

const DIRECTION = { name: 'DirectionPick', args: { question: 'Which direction should the pricing page take?', options: 'Editorial|Dense table', slugs: 'northwind-pricing|coffee-subscription' } };

export const run = async ({ openPage, check, sleep }) => {
  for (const [width, theme] of [[320, 'dark'], [480, 'light']]) {
    await statusFrame({ openPage, check }, width, theme);
    await blockFrame({ openPage, check, sleep }, width, theme);
  }
  await realEntries({ openPage, check });
};

const probe = (p, expression) => p.guest(`return (async () => { const probe = win.__probe; return ${expression}; })()`);

const statusFrame = async ({ openPage, check }, width, theme) => {
  const tag = `harness-status-${width}-${theme}`;
  const p = await openPage({ width, height: 400, surface: 'status', theme, label: tag, entry: 'probe' });
  console.log(tag);
  await p.waitFor('return !!win.__probe && win.__probe.surface === "status" && win.__probe.status !== null', 'the probe to read the status rows');
  check((await probe(p, 'probe.status.slugs.length')) > 0, `${tag}: the fake backend answers GET /status/designs`);
  check((await p.host('document.getElementById("g").style.height')) === '120px', `${tag}: the frame starts at the manifest height`);

  check((await probe(p, 'probe.setHeight(48)')).ok === true, `${tag}: setHeight is answered`);
  check((await p.host('document.getElementById("g").style.height')) === '48px', `${tag}: setHeight sizes the frame`);
  await probe(p, 'probe.setHeight(5000)');
  check((await p.host('document.getElementById("g").style.height')) === '320px', `${tag}: the host clamps a status frame to 320 px`);

  // A route answer a scenario sets later, and back to the fake backend.
  await p.route('GET /status/designs', { status: 500, body: { error: 'internal', message: 'The local service didn’t answer.' } });
  await probe(p, 'probe.fetchStatus()');
  check((await probe(p, 'probe.status.error')) === 'internal', `${tag}: a route override answers with its status`);
  await p.route('GET /status/designs', null);
  await probe(p, 'probe.fetchStatus()');
  check((await probe(p, 'probe.status.slugs.length')) > 0, `${tag}: clearing the override goes back to the fake backend`);
  await p.close();

  // An override from the first request, which a later call cannot do.
  const empty = await openPage({ width, height: 400, surface: 'status', theme, label: `${tag}-empty`, entry: 'probe', routes: { 'GET /status/designs': { status: 200, body: { rows: [], total: 0 } } } });
  await empty.waitFor('return !!win.__probe && win.__probe.status !== null', 'the probe to read the status rows');
  check((await probe(empty, 'probe.status.total')) === 0, `${tag}: ?routes answers the first request`);
  await empty.close();
};

const blockFrame = async ({ openPage, check, sleep }, width, theme) => {
  const tag = `harness-block-${width}-${theme}`;
  const p = await openPage({ width, height: 500, surface: 'block', theme, label: tag, entry: 'probe', block: DIRECTION });
  console.log(tag);
  await p.waitFor('return !!win.__probe && win.__probe.block !== null', 'the injected block call');
  check((await probe(p, 'probe.block.name')) === 'DirectionPick' && (await probe(p, 'probe.block.args.options')) === 'Editorial|Dense table', `${tag}: the frame gets the injected call`);
  check((await p.host('document.getElementById("g").style.height')) === '264px', `${tag}: the frame starts at the block's manifest height`);

  const refused = await probe(p, 'probe.answerBlock("Editorial")');
  check(refused.ok === false && refused.code === 'DENIED', `${tag}: an answer without a click is refused (DENIED)`);
  await p.host('window.__host.blockClick = true');
  check((await probe(p, 'probe.answerBlock("Editorial")')).ok === true, `${tag}: an answer from a click is taken`);
  check((await p.host('JSON.stringify(window.__host.blockAnswers)')) === '["Editorial"]', `${tag}: the host recorded the answer`);
  await p.host('window.__host.blockClick = true');
  const twice = await probe(p, 'probe.answerBlock("Dense table")');
  check(twice.ok === false && twice.code === 'HOST_REJECTED', `${tag}: a block takes one answer`);

  await p.setBlock({ name: 'DesignCard', args: { slug: 'coffee-subscription' } });
  await p.waitFor('return win.__probe.block && win.__probe.block.name === "DesignCard"', 'the new block call');
  check((await probe(p, 'probe.block.args.slug')) === 'coffee-subscription', `${tag}: setBlock replaces the call`);

  // openSurface as the rail's open request uses it.
  check((await probe(p, 'probe.openSurface("panel")')).ok === true && (await p.host('JSON.stringify(window.__host.surfacesOpened)')) === '["panel"]', `${tag}: openSurface is recorded`);
  await p.host('window.__host.openSurfaceFails = "NO_DIRECTORY"');
  const failed = await probe(p, 'probe.openSurface("panel")');
  check(failed.ok === false && failed.code === 'NO_DIRECTORY', `${tag}: openSurface can fail with the host's code`);
  await sleep(50);
  await p.close();
};

// The real entries (empty until their branches fill them in) load without a console error.
const realEntries = async ({ openPage, check }) => {
  for (const [surface, block] of [['status', null], ['block', DIRECTION]]) {
    const tag = `harness-real-${surface}`;
    const p = await openPage({ width: 360, height: 400, surface, theme: 'dark', label: tag, block });
    console.log(tag);
    check(await p.guest('return !!doc.getElementById("root")'), `${tag}: the frame's document loads`);
    await p.close();
  }
};
