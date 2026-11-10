// Visual scenario for the Work Status frame (documentation/specs/phase-1-5-sdk-2-7.md §U5.2): every state
// the harness can drive, at the two widths the spec names (280 and 400 px), dark and light.
//
//   loading · list (three mixes of agent, check and comment parts) · empty with and without a project ·
//   a failed read with Try again
//
// then, on the fake service itself: the linked design first, Check (Checking, then the result, and the 409
// toast), Open (the rail opens; "deleted" and "not here" toasts), the frame's height, the Tab order and a
// live theme switch. Rows for the state shots come from `routes`, so the fake backend stays untouched.
//
// Not drivable here: "starting", "isn't responding" and "paused". They come from a host error
// (NO_SERVICE, SERVICE_FAILED, DISABLED) and a route override can only answer with an HTTP status. Those
// sentences and their classification are pinned in test/ui/status-model.test.ts.
// `helpers` is what the other scenarios use: openPage, check, sleep, outDir, root.

const WIDTHS = [280, 400];
const THEMES = ['dark', 'light'];

const checks = (state, over = {}) => ({ counts: { errors: 0, warnings: 0, notes: 0, ...(over.counts ?? {}) }, render: { state }, canRun: over.canRun ?? true, browser: over.browser ?? true });
const row = (slug, title, over = {}) => ({ slug, title, kind: 'page', here: false, agent: null, lastFile: null, checks: null, pending: false, openComments: 0, ...over });

// Writing, issues and comments; working; failed; waiting for the first file (and a title too long for the line); a pass.
const LIST_A = {
  rows: [
    row('pricing-page', 'Pricing page', { here: true, agent: 'writing', lastFile: 'pricing.html', checks: checks('stale', { counts: { errors: 2, warnings: 1 } }), openComments: 2 }),
    row('coffee-subscription', 'Coffee subscription', { kind: 'canvas', agent: 'working', checks: checks('fresh') }),
    row('onboarding-flow', 'Onboarding flow', { kind: 'canvas', agent: 'failed', checks: checks('fresh', { counts: { warnings: 1 } }) }),
    row('habit-tracker', 'Habit tracker explorations with a title far too long for one line', { kind: 'canvas', pending: true }),
    row('invoice-template', 'Invoice template', { checks: checks('fresh') }),
  ],
  total: 12,
};

// The check parts that are not green: rendering stale, never checked, no browser (Check is off), no check read at all.
const LIST_B = {
  rows: [
    row('stale-pass', 'Stale pass', { checks: checks('stale') }),
    row('never-checked', 'Never checked', { checks: checks('none') }),
    row('no-chrome', 'No Chrome here', { checks: checks('unavailable', { canRun: false, browser: false }) }),
    row('unread', 'Checks not read in time'),
    row('one-comment', 'Launch announcement', { checks: checks('fresh'), openComments: 1 }),
  ],
  total: 5,
};

// One design is being checked, so no other design can start one.
const LIST_C = {
  rows: [
    row('checking-now', 'Checking now', { checks: checks('running', { canRun: false }) }),
    row('has-to-wait', 'Has to wait', { checks: checks('none', { canRun: false }) }),
    // A check started from the viewer on a design that is not a row here: nothing below reads "Checking".
    row('passed-before', 'Passed before', { checks: checks('fresh', { canRun: false }) }),
  ],
  total: 3,
};

const ok = (body) => ({ status: 200, body });
const STATES = [
  { id: 'loading', routes: { 'GET /status/designs': { status: 200, body: { rows: [], total: 0 }, delayMs: 120000 } }, ready: 'return !!doc.querySelector(".ws-loading") && !doc.querySelector(".ws-loading").hidden' },
  { id: 'list-a', routes: { 'GET /status/designs': ok(LIST_A) }, ready: 'return doc.querySelectorAll(".ws-row").length === 5' },
  { id: 'list-b', routes: { 'GET /status/designs': ok(LIST_B) }, ready: 'return doc.querySelectorAll(".ws-row").length === 5' },
  { id: 'list-c', routes: { 'GET /status/designs': ok(LIST_C) }, ready: 'return doc.querySelectorAll(".ws-row").length === 3' },
  { id: 'empty-project', routes: { 'GET /status/designs': ok({ rows: [], total: 0 }) }, ready: 'return !!doc.querySelector(".ws-empty") && !doc.querySelector(".ws-empty").hidden' },
  { id: 'error', routes: { 'GET /status/designs': { status: 500, body: { error: 'internal', message: 'The local service didn’t answer.' } } }, ready: 'return !!doc.querySelector(".ws-notice") && !doc.querySelector(".ws-notice").hidden' },
];

