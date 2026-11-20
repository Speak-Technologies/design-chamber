// Visual scenario for Phase 2.5 U7 (Build with the agent… and the build chip): the rail at 320 and 480 px and the page,
// light and dark. The header button and its popover (the words kept when the request doesn't reach a chat, Try again and
// Copy request), the list's home lines and badges at 360 px, and every state a `system-build:<ticket>` chip opens into:
// checking, waiting for the interview, made (the system itself), made then stopped, expired, the service not running
// and a poll that fails three times. `helpers`: openPage, check, checkSoon, listReady.

const FAKE = 'window.frames[0].__dcFake';
const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
const text = (p, selector) => p.guest(`return (doc.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
const toastTexts = (p) => p.host('JSON.stringify(window.__host.toasts.map((t) => t.message))');
const surfaceName = (surface) => (surface === 'panel' ? 'rail' : 'page');
const TICKET = 'sb_000000000001';
const CHIP = { providerId: 'design-chamber', id: `system-build:${TICKET}`, title: 'New design system', url: '', text: '[Design Chamber] Build a design system.', data: { build: TICKET } };

const openList = async (p, surface) => {
  if (surface === 'panel') await p.click('.dc-rail-head .dc-iconbtn[aria-label="Design systems"]');
  else await p.click('.dc-library-bar .oc-sdk-btn', { text: 'Design systems' });
};

const openChip = async (p) => {
  await p.host(`window.__host.setItem(${JSON.stringify(CHIP)})`);
  await p.waitFor('return !!doc.querySelector(".dc-build-view")', 'the build chip view');
};

const buildFlow = async (h, surface, width, theme) => {
  const tag = `build-popover-${surfaceName(surface)}-${width}-${theme}`;
  const height = surface === 'panel' ? 820 : 900;
  const p = await h.openPage({ width, height, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openList(p, surface);
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);
  await p.settle(350);
  await h.checkSoon(() => p.guest('return [...doc.querySelectorAll(".oc-sdk-btn")].some((b) => b.textContent.includes("Build with the agent"))'), `${tag}: the header offers Build with the agent…`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow with both header buttons`);
  await p.shot(`${tag}-1-list`);

  // the popover
  await p.click('.oc-sdk-btn', { text: 'Build with the agent' });
  await p.waitFor('return !!doc.querySelector(".dc-build-form")', 'the Build with the agent popover');
  await p.settle(300);
  h.check(await p.guest('return !!doc.querySelector(".dc-build-form textarea")'), `${tag}: the brief field is there`);
  h.check((await text(p, '.dc-build-form')).includes('Agent works in'), `${tag}: Agent works in is asked`);
  h.check(await p.guest('const r = doc.querySelector(".dc-popover, .dc-pop")?.getBoundingClientRect(); return !r || (r.left >= 0 && r.right <= doc.documentElement.clientWidth)'), `${tag}: the popover sits inside the frame`);
  await p.shot(`${tag}-2-popover`);

  // a request that reaches no chat keeps the words
  await p.type('.dc-build-form textarea', 'A shop for hand-made candles, calm and warm');
  await p.host(`window.__host.failNext = 'prompt'`);
  await p.click('.dc-pop-actions .oc-sdk-btn', { text: 'Start' });
  await p.settle(500);
  const refused = await p.guest('return !!doc.querySelector(".dc-build-failure:not([hidden])")');
  if (refused) {
    h.check((await p.guest('return doc.querySelector(".dc-build-form textarea").value')).includes('hand-made candles'), `${tag}: the words are still there after a failed send`);
    h.check(await p.guest('return [...doc.querySelectorAll(".dc-pop-actions .oc-sdk-btn")].some((b) => b.textContent.includes("Try again")) && [...doc.querySelectorAll(".dc-pop-actions .oc-sdk-btn")].some((b) => b.textContent.includes("Copy request"))'), `${tag}: Try again and Copy request are offered`);
    await p.shot(`${tag}-3-not-sent`);
    await p.click('.dc-pop-actions .oc-sdk-btn', { text: 'Copy request' });
    await h.checkSoon(async () => (await p.host('window.__host.clipboard.length')) >= 1, `${tag}: Copy request copies the text`);
    await p.click('.dc-pop-actions .oc-sdk-btn', { text: 'Try again' });
  }
  await h.checkSoon(async () => (await toastTexts(p)).includes('Asked the agent') || (await toastTexts(p)).includes('composer') || (await toastTexts(p)).includes('Started a chat'), `${tag}: the second try reaches a chat`);
  await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-build-form")'), `${tag}: the popover closes once it was sent`);
  const log = JSON.parse(await p.host(`JSON.stringify(${FAKE}.systems.buildLog())`));
  h.check(log.requests.length >= 1 && log.requests[0].brief.includes('candles'), `${tag}: the brief went with the request`);
  await p.close();

  // the empty list keeps the header action
  const q = await h.openPage({ width, height, surface, theme, label: `${tag}-empty`, routes: { 'GET /systems': { status: 200, body: { systems: [], total: 0, max: 50 } } } });
  await h.listReady(q);
  await openList(q, surface);
  await q.waitFor('return !!doc.querySelector(".dc-sys-empty")', 'the empty state');
  await h.checkSoon(() => q.guest('return [...doc.querySelectorAll(".oc-sdk-btn")].some((b) => b.textContent.includes("Build with the agent"))'), `${tag}: Build with the agent… works in the empty state too`);
  h.check((await text(q, '.dc-sys-empty')).includes('From code') && (await text(q, '.dc-sys-empty')).includes('Describe'), `${tag}: the three starts stay in the empty state`);
  await q.shot(`${tag}-4-empty`);
  await q.close();
};

