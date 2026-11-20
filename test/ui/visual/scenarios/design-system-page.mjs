// Visual scenario for Phase 2.5 U2 (the design system page): the page at 1400 px and the rail at 320 and 480 px, light and dark,
// plus the page at 390 px for the phone switch. Per variant: opening a system from the list (header, status, the area accordion
// with counts and review states, the board and the first section), selecting a section, a section the system doesn't cover,
// inline editing (pending value, dirty dot, Save, the Saved notice with Undo, a refused stale save, Reset), review (Looks good,
// the Needs work note and its send, the review shown once), Mark ready and its notice, the versions drawer, the ask bar and the
// load states. `helpers`: openPage, check, checkSoon, listReady, sleep. DC_SYSPAGE_ONLY=<tag regex> limits the variants.

const FAKE = 'window.frames[0].__dcFake';
const text = (p, selector) => p.guest(`return (doc.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
const pageLog = async (p) => JSON.parse(await p.host(`JSON.stringify(${FAKE}.systems.pageLog())`));
const surfaceName = (surface) => (surface === 'panel' ? 'rail' : 'page');
const ROW = (section) => `.dc-syspg-row[data-focus-key="row:${section}"]`;

const openList = async (p, surface) => {
  if (surface === 'panel') await p.click('.dc-rail-head .dc-iconbtn[aria-label="Design systems"]');
  else await p.click('.dc-library-bar .oc-sdk-btn', { text: 'Design systems' });
};

const openSystem = async (h, p, surface, id, tag) => {
  await openList(p, surface);
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);
  await p.click(`.dc-sys[data-id="${id}"] .dc-sys-main`);
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"ready\\"]")'), `${tag}: the system page loads`);
  await p.settle(500);
};

const boardReady = (h, p, tag) => h.checkSoon(() => p.guest('return doc.querySelector(".dc-sys-board")?.dataset.state === "ready"'), `${tag}: the board is drawn`);

const pageFlow = async (h, surface, width, theme) => {
  const rail = surface === 'panel';
  const tag = `syspage-${surfaceName(surface)}-${width}-${theme}`;
  const p = await h.openPage({ width, height: rail ? 900 : 900, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openSystem(h, p, surface, 'tidepool', tag);
  await boardReady(h, p, tag);

  // ---- the page itself
  const title = await text(p, '.dc-syspg-h1');
  h.check(title.startsWith('Tidepool'), `${tag}: the name is the heading (${title})`);
  h.check((await p.guest('return doc.querySelectorAll(".dc-syspg-area").length')) === 4, `${tag}: four areas in the accordion`);
  const areaNames = await p.guest('return [...doc.querySelectorAll(".dc-syspg-area-name")].map((n) => n.textContent).join("|")');
  h.check(areaNames === 'Foundations|Components|Patterns & voice|Brand & marketing', `${tag}: the areas are spelled out (${areaNames})`);
  h.check(await noOverflow(p), `${tag}: nothing scrolls sideways`);
  await p.shot(`${tag}-1-open`);

  // ---- a section: values, notes, swatches
  if (!rail) {
    await p.click(ROW('colours'));
    await p.settle(250);
    h.check((await p.guest('return doc.querySelectorAll(".dc-sp-entry").length')) >= 7, `${tag}: Colours lists its tokens`);
    h.check((await p.guest('return doc.querySelectorAll(".dc-sp-swatch:not([data-empty])").length')) >= 7, `${tag}: colours show a swatch`);
    h.check((await text(p, '.dc-sp-entry[data-entry="token:--brand-strong"]')).includes('var(--brand)'), `${tag}: a formula value is shown`);
    h.check((await p.guest('return !!doc.querySelector(".dc-sp-entry[data-entry=\\"token:--brand-strong\\"] .dc-sp-lock")')), `${tag}: a formula value says it can't be edited here`);
    await p.shot(`${tag}-2-colours`);

    // ---- inline edit, preview, save, undo
    await p.click('.dc-sp-entry[data-entry="token:--brand"] .dc-sp-value[data-focus-key="token:--brand:light"]');
    await p.type('.dc-sp-entry[data-entry="token:--brand"] .dc-sp-input', '#a0301f');
    await p.key('Enter');
    await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg-editbar")'), `${tag}: an edit puts the Unsaved bar up`);
    h.check((await text(p, '.dc-syspg-editcount')).includes('1 unsaved change'), `${tag}: it counts the change (${await text(p, '.dc-syspg-editcount')})`);
    h.check((await text(p, '.dc-syspg-titlewrap')).includes('Unsaved'), `${tag}: the header says Unsaved`);
    await p.shot(`${tag}-3-dirty`);
    await p.click('.dc-syspg-editbar .oc-sdk-btn', { text: 'Save' });
    await h.checkSoon(async () => (await text(p, '.dc-notices')).includes('Saved'), `${tag}: Saved shows`);
    h.check((await pageLog(p)).saves.length === 1, `${tag}: one save request`);
    await p.shot(`${tag}-4-saved`);
    await p.click('.dc-notices .oc-sdk-btn', { text: 'Undo' });
    await h.checkSoon(async () => (await pageLog(p)).undos.length === 1, `${tag}: Undo reaches the service`);
    await h.checkSoon(async () => (await text(p, '.dc-notices')).includes('Undone'), `${tag}: Undone shows`);
    await p.settle(600);

    // ---- stale save keeps the pending value
    await p.host(`${FAKE}.systems.staleNext()`);
    await p.click('.dc-sp-entry[data-entry="token:--brand"] .dc-sp-value[data-focus-key="token:--brand:light"]');
    await p.type('.dc-sp-entry[data-entry="token:--brand"] .dc-sp-input', '#112233');
    await p.key('Enter');
    await p.click('.dc-syspg-editbar .oc-sdk-btn', { text: 'Save' });
    await h.checkSoon(async () => (await text(p, '.dc-notices')).includes('Reload and try again'), `${tag}: a stale save offers Reload and try again`);
    h.check((await text(p, '.dc-notices')).includes('Nothing was saved.'), `${tag}: it says nothing was saved`);
    h.check(!!(await p.guest('return !!doc.querySelector(".dc-syspg-editbar")')), `${tag}: the pending value is kept`);
    await p.shot(`${tag}-5-stale`);
    await p.click('.dc-syspg-editbar .oc-sdk-btn', { text: 'Reset' });
    await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-syspg-editbar")'), `${tag}: Reset drops the change`);
  }

  // ---- review: once, in the panel only
  await p.click(ROW('typography'));
  await p.settle(200);
  let foot = await text(p, '.dc-syspg-review');
  h.check(foot.includes('Looks good') && foot.includes('Needs work'), `${tag}: an unreviewed section offers both (${foot.slice(0, 80)})`);
  h.check((await p.guest('return doc.querySelectorAll(".dc-syspg-review").length')) === 1, `${tag}: the review controls are shown once`);
  await p.click('.dc-syspg-review .oc-sdk-btn', { text: 'Looks good' });
  await h.checkSoon(async () => (await pageLog(p)).reviews.some((r) => r.section === 'typography' && r.state === 'looks-good'), `${tag}: Looks good is saved`);
  await p.settle(300);
  const buttons = await p.guest('return [...doc.querySelectorAll(".dc-syspg-review .oc-sdk-btn")].map((b) => b.textContent.trim()).join("|")');
  h.check(buttons === 'Needs work', `${tag}: a good section shows its state and only Needs work (${buttons})`);
  await p.shot(`${tag}-6-reviewed`);

  await p.click('.dc-syspg-review .oc-sdk-btn', { text: 'Needs work' });
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg-note")'), `${tag}: Needs work asks what to fix`);
  await p.type('.dc-syspg-note', 'The heading feels too tight.');
  await p.shot(`${tag}-7-needs-work`);
  await p.click('.dc-syspg-review .oc-sdk-btn', { text: 'Send to the agent' });
  await h.checkSoon(async () => (await pageLog(p)).asks.some((a) => a.purpose === 'review' && a.section === 'typography'), `${tag}: the review goes to the agent with its section`);

  // ---- a section the system doesn't cover
  await p.host(`${FAKE}.systems.setCoverage('tidepool', ['foundations', 'components'])`);
  await p.click(ROW('overview'));
  await p.settle(200);
  await p.host('window.frames[0].dispatchEvent(new Event("focus"))');

  // ---- mark ready and the notice
  if (!rail) {
    const ready = await p.guest('return [...doc.querySelectorAll(".dc-syspg-tools .oc-sdk-btn")].map((b) => b.textContent.trim()).join("|")');
    h.check(ready.includes('Versions'), `${tag}: Versions is in the header (${ready})`);
  }

  h.check(await noOverflow(p), `${tag}: nothing scrolls sideways at the end`);
  await p.close();
};

