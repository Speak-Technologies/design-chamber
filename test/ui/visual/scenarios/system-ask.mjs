// Visual scenario for the SystemAsk chat block (phase-2-5-technical.md §8.12, U8): round one, round
// two, the diff (a long list that scrolls with the footer pinned, Decline and its exits, Stop and
// Undo), the answered and read-only states, and an answer the host refuses. Rail widths 320 and 480
// and the page width, light and dark. `helpers` is what the other scenarios use: openPage, check.

const TICKET = 'sb_abcdefghij12';
const PROPOSAL = 'p_k3m9x2ab';
const SYSTEM = 'tidepool';

const ROUND_ONE = { name: 'SystemAsk', args: { kind: 'interview-1', ticket: TICKET, systemId: '', proposalId: '', calls: '' } };
const roundTwo = (calls) => ({ name: 'SystemAsk', args: { kind: 'interview-2', ticket: '', systemId: SYSTEM, proposalId: '', calls: JSON.stringify(calls) } });
const DIFF = { name: 'SystemAsk', args: { kind: 'diff', ticket: '', systemId: SYSTEM, proposalId: PROPOSAL, calls: '' } };
const withAnswer = (block, answered) => ({ ...block, answered });
/** What `GET /systems/:id` answers a round-two card: the service's name and the round its build is in. */
const SYSTEM_READ = (round) => ({ 'GET /systems/:id': { body: { name: 'Tidepool', build: round === null ? null : { round } } } });
const TWO_LIVE = SYSTEM_READ(2);
const POLL_WAIT = 6500;

const CALLS = [
  { topic: 'status-colours', why: 'About 700 uses across 40 files; amber in 12, orange in 8, three reds.', proposed: 'warning #b45309, danger #b91c1c, success #15803d' },
  { topic: 'greys', why: 'Seven greys with no steps between them.', proposed: 'A five step ramp from the lightest to the darkest in use' },
  { topic: 'typography', why: 'Two families, nine sizes.', proposed: '' },
];

const PATCH = ['@@ -12,7 +12,9 @@', ' :root {', '-  --warning: #d97706;', '+  --warning: #b45309;', '+  --warning-surface: #fef3c7;', '   --danger: #dc2626;', ' }'].join('\n');
const file = (path, change, extra = {}) => ({ path, change, summary: '', added: change === 'delete' ? 0 : 12, removed: change === 'create' ? 0 : 3, patch: PATCH, patchOmitted: false, from: null, bytes: null, usages: null, ...extra });
const MANY = Array.from({ length: 14 }, (_, i) => file(`src/styles/tokens/group-${i + 1}.css`, i % 3 === 0 ? 'create' : 'modify'));

const proposal = (over = {}) => ({
  state: 'current',
  sha16: '0123456789abcdef',
  preview: { board: true, livingPage: 'ready', sentence: null },
  proposal: {
    id: PROPOSAL,
    supersedes: null,
    created: '2026-11-20T09:00:00.000Z',
    mode: 'fix',
    summary: 'Adds the system files, tunes the status colours and writes a living page.',
    parts: [
      { name: 'system-files', files: [file('design-system/DESIGN.md', 'create'), file('design-system/tokens.css', 'create'), ...MANY] },
      { name: 'token-fixes', files: [file('src/styles/tokens.css', 'modify', { usages: { count: 214, listed: false } }), file('src/old/legacy.css', 'delete')] },
      { name: 'docs', files: [file('docs/design-system.md', 'create')] },
      { name: 'living-page', files: [file('design-system/index.html', 'create', { patch: null, patchOmitted: true })] },
    ],
    wayBack: { kind: 'commit', name: 'abc1234', text: 'git reset --hard abc1234 puts the code back as it was.' },
    access: 'dev',
    home: { kind: 'repo', directory: '/home/sam/code/tidepool', label: 'tidepool-web', folder: 'design-system', livingPage: 'design-system/index.html', readable: true, problem: null, lastRead: null },
    problems: [],
    ...over,
  },
});
const SMALL = proposal({ parts: [{ name: 'system-files', files: [file('design-system/DESIGN.md', 'create')] }], summary: 'Adds the system files.' });