const badgesFlow = async (h, theme) => {
  const tag = `build-badges-rail-360-${theme}`;
  const p = await h.openPage({ width: 360, height: 820, surface: 'panel', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openList(p, 'panel');
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);
  await p.settle(350);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow`);
  const lines = await p.guest('return [...doc.querySelectorAll(".dc-sys")].map((r) => r.textContent.replace(/\\s+/g, " ").trim())');
  h.check(lines.some((l) => l.includes('In Design Chamber')), `${tag}: a system in Design Chamber says so`);
  h.check(lines.some((l) => l.includes('Repo · ')), `${tag}: a repo-backed system names its folder`);
  h.check(lines.some((l) => l.includes('Being built')), `${tag}: a system being built is marked`);
  await p.shot(`${tag}-1-list`);
  await p.close();
};

const chipFlow = async (h, surface, width, theme) => {
  const tag = `build-chip-${surfaceName(surface)}-${width}-${theme}`;
  const height = surface === 'panel' ? 760 : 820;
  console.log(tag);

  // checking: the first answer is slow
  let p = await h.openPage({ width, height, surface, theme, label: `${tag}-loading`, routes: { 'GET /system-builds/:ticket': { status: 200, body: { state: 'waiting', project: { label: 'ember-oak' } }, delayMs: 2500 } } });
  await h.listReady(p);
  await openChip(p);
  h.check((await text(p, '.dc-build-loading')).includes('Checking the build'), `${tag}: checking shows a spinner and its words`);
  h.check(await p.guest('return doc.querySelectorAll(".dc-build-view .oc-sdk-btn").length === 0 || ![...doc.querySelectorAll(".dc-build-stage .oc-sdk-btn")].length'), `${tag}: nothing to press while checking`);
  await p.shot(`${tag}-1-checking`);
  await p.close();

  // waiting, then made, then the system is there
  p = await h.openPage({ width, height, surface, theme, label: `${tag}-waiting` });
  await h.listReady(p);
  await openChip(p);
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-build-empty")'), `${tag}: waiting shows the interview sentence`);
  const body = await text(p, '.dc-build-view');
  h.check(body.includes('interviewing you in chat'), `${tag}: the agent is said to be interviewing`);
  h.check(body.includes('Continue in chat'), `${tag}: Continue in chat is offered`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow while waiting`);
  await p.shot(`${tag}-2-waiting`);
  await p.click('.dc-build-view .oc-sdk-btn', { text: 'Continue in chat' });
  await h.checkSoon(async () => (await p.host('window.__host.sessionsOpened.length')) >= 1, `${tag}: Continue in chat opens the chat`);
  await p.host(`${FAKE}.systems.setBuild({ state: 'made', id: 'harbor', name: 'Harbor' })`);
  await h.checkSoon(() => p.guest("return !!doc.querySelector('.dc-syspg[data-state=ready]')"), `${tag}: the made system opens as its own page`, 9000);
  await p.settle(500);
  await p.shot(`${tag}-3-made`);
  await p.close();

  // made, then stopped: its draft is in the trash
  p = await h.openPage({ width, height, surface, theme, label: `${tag}-stopped`, routes: { 'GET /systems/:id': { status: 404, body: { error: 'not-found', message: 'That design system is not in your list any more.' } } } });
  await h.listReady(p);
  await p.host(`${FAKE}.systems.setBuild({ state: 'made', id: 'harbor', name: 'Harbor' })`);
  await openChip(p);
  await h.checkSoon(async () => (await text(p, '.dc-build-view')).includes('This build was stopped'), `${tag}: a stopped build says so`, 9000);
  h.check((await text(p, '.dc-build-view')).includes('trash'), `${tag}: it names the trash`);
  await p.shot(`${tag}-4-stopped`);
  await p.close();

  // expired
  p = await h.openPage({ width, height, surface, theme, label: `${tag}-expired` });
  await h.listReady(p);
  await p.host(`${FAKE}.systems.setBuild({ state: 'expired' })`);
  await openChip(p);
  await h.checkSoon(async () => (await text(p, '.dc-build-view')).includes('more than a week ago'), `${tag}: an old build says it is a week old`, 9000);
  h.check(await p.guest('return doc.querySelectorAll(".dc-build-stage .oc-sdk-btn").length === 0'), `${tag}: nothing to press on an expired build`);
  await p.shot(`${tag}-5-expired`);
  await p.close();

  // the service is not running
  p = await h.openPage({ width, height, surface, theme, label: `${tag}-down`, routes: { 'GET /system-builds/:ticket': { throws: 'The Design Chamber service did not answer. Try again.' } } });
  await h.listReady(p);
  await openChip(p);
  await h.checkSoon(async () => (await text(p, '.dc-build-view')).includes('isn’t running'), `${tag}: a service that is down says so`, 9000);
  h.check((await text(p, '.dc-build-view')).includes('Try again'), `${tag}: Try again is offered`);
  await p.shot(`${tag}-6-down`);
  await p.route('GET /system-builds/:ticket', null);
  await p.click('.dc-build-view .oc-sdk-btn', { text: 'Try again' });
  await h.checkSoon(async () => (await text(p, '.dc-build-view')).includes('interviewing'), `${tag}: Try again gets the build back`, 9000);
  await p.close();

  // three failed polls in a row
  p = await h.openPage({ width, height, surface, theme, label: `${tag}-failed`, routes: { 'GET /system-builds/:ticket': { status: 500, body: { error: 'internal', message: 'Something went wrong on our side.' } } } });
  await h.listReady(p);
  await openChip(p);
  await h.checkSoon(async () => (await text(p, '.dc-build-view')).includes('Couldn’t check the build'), `${tag}: three failures in a row stop the polling`, 14000);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow on a failed check`);
  await p.shot(`${tag}-7-failed`);
  await p.close();
};

export const run = async (h) => {
  for (const theme of ['dark', 'light']) {
    for (const width of [320, 480]) {
      await buildFlow(h, 'panel', width, theme);
      await chipFlow(h, 'panel', width, theme);
    }
    await badgesFlow(h, theme);
    await buildFlow(h, 'page', 1400, theme);
    await chipFlow(h, 'page', 1400, theme);
  }
};