const BACKGROUND = { dark: 'rgb(18, 15, 14)', light: 'rgb(253, 252, 250)' };

export const run = async (helpers) => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      for (const state of STATES) await stateShot(helpers, state, width, theme);
      await noProject(helpers, width, theme);
      await chatFolder(helpers, width, theme);
    }
  }
  await onFakeService(helpers, 400, 'dark');
  await onFakeService(helpers, 280, 'light');
};

const text = (p, selector) => p.guest(`return [...doc.querySelectorAll(${JSON.stringify(selector)})].map((n) => (n.textContent || '').trim())`);

/** The frame is as tall as its content, up to the host's 320 px, and nothing spills sideways. */
const fits = async ({ check }, p, tag) => {
  await p.settle(200);
  const { frame, scroll, client } = await p.guest(`
    const f = doc.querySelector('.ws-frame').getBoundingClientRect();
    const root = doc.documentElement;
    return { frame: Math.ceil(f.height), scroll: root.scrollWidth, client: root.clientWidth };`);
  const host = parseInt(await p.host("document.getElementById('g').style.height"), 10);
  check(host === Math.min(320, Math.max(24, frame)), `${tag}: the frame asks for its content height (${frame}px, host sized it to ${host}px)`);
  check(scroll <= client, `${tag}: nothing overflows sideways (${scroll} of ${client}px)`);
};