export const run = async (helpers) => {
  for (const theme of ['dark', 'light']) {
    for (const width of [320, 480, 640]) {
      await rounds(helpers, width, theme);
      await diff(helpers, width, theme);
    }
  }
  await refusal(helpers);
};

const root = (p) => p.guest('return Math.ceil(doc.getElementById("root").getBoundingClientRect().height)');
const fits = (p) => p.guest('return doc.documentElement.scrollWidth <= win.innerWidth');
const answers = async (p) => JSON.parse(await p.host('JSON.stringify(window.__host.blockAnswers)'));

const rounds = async ({ openPage, check }, width, theme) => {
  const base = `system-ask-rounds-${width}-${theme}`;
  const open = (label, block, routes = null) => openPage({ width, height: 1100, surface: 'block', theme, label: `${base}-${label}`, block, routes });
  console.log(base);

  // ---- round one: the defaults, bold, and Go with these
  let p = await open('one', ROUND_ONE);
  await p.waitFor('return !!doc.querySelector(".dcb-q") && !doc.querySelector(".dcb-ask-loading")', 'round one');
  check((await p.guest('return doc.querySelector(".dcb-ask-title")?.textContent')) === 'Before I read the code', `${base}: round one title`);
  check((await p.guest('return doc.querySelector(".dcb-ask-sub")?.textContent')) === 'Round 1 of 2', `${base}: round one subtitle`);
  const asked = await p.guest('return [...doc.querySelectorAll(".dcb-q-label")].map((n) => n.textContent).join(" | ")');
  check((await p.guest('return doc.querySelectorAll(".dcb-q").length')) === 5 && asked.includes('How complete should it be?'), `${base}: five questions (${asked})`);
  const picked = await p.guest('return [...doc.querySelectorAll(".dcb-opt-input:checked")].map((n) => n.value).join(",")');
  check(picked === 'repo,fix,foundations,components,patterns,brand,core,not-now', `${base}: the recommended options are pre-selected (${picked})`);
  check((await p.guest('return getComputedStyle(doc.querySelector(".dcb-opt-name[data-recommended]")).fontWeight')) >= '600', `${base}: the recommended option is bold`);
  check(await fits(p), `${base}: nothing wider than the column`);
  await p.settle(200);
  await p.shot(`${base}-1-one`);
  await p.host('window.__host.blockClick = true');
  await p.click('.dcb-ask-foot button', { text: 'Go with these' });
  await p.waitFor('return !!doc.querySelector(".dcb-ask-done")', 'round one answered');
  const one = await answers(p);
  check(one.length === 1 && one[0].includes('Product core') && one[0].includes('depth=core'), `${base}: the answer says how complete (${one[0]})`);
  check(one.length === 1 && one[0].includes(TICKET) && one[0].length <= 2000, `${base}: Go with these sends one answer with the marker (${one[0]?.slice(0, 60)})`);
  await p.settle(150);
  await p.shot(`${base}-2-one-answered`);
  await p.close();

  // ---- round one, no project folder: home and mode are not asked
  p = await open('one-no-project', ROUND_ONE, { 'GET /system-builds/:ticket': { body: { state: 'waiting', project: null } } });
  await p.waitFor('return !!doc.querySelector(".dcb-ask-fact")', 'the no project line');
  check((await p.guest('return doc.querySelector(".dcb-ask-fact")?.textContent')) === 'No project folder is open in this chat, so the system will live in Design Chamber and your code stays untouched.', `${base}: no project says so`);
  check((await p.guest('return [...doc.querySelectorAll(".dcb-opt-input")].every((n) => !["repo", "internal", "fix", "describe"].includes(n.value)) && doc.querySelectorAll(".dcb-q").length === 3')), `${base}: home and mode are hidden`);
  await p.shot(`${base}-3-one-no-project`);
  await p.close();

  // ---- round one, ticket already used and expired
  p = await open('one-made', ROUND_ONE, { 'GET /system-builds/:ticket': { body: { state: 'made', id: SYSTEM, name: 'Tidepool' } } });
  await p.waitFor('return !!doc.querySelector(".dcb-ask-banner")', 'the read-only banner');
  check(!(await p.guest('return !!doc.querySelector(".dcb-ask-foot button")')), `${base}: a used ticket has no buttons`);
  await p.shot(`${base}-4-one-made`);
  await p.close();
  p = await open('one-expired', ROUND_ONE, { 'GET /system-builds/:ticket': { body: { state: 'expired' } } });
  await p.waitFor('return !!doc.querySelector(".dcb-ask-banner")', 'the expired banner');
  await p.shot(`${base}-5-one-expired`);
  await p.close();

  // ---- the service is not running, then Try again
  p = await open('one-down', ROUND_ONE, { 'GET /system-builds/:ticket': { throws: 'down' } });
  await p.waitFor('return !!doc.querySelector(".dcb-ask-banner button")', 'the down banner');
  await p.shot(`${base}-6-one-down`);
  await p.route('GET /system-builds/:ticket', null);
  await p.click('.dcb-ask-banner button', { text: 'Try again' });
  await p.waitFor('return !!doc.querySelector(".dcb-q")', 'the form after Try again');
  check(true, `${base}: Try again loads the question`);
  await p.close();

  // ---- round two: calls with the agent's reason, one dropped
  p = await open('two', roundTwo(CALLS), TWO_LIVE);
  await p.waitFor('return !!doc.querySelector(".dcb-q")', 'round two');
  check((await p.guest('return doc.querySelector(".dcb-ask-title")?.textContent')) === 'A few calls from the code' && (await p.guest('return doc.querySelector(".dcb-ask-sub")?.textContent')) === 'Tidepool · Round 2 of 2', `${base}: round two titles name the system the service gave`);
  check((await p.guest('return doc.querySelectorAll(".dcb-q").length')) === 3, `${base}: three calls`);
  check((await p.guest('return doc.querySelector(".dcb-q-agent")?.textContent.startsWith("From the agent: ")')), `${base}: the agent's reason is labelled`);
  check(await fits(p), `${base}: round two fits the column`);
  await p.shot(`${base}-7-two`);
  await p.click('.dcb-opt', { text: 'Custom' });
  check((await p.guest('return [...doc.querySelectorAll(".dcb-q-custom")].some((n) => !n.hidden && n.textContent.includes("Say what you want in the note below."))')), `${base}: Custom points to the note`);
  await p.shot(`${base}-7b-two-custom`);
  await p.click('.dcb-opt', { text: 'Keep the stock set' });
  await p.host('window.__host.blockClick = true');
  await p.click('.dcb-ask-foot button', { text: 'Go with these' });
  await p.waitFor('return !!doc.querySelector(".dcb-ask-done")', 'round two answered');
  const two = await answers(p);
  check(two.length === 1 && two[0].includes(SYSTEM), `${base}: round two sends one answer (${two[0]?.slice(0, 60)})`);
  await p.shot(`${base}-8-two-answered`);
  await p.close();

  // ---- round two replayed from an answer, and an answer we do not recognise
  p = await open('two-replayed', withAnswer(roundTwo(CALLS), 'Go with these. Status colours: Keep the stock set.'));
  await p.waitFor('return !!doc.querySelector(".dcb-ask-done")', 'the replayed answer');
  check(!(await p.guest('return !!doc.querySelector(".dcb-ask-foot")')), `${base}: an answered block has no footer`);
  await p.shot(`${base}-9-two-replayed`);
  await p.close();
  p = await open('two-dropped', roundTwo([...CALLS.slice(0, 1), { topic: 'nope-not-a-topic', why: 'x', proposed: 'y' }]), TWO_LIVE);
  await p.waitFor('return !!doc.querySelector(".dcb-q")', 'the one call that can be shown');
  await p.shot(`${base}-10-two-dropped`);
  await p.close();

  // ---- round two reads the system: a build that moved on, and a system that is gone, are read-only
  p = await open('two-stale', roundTwo(CALLS), SYSTEM_READ('done'));
  await p.waitFor('return !!doc.querySelector(".dcb-ask-banner")', 'the out of date banner');
  check(!(await p.guest('return !!doc.querySelector(".dcb-ask-foot button, .dcb-q")')), `${base}: a round-two card whose build moved on has no questions and no buttons`);
  check((await p.guest('return doc.querySelector(".dcb-ask-sub")?.textContent')) === 'Tidepool · Round 2 of 2', `${base}: and still names the system`);
  await p.shot(`${base}-12-two-stale`);
  await p.close();
  p = await open('two-gone', roundTwo(CALLS), { 'GET /systems/:id': { status: 404, body: { error: 'not-found', message: 'That design system is not in your list any more.' } } });
  await p.waitFor('return !!doc.querySelector(".dcb-ask-banner")', 'the gone banner');
  check((await p.guest('return doc.querySelector(".dcb-ask-banner")?.textContent ?? ""')).includes('no longer in your Designs folder'), `${base}: a system that is gone says so`);
  check(!(await p.guest('return !!doc.querySelector(".dcb-ask-foot button, .dcb-q")')), `${base}: and has nothing to press`);
  await p.shot(`${base}-13-two-gone`);
  await p.close();
  p = await open('two-down', roundTwo(CALLS), { 'GET /systems/:id': { throws: 'down' } });
  await p.waitFor('return !!doc.querySelector(".dcb-ask-banner button")', 'the down banner');
  await p.route('GET /systems/:id', TWO_LIVE['GET /systems/:id']);
  await p.click('.dcb-ask-banner button', { text: 'Try again' });
  await p.waitFor('return !!doc.querySelector(".dcb-q")', 'the form after Try again');
  check(true, `${base}: round two Try again loads the question`);
  await p.close();

  // ---- a poll that fails keeps the picks; one that finds the build done turns the form read-only (slow: waits for the poll)
  if (width === 480 && theme === 'dark') {
    p = await open('two-poll', roundTwo(CALLS), TWO_LIVE);
    await p.waitFor('return !!doc.querySelector(".dcb-q")', 'round two');
    await p.click('.dcb-opt', { text: 'Custom' });
    await p.route('GET /systems/:id', { throws: 'down' });
    await p.settle(POLL_WAIT);
    check(await p.guest('return !!doc.querySelector(".dcb-q") && [...doc.querySelectorAll(".dcb-opt-input:checked")].some((n) => n.value === "custom")'), `${base}: a failed read keeps the form and the pick`);
    await p.route('GET /systems/:id', SYSTEM_READ('done')['GET /systems/:id']);
    // The failed read doubled the wait (the block asks less while the service is down), so this one takes longer.
    await p.settle(POLL_WAIT * 2);
    check(!(await p.guest('return !!doc.querySelector(".dcb-q, .dcb-ask-foot button")')) && (await p.guest('return !!doc.querySelector(".dcb-ask-banner")')), `${base}: a read that finds the build done turns the card read-only`);
    await p.close();
  }

  // ---- a block the arguments do not make sense of
  p = await open('bad', { name: 'SystemAsk', args: { kind: 'bogus' } });
  await p.waitFor('return !!doc.querySelector(".dcb-notice")', 'the bad block notice');
  check((await p.guest('return doc.querySelector(".dcb-notice-text")?.textContent')) === 'This question couldn’t be read. Answer in the chat instead.', `${base}: a bad block says so`);
  await p.shot(`${base}-11-bad`);
  await p.close();
};

