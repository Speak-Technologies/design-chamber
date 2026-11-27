// Visual scenario for system-builder-depth T13 (the Screens view on the design system page): the page at 1400 px and the
// rail at 320 and 480 px, light and dark. Per variant: a system without screens shows no switch; Harbor's four screens
// (a page template at two sizes, a phone-only state, a fixed-size social card, one the reader refused) on a wall in the
// sandboxed frame; keyboard and wheel pan and zoom; a screen that fails and Try again; a theme switch drawing the
// screens again in the other scheme; the agent removing every screen (the empty state and the way back to the board).
// In the rail the view is a list first; a row shows that one screen.

const FAKE = 'window.frames[0].__dcFake';
const text = (p, selector) => p.guest(`return (doc.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
const count = (p, selector) => p.guest(`return doc.querySelectorAll(${JSON.stringify(selector)}).length`);
const visible = (p, selector) => p.guest(`const n = doc.querySelector(${JSON.stringify(selector)}); return !!n && n.getClientRects().length > 0`);
const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
const surfaceName = (surface) => (surface === 'panel' ? 'rail' : 'page');
const READY = '.dc-sysscr-board[data-state="ready"]';
const zoom = (p) => text(p, '.dc-sysscr .dc-zoom-label');
const world = (p) => p.guest('return doc.querySelector(".dc-sysscr .dc-wall-world")?.style.transform ?? ""');

const openList = async (p, surface) => {
  if (surface === 'panel') await p.click('.dc-rail-head .dc-iconbtn[aria-label="Design systems"]');
  else await p.click('.dc-library-bar .oc-sdk-btn', { text: 'Design systems' });
};

const openSystem = async (h, p, id, tag) => {
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);
  await p.click(`.dc-sys[data-id="${id}"] .dc-sys-main`);
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"ready\\"]")'), `${tag}: ${id} loads`);
  await p.settle(400);
};

const back = async (p, surface) => {
  if (surface === 'panel') await p.click('.dc-syspg-head .dc-iconbtn[aria-label="Back to design systems"]');
  else await p.click('.dc-syspg-top .oc-sdk-btn', { text: 'Design systems' });
  await p.settle(300);
};

const flow = async (h, surface, width, theme) => {
  const rail = surface === 'panel';
  const tag = `sysscreens-${surfaceName(surface)}-${width}-${theme}`;
  const p = await h.openPage({ width, height: 900, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openList(p, surface);

  // ---- a system with no screens shows no switch
  await openSystem(h, p, 'tidepool', tag);
  h.check(!(await visible(p, '.dc-syspg-views')), `${tag}: no Board and Screens switch without screens`);
  await back(p, surface);

  // ---- Harbor has four
  await openSystem(h, p, 'harbor', tag);
  const tabs = await p.guest('return [...doc.querySelectorAll(".dc-syspg-view")].map((b) => b.textContent.trim() + ":" + b.getAttribute("aria-pressed")).join("|")');
  h.check(tabs === 'Board:true|Screens (4):false', `${tag}: the switch reads Board, Screens (4) (${tabs})`);
  await p.click('.dc-syspg-view', { text: 'Screens' });
  await h.checkSoon(async () => (await p.guest('return doc.querySelector(".dc-syspg")?.dataset.stageView')) === 'screens', `${tag}: Screens is on the stage`);
  h.check(!(await visible(p, '.dc-sys-board')), `${tag}: the board steps aside`);

  if (rail) {
    await h.checkSoon(async () => (await count(p, '.dc-sysscr-row')) === 4, `${tag}: the rail lists four screens`);
    const rows = await p.guest('return [...doc.querySelectorAll(".dc-sysscr-row")].map((r) => r.textContent.trim()).join("|")');
    h.check(rows.includes('DashboardPage template · Laptop, Phone') && rows.includes('Launch cardMarketing · Social card'), `${tag}: rows say the kind and the sizes (${rows.slice(0, 120)})`);
    h.check(rows.includes('screens/checkout.html is missing.'), `${tag}: a refused screen says why in its row`);
    h.check((await text(p, '.dc-sysscr-hint')).includes('Extension pages'), `${tag}: the rail says where every screen side by side is`);
    h.check(await noOverflow(p), `${tag}: nothing scrolls sideways`);
    await p.shot(`${tag}-1-list`);
    await p.click('.dc-sysscr-row[data-screen="dashboard"]');
    await h.checkSoon(async () => (await count(p, READY)) === 2, `${tag}: Dashboard opens at its two sizes`);
    h.check((await text(p, '.dc-sysscr-count')) === 'Dashboard', `${tag}: the bar names the screen`);
  } else {
    await h.checkSoon(async () => (await count(p, READY)) >= 4, `${tag}: the screens draw (${await count(p, READY)} ready)`);
    h.check((await count(p, '.dc-sysscr-board')) === 6, `${tag}: six artboards: Dashboard at two sizes, one each for the state and the card, two for the refused one (${await count(p, '.dc-sysscr-board')})`);
    h.check((await text(p, '.dc-sysscr-count')) === '4 screens', `${tag}: the bar counts the screens`);
    const problem = await text(p, '.dc-sysscr-board[data-board="checkout@laptop"] .dc-placeholder');
    h.check(problem.includes('This screen can’t be shown') && problem.includes('screens/checkout.html is missing.'), `${tag}: a refused screen says why on the wall (${problem})`);
    const labels = await p.guest('return [...doc.querySelectorAll(".dc-sysscr .dc-label:not([hidden])")].map((l) => l.textContent.trim()).join("|")');
    h.check(labels.includes('Launch card·Social card 1200×630'), `${tag}: labels name the screen and its size (${labels.slice(0, 140)})`);
  }
  await p.settle(700);
  const sandbox = await p.guest('return [...doc.querySelectorAll(".dc-sysscr iframe")].map((f) => f.getAttribute("sandbox")).join("|")');
  h.check(sandbox.length > 0 && !sandbox.includes('allow-same-origin') && sandbox.split('|').every((s) => s === 'allow-scripts'), `${tag}: every screen frame is allow-scripts only (${sandbox})`);
  const schemes = await p.guest('return [...doc.querySelectorAll(".dc-sysscr iframe")].map((f) => f.style.colorScheme).join("|")');
  h.check(schemes.split('|').every((s) => s === theme), `${tag}: frames take the ${theme} scheme (${schemes})`);
  const log = JSON.parse(await p.host(`JSON.stringify(${FAKE}.systems.screenLog())`));
  h.check(log.length > 0 && log.every((entry) => entry.scheme === theme), `${tag}: renders are asked for in ${theme}`);
  h.check(await noOverflow(p), `${tag}: nothing scrolls sideways`);
  await p.shot(`${tag}-2-wall`);

  // ---- keyboard and wheel, as on a canvas
  const fitted = await zoom(p);
  await p.key('-', { focus: '.dc-sysscr-wall' });
  await h.checkSoon(async () => (await zoom(p)) !== fitted, `${tag}: minus zooms out (${fitted} → ${await zoom(p)})`);
  const before = await world(p);
  await p.key('ArrowLeft', { focus: '.dc-sysscr-wall' });
  await h.checkSoon(async () => (await world(p)) !== before, `${tag}: an arrow pans`);
  await p.key('!', { code: 'Digit1', shift: true, focus: '.dc-sysscr-wall' });
  await h.checkSoon(async () => (await zoom(p)) === fitted, `${tag}: Shift+1 fits again (${await zoom(p)})`);
  const r = await p.rect('.dc-sysscr-wall');
  await p.wheel(r.x + r.w / 2, r.y + r.h / 2, 0, -240, { ctrl: true });
  await h.checkSoon(async () => (await zoom(p)) !== fitted, `${tag}: Ctrl and the wheel zoom (${await zoom(p)})`);
  await p.click('.dc-sysscr-bar button', { text: 'Fit' });
  await h.checkSoon(async () => (await zoom(p)) === fitted, `${tag}: Fit goes back`);

  // ---- a screen that fails, then Try again
  await p.host(`${FAKE}.systems.failScreens('dashboard')`);
  await p.host(`${FAKE}.systems.redrawScreens('harbor')`);
  await h.checkSoon(async () => (await count(p, '.dc-sysscr-board[data-state="error"]')) >= 1, `${tag}: a screen that fails says so`);
  const failed = await text(p, '.dc-sysscr-board[data-state="error"] .dc-placeholder');
  h.check(failed.includes('This screen didn’t load') && failed.includes('Try again'), `${tag}: with what happened and Try again (${failed})`);
  await p.shot(`${tag}-3-error`);
  await p.host(`${FAKE}.systems.failScreens(null)`);
  // Each failed artboard has its own Try again; it draws that one.
  for (let n = 0; n < 3 && (await count(p, '.dc-sysscr-board[data-state="error"]')) > 0; n += 1) {
    const before = await count(p, '.dc-sysscr-board[data-state="error"]');
    await p.click('.dc-sysscr-board[data-state="error"] .oc-sdk-btn', { text: 'Try again' });
    await h.checkSoon(async () => (await count(p, '.dc-sysscr-board[data-state="error"]')) < before, `${tag}: Try again draws that screen`);
  }

  // ---- a theme switch draws the screens again in the other scheme
  const other = theme === 'dark' ? 'light' : 'dark';
  await p.host(`window.__host.setTheme(${JSON.stringify(other)})`);
  await h.checkSoon(async () => JSON.parse(await p.host(`JSON.stringify(${FAKE}.systems.screenLog())`)).some((entry) => entry.scheme === other), `${tag}: the switch asks for ${other} screens`);
  await h.checkSoon(async () => (await p.guest('return [...doc.querySelectorAll(".dc-sysscr iframe")].every((f) => f.style.colorScheme === ' + JSON.stringify(other) + ')')), `${tag}: frames take the ${other} scheme`);
  await p.settle(900);
  await p.shot(`${tag}-4-${other}`);
  await p.host(`window.__host.setTheme(${JSON.stringify(theme)})`);
  await p.settle(500);

  // ---- the agent removes every screen
  await p.host(`${FAKE}.systems.setScreens('harbor', [])`);
  await h.checkSoon(async () => (await text(p, '.dc-sysscr-message')).includes('No screens yet. Ask the agent to add page templates.'), `${tag}: the empty state says what goes here`);
  h.check(await visible(p, '.dc-syspg-views'), `${tag}: the switch stays so the way back is where it was`);
  await p.shot(`${tag}-5-empty`);
  await p.click('.dc-sysscr-message .oc-sdk-btn', { text: 'Back to the board' });
  await h.checkSoon(() => visible(p, '.dc-sys-board'), `${tag}: Back to the board brings it back`);
  await h.checkSoon(async () => !(await visible(p, '.dc-syspg-views')), `${tag}: and the switch goes with the screens`);
  await p.close();
};

export const run = async (h) => {
  for (const [surface, width] of [['page', 1400], ['panel', 320], ['panel', 480]]) {
    for (const theme of ['light', 'dark']) await flow(h, surface, width, theme);
  }
};