const stateShot = async (helpers, state, width, theme) => {
  const { openPage, check } = helpers;
  const tag = `ws-${state.id}-${width}-${theme}`;
  const p = await openPage({ width, height: 380, surface: 'status', theme, label: tag, routes: state.routes });
  console.log(tag);
  await p.waitFor(state.ready, `the ${state.id} state`);
  await p.settle(250);
  const background = await p.guest('return getComputedStyle(doc.body).backgroundColor');
  check(background === BACKGROUND[theme], `${tag}: the section sits on the host's panel colour (${background})`);

  if (state.id === 'loading') {
    check((await p.guest('return doc.querySelector(".ws-loading [aria-label], .ws-loading")?.textContent ?? ""')).includes('Loading designs'), `${tag}: says "Loading designs"`);
    check((await p.guest('return doc.querySelectorAll(".ws-row").length')) === 0, `${tag}: no rows yet`);
  }
  if (state.id === 'list-a') {
    const metas = await text(p, '.ws-meta');
    check(metas[0] === 'Writing pricing.html · 3 issues · 2 open comments', `${tag}: the linked design reads "${metas[0]}"`);
    check(metas[1] === 'Agent is working · No issues', `${tag}: working reads "${metas[1]}"`);
    check(metas[2] === 'Agent stopped · 1 issue', `${tag}: failed reads "${metas[2]}"`);
    check(metas[3] === 'Waiting for agent', `${tag}: no first file reads "${metas[3]}"`);
    check(metas[4] === 'No issues', `${tag}: a pass reads "${metas[4]}"`);
    const tones = await p.guest('return [...doc.querySelectorAll(".ws-row")].map((n) => n.dataset.tone).join(",")');
    check(tones === 'info,info,error,warning,success', `${tag}: the dots carry info, info, error, warning, success (${tones})`);
    check((await text(p, '.ws-more'))[0] === 'Show all 12 designs', `${tag}: offers "Show all 12 designs"`);
    const title = await p.guest('const t = doc.querySelectorAll(".ws-title")[3]; return { clipped: t.scrollWidth > t.clientWidth, full: t.title }');
    check(title.clipped && title.full.startsWith('Habit tracker explorations'), `${tag}: a long title clips and keeps its full text as the tooltip`);
    const named = await p.guest('return doc.querySelectorAll(".ws-title")[0].title');
    check(named === 'Pricing page\nChecks: 3 issues', `${tag}: hovering the name also shows the checks sentence`);
    const disabled = await p.guest('return [...doc.querySelectorAll(".ws-row")].map((r) => r.querySelector("button").disabled).join(",")');
    check(disabled === 'false,false,false,true,false', `${tag}: Check is off only where there is no file yet (${disabled})`);
    check((await p.guest('return doc.querySelectorAll(".ws-row")[3].querySelector("button").title')) === 'There is nothing to check until the agent writes the first file.', `${tag}: the off Check says why`);
  }
  if (state.id === 'list-b') {
    const metas = await text(p, '.ws-meta');
    check(metas[0] === 'No issues' && metas[1] === 'No issues', `${tag}: stale and never-checked passes read "No issues"`);
    const tones = await p.guest('return [...doc.querySelectorAll(".ws-row")].map((n) => n.dataset.tone).join(",")');
    check(tones === 'muted,muted,success,muted,success', `${tag}: unverified passes are muted, verified ones green (${tones})`);
    check((await p.guest('return doc.querySelectorAll(".ws-row")[2].querySelector("button").title')) === 'Checks need Chrome, Edge or Chromium.', `${tag}: no browser says so on Check`);
    check((await p.guest('return doc.querySelectorAll(".ws-row")[3].querySelector(".ws-meta").hidden')) === true, `${tag}: a row with nothing to say has no empty line`);
    check((await p.guest('return doc.querySelectorAll(".ws-row")[0].title')).includes('before your latest changes'), `${tag}: the row's tooltip is the badge's sentence`);
    check(await p.guest('return doc.querySelector(".ws-more").hidden'), `${tag}: no "Show all" when every design is listed`);
  }
  if (state.id === 'list-c') {
    check((await p.guest('const b = doc.querySelectorAll(".ws-row")[0].querySelector("button"); return b.disabled && b.dataset.loading === "true"')), `${tag}: the running design's Check shows progress`);
    check((await p.guest('return doc.querySelectorAll(".ws-row")[1].querySelector("button").title')) === 'Another design is being checked. Try again when it finishes.', `${tag}: the other Check says why it waits`);
    const tones = await p.guest('return [...doc.querySelectorAll(".ws-row")].map((n) => n.dataset.tone).join(",")');
    check(tones === 'muted,muted,success', `${tag}: a never-checked design stays muted while another is checked, not a green pass (${tones})`);
    check((await p.guest('return doc.querySelectorAll(".ws-row")[2].querySelector("button").title')) === 'Another design is being checked. Try again when it finishes.', `${tag}: a pass reads the same reason when the running design is not a row here`);
  }
  if (state.id === 'empty-project') {
    check((await text(p, '.ws-empty'))[0] === 'No designs for this project yet. Ask the agent for one, or type /design.', `${tag}: empty says what to do`);
  }
  if (state.id === 'error') {
    check((await text(p, '.ws-notice-text'))[0] === 'Couldn’t load your designs. The local service didn’t answer.', `${tag}: a failed read says what happened`);
    check((await p.guest('return doc.querySelector(".ws-notice .oc-sdk-btn")?.textContent?.trim()')) === 'Try again', `${tag}: and offers Try again`);
    // Try again reads the service once more, which still fails here: the notice stays and the button works.
    await p.click('.ws-notice .oc-sdk-btn');
    await p.settle(150);
    check(await p.guest('return !doc.querySelector(".ws-notice").hidden'), `${tag}: Try again leaves the notice up while the service still fails`);
  }
  await fits(helpers, p, tag);
  await p.shot(tag);
  await p.close();
};

// No project open: OpenChamber sends a ready snapshot with no directory, and the empty sentence changes.
const noProject = async ({ openPage, check }, width, theme) => {
  const tag = `ws-empty-no-project-${width}-${theme}`;
  const p = await openPage({ width, height: 380, surface: 'status', theme, label: tag, routes: { 'GET /status/designs': ok({ rows: [], total: 0 }) } });
  console.log(tag);
  await p.waitFor('return !!doc.querySelector(".ws-empty") && !doc.querySelector(".ws-empty").hidden', 'the empty state');
  await p.host('send({ type: "ready", payload: { ...ready(), directory: null } })');
  await p.waitFor('return doc.querySelector(".ws-empty")?.textContent.includes("last 7 days")', 'the no-project sentence');
  check((await text(p, '.ws-empty'))[0] === 'No designs in the last 7 days. Ask the agent for one, or type /design.', `${tag}: says "last 7 days" without a project`);
  await p.settle(250);
  await p.shot(tag);
  await p.close();
};