const diff = async ({ openPage, check }, width, theme) => {
  const base = `system-ask-diff-${width}-${theme}`;
  const routesFor = (view, extra = {}) => ({ 'GET /systems/:id/proposals/:proposalId': { body: view }, ...extra });
  const open = (label, block, routes) => openPage({ width, height: 1100, surface: 'block', theme, label: `${base}-${label}`, block, routes });
  const ready = (p) => p.waitFor('return !!doc.querySelector(".dcb-part")', 'the proposal');
  console.log(base);

  // ---- loading
  let p = await open('loading', DIFF, routesFor(proposal(), { 'GET /systems/:id/proposals/:proposalId': { delayMs: 60_000, body: {} } }));
  await p.waitFor('return !!doc.querySelector(".dcb-ask-loading")', 'the loading line');
  check((await p.guest('return doc.querySelector(".dcb-ask-loading")?.textContent')) === 'Loading the proposal…', `${base}: loading says so`);
  await p.shot(`${base}-1-loading`);
  await p.close();

  // ---- a long proposal: the body scrolls, the footer stays
  p = await open('long', DIFF, routesFor(proposal()));
  await ready(p);
  check((await p.guest('return doc.querySelector(".dcb-ask-sub")?.textContent')).length > 0, `${base}: the header names the system`);
  check((await p.guest('return doc.querySelector(".dcb-ask-title")?.textContent')).startsWith('Proposed changes to'), `${base}: the title says what changes`);
  check((await p.guest('return doc.querySelectorAll(".dcb-part-switch").length')) === 4, `${base}: four parts, a switch each`);
  check(await fits(p), `${base}: nothing wider than the column`);
  const tall = await root(p);
  check(tall <= 960, `${base}: the block stays within 960 px (${tall})`);
  const scrolls = await p.guest('const b = doc.querySelector(".dcb-ask-body"); return b.scrollHeight > b.clientHeight');
  check(scrolls || tall < 960, `${base}: a body taller than the cap scrolls inside the frame`);
  await p.shot(`${base}-2-long`);
  await p.guest('doc.querySelector(".dcb-ask-body").scrollTop = 99999');
  await p.settle(150);
  const pinned = await p.guest('const f = doc.querySelector(".dcb-ask-foot").getBoundingClientRect(); return f.bottom <= win.innerHeight + 1 && f.top >= 0');
  check(pinned, `${base}: the footer is still on screen after scrolling`);
  await p.shot(`${base}-3-scrolled`);
  await p.guest('doc.querySelector(".dcb-ask-body").scrollTop = 0');

  // ---- the preview buttons leave an open request for the system and open the rail (not just a toast)
  const hostState = (expr) => p.host(`JSON.stringify(${expr})`).then((raw) => JSON.parse(raw));
  const openedBefore = (await hostState('window.__host.surfacesOpened')).length;
  await p.click('.dcb-preview-row button', { text: 'Preview living page' });
  await p.settle(300);
  check((await hostState('window.__host.surfacesOpened')).length === openedBefore + 1, `${base}: Preview living page opens the rail`);
  check((await hostState('window.__host.toasts.map((t) => t.message)')).some((m) => m === 'The living page preview is open in the rail.'), `${base}: and says the preview is open there`);
  await p.click('.dcb-preview-row button', { text: 'Open the board' });
  await p.settle(300);
  check((await hostState('window.__host.toasts.map((t) => t.message)')).some((m) => m === 'The board is open in the rail.'), `${base}: Open the board says the board is open`);

  // ---- a patch opens; a part switched off changes Approve
  await p.click('.dcb-file', { nth: 0 });
  check((await p.guest('return doc.querySelector(".dcb-file")?.getAttribute("aria-expanded")')) === 'true', `${base}: a file row opens its patch`);
  check((await p.guest('return doc.querySelector(".dcb-patch-code")?.textContent.includes("--warning")')), `${base}: the patch is text in a pre`);
  await p.shot(`${base}-4-patch`);
  check((await p.guest('return [...doc.querySelectorAll(".dcb-ask-foot button")].map((b) => b.textContent.trim()).join("|")')) === 'Decline|Approve all 4 parts', `${base}: the footer says Approve all 4 parts`);
  await p.click('.dcb-part-switch [role=switch], .dcb-part-switch input', { nth: 3 });
  await p.settle(150);
  check((await p.guest('return [...doc.querySelectorAll(".dcb-ask-foot button")].map((b) => b.textContent.trim()).join("|")')) === 'Decline|Approve 3 of 4 parts', `${base}: switching a part off says 3 of 4`);
  await p.shot(`${base}-5-three-of-four`);
  await p.host('window.__host.blockClick = true');
  await p.click('.dcb-ask-foot button', { text: 'Approve 3 of 4 parts' });
  await p.waitFor('return !!doc.querySelector(".dcb-ask-done")', 'approved');
  const sent = await answers(p);
  check(sent.length === 1 && sent[0].includes(PROPOSAL) && sent[0].length <= 2000, `${base}: Approve sends one answer with the proposal (${sent[0]?.slice(0, 70)})`);
  await p.shot(`${base}-6-approved`);
  await p.close();

  // ---- all parts off: Approve says why
  p = await open('none-on', DIFF, routesFor(SMALL));
  await ready(p);
  await p.click('.dcb-part-switch [role=switch], .dcb-part-switch input', { nth: 0 });
  await p.settle(150);
  check(await p.guest('return doc.querySelector(".dcb-ask-foot button[data-emphasis=primary]")?.disabled === true'), `${base}: with every part off Approve is disabled`);
  check((await p.guest('return doc.querySelector(".dcb-ask-reason")?.textContent ?? ""')).length > 0, `${base}: and says why`);
  await p.shot(`${base}-7-none-on`);
  await p.close();

  // ---- Decline and its exits
  p = await open('decline', DIFF, routesFor(SMALL, { 'POST /systems/:id/build/stop': { body: { undoId: 'u_abcd1234', until: new Date(Date.now() + 5 * 60_000).toISOString() } } }));
  await ready(p);
  await p.click('.dcb-ask-foot button', { text: 'Decline' });
  const exits = await p.guest('return [...doc.querySelectorAll(".dcb-ask-foot button")].map((b) => b.textContent.trim()).join("|")');
  check(exits === 'Describe only instead|Stop|Back', `${base}: Decline offers Describe only instead, Stop and Back (${exits})`);
  await p.shot(`${base}-8-decline`);
  await p.click('.dcb-ask-foot button', { text: 'Back' });
  check((await p.guest('return doc.querySelector(".dcb-ask-foot button")?.textContent.trim()')) === 'Decline', `${base}: Back returns to Decline and Approve`);
  await p.click('.dcb-ask-foot button', { text: 'Decline' });
  await p.host('window.__host.blockClick = true');
  await p.click('.dcb-ask-foot button', { text: 'Stop' });
  await p.waitFor('return !!doc.querySelector(".dcb-ask-done")', 'stopped');
  check((await answers(p)).length === 1, `${base}: Stop sends one answer`);
  check(await p.guest('return [...doc.querySelectorAll(".dcb-ask-body button")].some((b) => b.textContent.trim() === "Undo")'), `${base}: Undo is offered after Stop`);
  await p.shot(`${base}-9-stopped`);
  await p.close();

  // ---- Undo after Stop: one request for two quick clicks, then the whole window
  p = await open('undo', DIFF, routesFor(SMALL, { 'POST /systems/:id/build/stop': { body: { undoId: 'u_abcd1234', until: new Date(Date.now() + 5 * 60_000).toISOString() } }, 'POST /system-stops/:undoId/undo': { delayMs: 900, body: { id: 'u_abcd1234' } } }));
  await ready(p);
  await p.click('.dcb-ask-foot button', { text: 'Decline' });
  await p.host('window.__host.blockClick = true');
  await p.click('.dcb-ask-foot button', { text: 'Stop' });
  await p.waitFor('return !!doc.querySelector(".dcb-ask-done")', 'stopped');
  await p.click('.dcb-ask-body button', { text: 'Undo' });
  await p.click('.dcb-ask-body button', { text: 'Undo' });
  check(await p.guest('return [...doc.querySelectorAll(".dcb-ask-body button")].find((b) => b.textContent.includes("Undo"))?.disabled === true'), `${base}: Undo is off while its request is out`);
  await p.settle(1200);
  check((await p.routeHits('POST /system-stops/:undoId/undo')) === 1, `${base}: two quick clicks on Undo send one request (${await p.routeHits('POST /system-stops/:undoId/undo')})`);
  check((await p.guest('return doc.querySelector(".dcb-ask-body")?.textContent ?? ""')).includes('Design Chamber brought the build back.'), `${base}: and the build comes back once`);
  check(!(await p.guest('return [...doc.querySelectorAll(".dcb-ask-body button")].some((b) => b.textContent.includes("Undo"))')), `${base}: Undo leaves once it has worked`);
  await p.shot(`${base}-9b-undone`);
  await p.close();
  p = await open('undo-fails', DIFF, routesFor(SMALL, { 'POST /systems/:id/build/stop': { body: { undoId: 'u_abcd1234', until: new Date(Date.now() + 5 * 60_000).toISOString() } }, 'POST /system-stops/:undoId/undo': { status: 409, body: { error: 'conflict', message: 'Too late.' } } }));
  await ready(p);
  await p.click('.dcb-ask-foot button', { text: 'Decline' });
  await p.host('window.__host.blockClick = true');
  await p.click('.dcb-ask-foot button', { text: 'Stop' });
  await p.waitFor('return !!doc.querySelector(".dcb-ask-done")', 'stopped');
  await p.click('.dcb-ask-body button', { text: 'Undo' });
  await p.settle(400);
  check(await p.guest('return [...doc.querySelectorAll(".dcb-ask-body button")].find((b) => b.textContent.includes("Undo"))?.disabled === false'), `${base}: a refused Undo can be tried again`);
  await p.close();
  p = await open('undo-expires', DIFF, routesFor(SMALL, { 'POST /systems/:id/build/stop': { body: { undoId: 'u_abcd1234', until: new Date(Date.now() + 2500).toISOString() } } }));
  await ready(p);
  await p.click('.dcb-ask-foot button', { text: 'Decline' });
  await p.host('window.__host.blockClick = true');
  await p.click('.dcb-ask-foot button', { text: 'Stop' });
  await p.waitFor('return !!doc.querySelector(".dcb-ask-done")', 'stopped');
  check(await p.guest('return [...doc.querySelectorAll(".dcb-ask-body button")].some((b) => b.textContent.includes("Undo"))'), `${base}: Undo is there inside its window`);
  await p.settle(3500);
  check(!(await p.guest('return [...doc.querySelectorAll(".dcb-ask-body button")].some((b) => b.textContent.includes("Undo"))')), `${base}: the button leaves when the window ends, with no other repaint`);
  await p.close();

  // ---- a proposal the service no longer has: Approve goes away with the proposal (slow: waits for the poll)
  if (width === 480 && theme === 'dark') {
    p = await open('vanishes', DIFF, routesFor(SMALL));
    await ready(p);
    check(await p.guest('return doc.querySelector(".dcb-ask-foot button[data-emphasis=primary]")?.disabled === false'), `${base}: Approve is live for a proposal that can be read`);
    await p.route('GET /systems/:id/proposals/:proposalId', { status: 404, body: { error: 'not-found', message: 'That proposal is gone.' } });
    await p.settle(POLL_WAIT);
    check(!(await p.guest('return !!doc.querySelector(".dcb-ask-foot button")')) && (await p.guest('return !!doc.querySelector(".dcb-ask-banner")')), `${base}: a proposal the service cannot find turns the card read-only, with no Approve`);
    check((await p.guest('return doc.querySelector(".dcb-ask-banner")?.textContent ?? ""')).includes('can’t find this proposal'), `${base}: and says so`);
    await p.shot(`${base}-14-vanished`);
    await p.close();
    p = await open('hiccup', DIFF, routesFor(SMALL));
    await ready(p);
    await p.route('GET /systems/:id/proposals/:proposalId', { throws: 'down' });
    await p.settle(POLL_WAIT);
    check(await p.guest('return doc.querySelector(".dcb-ask-foot button[data-emphasis=primary]")?.disabled === false'), `${base}: a service that stops answering does not take the proposal away`);
    await p.close();
  }

  // ---- Stop when the build moved on: a sentence, nothing sent
  p = await open('stop-409', DIFF, routesFor(SMALL, { 'POST /systems/:id/build/stop': { status: 409, body: { error: 'conflict', message: 'The agent has already moved on. Nothing was stopped.' } } }));
  await ready(p);
  await p.click('.dcb-ask-foot button', { text: 'Decline' });
  await p.host('window.__host.blockClick = true');
  await p.click('.dcb-ask-foot button', { text: 'Stop' });
  await p.waitFor('return !!doc.querySelector(".dcb-ask-problem")', 'the conflict sentence');
  check((await p.guest('return doc.querySelector(".dcb-ask-problem")?.textContent')) === 'The agent has already moved on. Nothing was stopped.', `${base}: a 409 shows its own sentence`);
  check((await answers(p)).length === 0, `${base}: and nothing is sent`);
  await p.shot(`${base}-10-stop-409`);
  await p.close();

  // ---- describe mode: no Describe only instead
  p = await open('describe-mode', DIFF, routesFor(proposal({ mode: 'describe' })));
  await ready(p);
  await p.click('.dcb-ask-foot button', { text: 'Decline' });
  check(!(await p.guest('return [...doc.querySelectorAll(".dcb-ask-foot button")].some((b) => b.textContent.trim() === "Describe only instead")')), `${base}: describe mode does not offer Describe only instead`);
  await p.close();

  // ---- read-only states
  const states = { superseded: { state: 'superseded', by: 'p_n3wer0001' }, rewritten: { state: 'rewritten' }, unknown: { state: 'unknown' }, unreadable: { state: 'unreadable', sentence: 'PROPOSAL.json isn’t valid JSON.' } };
  for (const [name, view] of Object.entries(states)) {
    p = await open(name, DIFF, routesFor(view));
    await p.waitFor('return !!doc.querySelector(".dcb-ask-banner")', `the ${name} sentence`);
    check(!(await p.guest('return !!doc.querySelector(".dcb-ask-foot button")')), `${base}: ${name} has no buttons`);
    await p.shot(`${base}-11-${name}`);
    await p.close();
  }

  // ---- the service is not running, then Try again
  p = await open('down', DIFF, routesFor(proposal(), { 'GET /systems/:id/proposals/:proposalId': { throws: 'down' } }));
  await p.waitFor('return !!doc.querySelector(".dcb-ask-banner button")', 'the down banner');
  await p.shot(`${base}-12-down`);
  await p.route('GET /systems/:id/proposals/:proposalId', { body: SMALL });
  await p.click('.dcb-ask-banner button', { text: 'Try again' });
  await ready(p);
  check(true, `${base}: Try again loads the proposal`);
  await p.close();

  // ---- the answer replayed
  p = await open('answered', withAnswer(DIFF, `Approved the proposal ${PROPOSAL} for ${SYSTEM}.`), routesFor(SMALL));
  await p.waitFor('return !!doc.querySelector(".dcb-ask-done")', 'the replayed answer');
  await p.shot(`${base}-13-answered`);
  await p.close();
};

/** The host takes no answer (no click activation): the choices stay and Copy my answer appears; a plain refusal keeps the form. */
const refusal = async ({ openPage, check }) => {
  const base = 'system-ask-refusal-360-dark';
  console.log(base);
  const routes = { 'GET /systems/:id/proposals/:proposalId': { body: SMALL } };
  let p = await openPage({ width: 360, height: 1100, surface: 'block', theme: 'dark', label: base, block: DIFF, routes });
  await p.waitFor('return !!doc.querySelector(".dcb-part")', 'the proposal');
  await p.click('.dcb-ask-foot button', { text: 'Approve' });
  await p.settle(300);
  const text = await p.guest('return doc.querySelector(".dcb-ask-foot")?.textContent ?? ""');
  check(text.includes('Couldn’t send your answer. Type it in the chat instead.') || text.includes('Reply in the chat to answer.'), `${base}: a refused answer says to type it (${text.slice(0, 80)})`);
  check(await p.guest('return !!doc.querySelector(".dcb-part")'), `${base}: the proposal stays on screen`);
  await p.shot(base);
  await p.close();
};
