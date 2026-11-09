// Visual scenario for the live build strip (feat/build-strip): working, writing (the written
// board lights up), a question, retrying, done, failed (and Dismiss), and a design that is
// still waiting for its first file. `helpers` is what the other scenarios use: openPage, check,
// listReady, thumbsReady, wallReady, menuItem, scaleLabel, sleep, outDir.
//
// Default: page 1400 dark and rail 320 light (the spec's pair). DC_BUILD_STRIP_ALL=1 runs
// page 1400 and rail 320/480 in both themes, for a look at every combination.

const CONFIGS = [
  { surface: 'page', width: 1400, theme: 'dark' },
  { surface: 'panel', width: 320, theme: 'light' },
];
const ALL = [
  ...CONFIGS,
  { surface: 'page', width: 1400, theme: 'light' },
  { surface: 'panel', width: 320, theme: 'dark' },
  { surface: 'panel', width: 480, theme: 'dark' },
  { surface: 'panel', width: 480, theme: 'light' },
];

const COFFEE = 'coffee-subscription';
const SESSION = 'ses_coffee';

const scenario = async ({ surface, width, theme }, h) => {
  const kind = surface === 'page' ? 'page' : 'rail';
  const tag = `${kind}-${width}-${theme}-build`;
  const p = await h.openPage({ width, height: surface === 'page' ? 900 : 780, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await h.thumbsReady(p);
  await p.click(surface === 'page' ? `.dc-card[data-slug="${COFFEE}"] .dc-card-main` : `.dc-row[data-slug="${COFFEE}"] .dc-row-main`);
  await h.wallReady(p, 2);
  await p.settle(600);

  const phase = () => p.guest('return doc.querySelector(".dc-build")?.dataset.phase ?? null');
  const phaseIs = (name, what) => p.waitFor(`return doc.querySelector(".dc-build")?.dataset.phase === ${JSON.stringify(name)}`, what ?? `the ${name} phase`, 8000);
  const wallBox = () => p.guest('const r = doc.querySelector(".dc-wall").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(",")');
  const stripText = () => p.guest('return doc.querySelector(".dc-build-text")?.textContent ?? ""');

  check(h, (await phase()) === 'hidden', `${tag}: nothing shows while the agent is idle`);
  check(h, await p.guest('const live = doc.querySelector(".dc-build-live"); return !!live && live.getAttribute("role") === "status" && live.getAttribute("aria-live") === "polite" && live.getAttribute("aria-atomic") === "true"'), `${tag}: the live region is in the page from the start`);
  check(h, await p.guest('return doc.querySelector(".dc-stage").firstElementChild.classList.contains("dc-stage-overlay")'), `${tag}: the strip comes before the wall in Tab order`);
  const idleWall = await wallBox();

  // working
  await p.host('window.__host.setActivity("' + SESSION + '", "running")');
  await phaseIs('working');
  await p.settle(1300);
  check(h, (await wallBox()) === idleWall, `${tag}: the strip does not move the wall (${idleWall})`);
  check(h, /^\d+:\d\d$/.test(await p.guest('return doc.querySelector(".dc-build-elapsed")?.textContent ?? ""')), `${tag}: working shows the elapsed time`);
  await p.shot(`${tag}-1-working`);

  // writing: one screen is saved, its board lights up and the others do not
  await p.guest('win.__dcFake.writeFile("' + COFFEE + '", "screens/pricing.html")');
  await phaseIs('writing');
  await p.waitFor('return doc.querySelectorAll(".dc-board[data-recent=\\"true\\"]").length > 0', 'the written board to light up');
  const lit = await p.guest('return [...doc.querySelectorAll(".dc-board[data-recent=\\"true\\"]")].map((n) => n.dataset.board).join(",")');
  check(h, lit.length > 0 && lit.split(',').every((id) => id.startsWith('pricing')), `${tag}: only the pricing boards are lit (${lit})`);
  check(h, (await stripText()).includes('pricing.html'), `${tag}: the strip names the file ("${await stripText()}")`);
  await p.settle(500);
  await p.shot(`${tag}-2-writing`);

  // a question for the user
  await p.host('window.__host.setActivity("' + SESSION + '", "waiting-question")');
  await phaseIs('question');
  await p.settle(300);
  check(h, await p.guest('return [...doc.querySelectorAll(".dc-build-actions button")].some((b) => !b.hidden && (b.getAttribute("aria-label") || b.textContent).includes("Open chat"))'), `${tag}: a question offers Open chat`);
  await p.shot(`${tag}-3-question`);

  // done: the turn ends after writing one file
  await p.host('window.__host.setActivity("' + SESSION + '", "idle", "completed")');
  await phaseIs('done');
  await p.settle(300);
  // The rail's pill only says "Done"; the full-screen one counts the files.
  check(h, (surface === 'page' ? /^Done\. Updated 1 file$/ : /^Done$/).test(await stripText()), `${tag}: done reads right ("${await stripText()}")`);
  await p.shot(`${tag}-4-done`);

  // retrying (a new turn, so the file from the last one does not read as "writing")
  await p.host('window.__host.setActivity("' + SESSION + '", "retrying")');
  await phaseIs('retrying');
  await p.settle(300);
  await p.shot(`${tag}-5-retrying`);

  // failed, then Dismiss
  await p.host('window.__host.setActivity("' + SESSION + '", "idle", "failed")');
  await phaseIs('failed');
  await p.settle(300);
  await p.shot(`${tag}-6-failed`);
  await p.click('.dc-build-actions button', { text: 'Dismiss' });
  await phaseIs('hidden', 'the strip to go away after Dismiss');
  check(h, true, `${tag}: Dismiss removes the failed strip`);

  // the tooltip keeps the whole path, and the board highlight clears by itself (page only: it takes 6 s)
  if (surface === 'page') {
    await p.host('window.__host.setActivity("' + SESSION + '", "running")');
    await phaseIs('working');
    await p.guest('win.__dcFake.writeFile("' + COFFEE + '", "screens/checkout.html")');
    await p.waitFor('return doc.querySelectorAll(".dc-board[data-recent=\\"true\\"]").length > 0', 'the board to light up again');
    check(h, (await p.guest('return doc.querySelector(".dc-build-text").title')) === 'screens/checkout.html', `${tag}: the tooltip holds the whole path`);
    await h.sleep(6600);
    check(h, (await p.guest('return doc.querySelectorAll(".dc-board[data-recent]").length')) === 0, `${tag}: the highlight clears after 6 s`);
    await p.host('window.__host.setActivity("' + SESSION + '", "idle", "completed")');
  }

  // a design still waiting for its first file, 4 minutes on
  await p.click(surface === 'page' ? '.dc-toolbar .oc-sdk-btn' : '.dc-toolbar-compact .dc-iconbtn[aria-label="Back to designs"]', surface === 'page' ? { text: 'Library' } : {});
  await h.listReady(p);
  await p.guest('win.__dcFake.ageDesign("onboarding-flow", 240000)');
  await p.click(surface === 'page' ? '.dc-card[data-slug="onboarding-flow"] .dc-card-main' : '.dc-row[data-slug="onboarding-flow"] .dc-row-main');
  await p.waitFor('return !!doc.querySelector(".dc-board")', 'the pending design');
  await phaseIs('stalled');
  await p.settle(400);
  check(h, (await stripText()).startsWith('Nothing written yet'), `${tag}: a pending design says nothing is written ("${await stripText()}")`);
  await p.shot(`${tag}-7-stalled`);

  check(h, await p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth'), `${tag}: no horizontal overflow`);
  await p.close();
};

const check = (h, condition, message) => h.check(condition, message);

export const run = async (helpers) => {
  for (const config of process.env.DC_BUILD_STRIP_ALL ? ALL : CONFIGS) await scenario(config, helpers);
};