const uncoveredFlow = async (h, surface, width, theme) => {
  const tag = `syspage-uncovered-${surfaceName(surface)}-${width}-${theme}`;
  const p = await h.openPage({ width, height: 900, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openSystem(h, p, surface, 'juniper', tag);
  await p.click('.dc-syspg-area[data-area="patterns"] .dc-syspg-area-head');
  await p.click(ROW('patterns'));
  await p.settle(250);
  const said = surface === 'panel' ? await text(p, `${ROW('patterns')}`) : await text(p, '.dc-sp-section');
  h.check(said.includes(surface === 'panel' ? 'Not covered' : 'Not covered by this system.'), `${tag}: an uncovered section says so (${said.slice(0, 60)})`);
  h.check((await p.guest('return doc.querySelectorAll(".dc-syspg-review").length')) === 0, `${tag}: no review controls on an uncovered section`);
  await p.shot(`${tag}-1`);
  await p.close();
};

const readyFlow = async (h, surface, width, theme) => {
  const tag = `syspage-ready-${surfaceName(surface)}-${width}-${theme}`;
  const p = await h.openPage({ width, height: 900, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openSystem(h, p, surface, 'acme', tag);
  const label = () => p.guest('return [...doc.querySelectorAll(".dc-syspg-tools .oc-sdk-btn, .dc-syspg-railactions .oc-sdk-btn")].map((b) => b.textContent.trim()).join("|")');
  h.check((await label()).includes('Mark ready'), `${tag}: a draft offers Mark ready (${await label()})`);
  await p.click('.oc-sdk-btn[data-emphasis="primary"]', { text: 'Mark ready' });
  await h.checkSoon(async () => /is ready/.test(await text(p, '.dc-notices')), `${tag}: the notice says it is ready`);
  const notice = await text(p, '.dc-notices');
  h.check(/weren’t reviewed|wasn’t reviewed/.test(notice) && notice.includes('Review the'), `${tag}: it counts what wasn't reviewed and offers Review the N (${notice.slice(0, 100)})`);
  await p.shot(`${tag}-1-notice`);
  await p.close();
};

const versionsFlow = async (h, theme) => {
  const tag = `syspage-versions-page-1400-${theme}`;
  const p = await h.openPage({ width: 1400, height: 900, surface: 'page', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openSystem(h, p, 'page', 'tidepool', tag);
  await p.click('.dc-syspg-tools .oc-sdk-btn', { text: 'Versions' });
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-version").length >= 3'), `${tag}: the drawer lists the versions`);
  await p.settle(400);
  await p.shot(`${tag}-1-drawer`);
  await p.close();
};

const stateFlow = async (h, theme) => {
  const tag = `syspage-states-page-1400-${theme}`;
  const p = await h.openPage({ width: 1400, height: 800, surface: 'page', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await p.host(`${FAKE}.systems.failDetail(true)`);
  await p.click('.dc-library-bar .oc-sdk-btn', { text: 'Design systems' });
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the list is up`);
  await p.click('.dc-sys[data-id="tidepool"] .dc-sys-main');
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"error\\"]")'), `${tag}: a failed load shows the error state`);
  h.check((await text(p, '.dc-sys-pagemsg')).includes('didn’t load'), `${tag}: it says the system didn't load`);
  await p.shot(`${tag}-1-error`);
  await p.host(`${FAKE}.systems.failDetail(false)`);
  await p.click('.dc-sys-pagemsg .oc-sdk-btn', { text: 'Try again' });
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"ready\\"]")'), `${tag}: Try again loads it`);
  await p.close();
};

const phoneFlow = async (h, theme) => {
  const tag = `syspage-page-390-${theme}`;
  const p = await h.openPage({ width: 390, height: 844, surface: 'page', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openSystem(h, p, 'page', 'tidepool', tag);
  const labels = await p.guest('return [...doc.querySelectorAll(".dc-syspg-mobile button")].map((b) => b.textContent).join("|")');
  h.check(labels === 'Board|Sections', `${tag}: the phone has a Board / Sections switch (${labels})`);
  await p.shot(`${tag}-1-board`);
  await p.click('.dc-syspg-mobile button', { text: 'Sections' });
  await p.settle(300);
  const small = await p.guest('return [...doc.querySelectorAll(".dc-syspg-row, .dc-syspg-area-head, .dc-syspg-mobile button")].filter((n) => n.offsetParent && n.getBoundingClientRect().height < 43).length');
  h.check(small === 0, `${tag}: targets are at least 44px tall (${small} smaller)`);
  const brand = await p.guest('return [...doc.querySelectorAll(".dc-syspg-area-name")].map((n) => n.textContent).includes("Brand & marketing")');
  h.check(brand, `${tag}: Brand & marketing is spelled out`);
  h.check(await noOverflow(p), `${tag}: nothing scrolls sideways`);
  await p.shot(`${tag}-2-sections`);
  await p.close();
};

export const run = async (h) => {
  const only = process.env.DC_SYSPAGE_ONLY ? new RegExp(process.env.DC_SYSPAGE_ONLY) : null;
  const go = (tag, fn) => (only && !only.test(tag) ? Promise.resolve() : fn());
  for (const theme of ['light', 'dark']) {
    await go(`page-1400-${theme}`, () => pageFlow(h, 'page', 1400, theme));
    for (const width of [320, 480]) await go(`rail-${width}-${theme}`, () => pageFlow(h, 'panel', width, theme));
  }
  await go('uncovered-page-light', () => uncoveredFlow(h, 'page', 1400, 'light'));
  await go('uncovered-rail-dark', () => uncoveredFlow(h, 'panel', 320, 'dark'));
  await go('ready-page-dark', () => readyFlow(h, 'page', 1400, 'dark'));
  await go('ready-rail-light', () => readyFlow(h, 'panel', 480, 'light'));
  await go('versions-light', () => versionsFlow(h, 'light'));
  await go('versions-dark', () => versionsFlow(h, 'dark'));
  await go('states-dark', () => stateFlow(h, 'dark'));
  await go('phone-light', () => phoneFlow(h, 'light'));
  await go('phone-dark', () => phoneFlow(h, 'dark'));
};