// A chat opened without a project is in its own folder under OpenChamber's config, which is not a registered
// project (the host's listProjects knows only ember-oak). The fake service drops designs whose project differs
// from a `directory` it is sent, so rows appearing here prove the frame left the folder out of the query.
const chatFolder = async ({ openPage, check }, width, theme) => {
  const tag = `ws-chat-folder-${width}-${theme}`;
  const p = await openPage({ width, height: 380, surface: 'status', theme, label: tag, query: '&session=ses_coffee' });
  console.log(tag);
  await p.waitFor('return doc.querySelectorAll(".ws-row").length >= 5', 'the rows for the project');
  await p.host('send({ type: "ready", payload: { ...ready(), directory: "/home/sam/.config/openchamber/chats/2026-11-10/session-0a1b2c3d" } })');
  await p.waitFor('return doc.querySelectorAll(".ws-row").length >= 5', 'the rows for a chat with no project');
  check((await p.guest('return doc.querySelector(".ws-row").dataset.here')) === 'true', `${tag}: this chat's design still comes first`);
  await p.settle(250);
  await p.shot(tag);
  // Back to a registered project: the filter applies again, so the ember-oak designs are still all there.
  await p.host('send({ type: "ready", payload: { ...ready() } })');
  await p.waitFor('return doc.querySelectorAll(".ws-row").length >= 5', 'the rows for the project again');
  await p.close();
};

const onFakeService = async (helpers, width, theme) => {
  const { openPage, check } = helpers;
  const tag = `ws-live-${width}-${theme}`;
  const p = await openPage({ width, height: 380, surface: 'status', theme, label: tag, query: '&session=ses_coffee' });
  console.log(tag);
  await p.waitFor('return doc.querySelectorAll(".ws-row").length >= 5', 'the fake service rows');
  const slugs = await p.guest('return [...doc.querySelectorAll(".ws-row")].map((r) => r.dataset.slug)');
  check(slugs[0] === 'coffee-subscription' && (await p.guest('return doc.querySelector(".ws-row").dataset.here')) === 'true', `${tag}: this chat's design comes first (${slugs[0]})`);
  check((await text(p, '.ws-more'))[0] === 'Show all 6 designs', `${tag}: five of six rows, then "Show all 6 designs"`);

  // Tab order: row by row, Check then Open.
  const order = await p.guest('return [...doc.querySelectorAll(".ws-row button, .ws-more button")].map((b) => b.getAttribute("aria-label") ?? b.textContent.trim())');
  const titles = await text(p, '.ws-title');
  const expected = titles.flatMap((title) => [`Check ${title}`, `Open ${title}`]);
  check(order.slice(0, -1).join('|') === expected.join('|'), `${tag}: focus goes Check then Open, row by row (${order.slice(0, 4).join(' | ')} ...)`);
  check(order.at(-1) === 'Show all 6 designs', `${tag}: the footer link comes last`);

  // Check: the line says "Checking" at once, then the result; a second press cannot double up.
  await p.guest('win.__dcFake.checks.setRunMs(1600)');
  const northwind = '.ws-row[data-slug="northwind-pricing"]';
  const metaOf = (slug) => p.guest(`return doc.querySelector('.ws-row[data-slug="${slug}"] .ws-meta')?.textContent.trim() ?? ''`);
  check((await metaOf('northwind-pricing')).includes('No issues'), `${tag}: Northwind passes before the check`);
  await p.click(`${northwind} button`, { text: 'Check' });
  await p.waitFor(`return doc.querySelector('${northwind} .ws-meta')?.textContent.includes('Checking')`, 'the row to say Checking', 1500);
  check(await p.guest(`const b = doc.querySelector('${northwind} button'); return b.disabled && b.dataset.loading === 'true'`), `${tag}: Check shows progress and is off while it runs`);
  check(await p.guest(`const b = doc.querySelector('.ws-row[data-slug="coffee-subscription"] button'); return b.dataset.loading !== 'true'`), `${tag}: only the design being checked shows progress`);
  // Once the frame reloads after the press, the other rows' Check is off because a run is under way (QA: was a race).
  await p.waitFor(`const b = doc.querySelector('.ws-row[data-slug="coffee-subscription"] button'); return b.disabled`, 'other rows to wait for the run', 3000).catch(() => undefined);
  check(await p.guest(`return doc.querySelector('.ws-row[data-slug="coffee-subscription"] button').disabled`), `${tag}: another row's Check waits while a design is being checked`);
  await p.shot(`${tag}-checking`);
  await p.waitFor(`return !doc.querySelector('${northwind} .ws-meta')?.textContent.includes('Checking')`, 'the check to finish', 6000);
  check((await metaOf('northwind-pricing')).includes('No issues'), `${tag}: the line shows the result after the run ("${await metaOf('northwind-pricing')}")`);
  check(await p.guest(`return !doc.querySelector('${northwind} button').disabled`), `${tag}: Check is back when it ends`);

  // A press that loses the race: the service says 409 and the toast says what to do.
  await p.route('POST /designs/:slug/checks/run', { status: 409, body: { error: 'conflict', message: 'Another design is being checked. Try again in a moment.' } });
  await p.click(`.ws-row[data-slug="coffee-subscription"] button`, { text: 'Check' });
  await p.settle(250);
  check((await p.host('window.__host.toasts.map((t) => t.message)')).includes('Another design is being checked. Try again when it finishes.'), `${tag}: a 409 toasts "Another design is being checked. Try again when it finishes."`);
  await p.route('POST /designs/:slug/checks/run', null);

  // Open: the request, then the rail. A deleted design and a host with no rail say so.
  await p.click(`.ws-row[data-slug="coffee-subscription"] button`, { text: 'Open' });
  await p.settle(250);
  check((await p.host('JSON.stringify(window.__host.surfacesOpened)')) === '["plugin:design-chamber"]', `${tag}: Open opens the Design Chamber rail`);
  await p.route('POST /open-request', { status: 404, body: { error: 'not-found', message: 'That design is no longer in your Designs folder.' } });
  await p.click(`.ws-row[data-slug="coffee-subscription"] button`, { text: 'Open' });
  await p.settle(250);
  check((await p.host('window.__host.toasts.map((t) => t.message)')).includes('That design was deleted.'), `${tag}: Open on a deleted design toasts "That design was deleted."`);
  check((await p.host('window.__host.surfacesOpened.length')) === 1, `${tag}: and does not open the rail`);
  await p.route('POST /open-request', null);
  await p.host('window.__host.openSurfaceFails = "NO_DIRECTORY"');
  await p.click(`.ws-row[data-slug="coffee-subscription"] button`, { text: 'Open' });
  await p.settle(250);
  check((await p.host('window.__host.toasts.map((t) => t.message)')).includes('Open Design Chamber from the rail to see it.'), `${tag}: no rail here toasts "Open Design Chamber from the rail to see it."`);
  await p.host('window.__host.openSurfaceFails = null');
  const opened = await p.host('window.__host.surfacesOpened.length');
  // The harness's toasts sit over the bottom right of the page for 4 s; clear them so the click lands on the frame.
  await p.host("document.getElementById('toasts').replaceChildren()");
  await p.click('.ws-more button');
  await p.settle(200);
  check((await p.host('window.__host.surfacesOpened.length')) === opened + 1, `${tag}: "Show all" opens the rail list (${opened} opens before, then one more)`);

  // Live: the agent writes the first file of a waiting design and its line changes without a reload.
  const waiting = await metaOf('onboarding-flow');
  check(waiting === 'Waiting for agent', `${tag}: a design with no file yet reads "${waiting}"`);
  await p.guest('win.__dcFake.writePending()');
  await p.waitFor(`return doc.querySelector('.ws-row[data-slug="onboarding-flow"] .ws-meta')?.textContent.trim() !== 'Waiting for agent'`, 'the waiting line to update', 3000);
  check((await metaOf('onboarding-flow')) !== 'Waiting for agent', `${tag}: the change feed updates the line ("${await metaOf('onboarding-flow')}")`);

  // A theme switch repaints live from the new tokens.
  const before = await p.guest('return getComputedStyle(doc.body).backgroundColor');
  await p.host(`window.__host.setTheme(${JSON.stringify(theme === 'dark' ? 'light' : 'dark')})`);
  await p.waitFor(`return getComputedStyle(doc.body).backgroundColor !== ${JSON.stringify(before)}`, 'the new theme');
  check((await p.guest('return getComputedStyle(doc.body).backgroundColor')) === BACKGROUND[theme === 'dark' ? 'light' : 'dark'], `${tag}: a theme switch repaints from the new host tokens`);
  await p.shot(`${tag}-switched`);
  await p.close();
};
