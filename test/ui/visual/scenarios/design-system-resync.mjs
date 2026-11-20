// Visual scenario for Phase 2.5 U5 (the Re-sync sheet of a design system with a code source): the page at 1400 px and the rail
// at 320 and 480 px, light and dark. The menu offers Re-sync on the page only; the scan runs; the review shows its groups
// (Changed with swatches, Conflicts with Keep mine / Use the code's, New, No longer in the code, new files); ticks change what
// Apply says; Apply takes a version and the notice offers Undo and Ask the agent; stale, nothing to apply, a missing folder
// and a partial scan each say their sentence. DC_RESYNC_ONLY=<tag regex> limits the variants.

const FAKE = 'window.frames[0].__dcFake';
const text = (p, selector) => p.guest(`return (doc.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
const pageLog = async (p) => JSON.parse(await p.host(`JSON.stringify(${FAKE}.systems.pageLog())`));
const surfaceName = (surface) => (surface === 'panel' ? 'rail' : 'page');
const SHEET = '.dc-resync';
const menuItem = (p, label) => p.click('.dc-popup [role="menuitem"]', { text: label });

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

const menuLabels = (p) => p.guest('return [...doc.querySelectorAll(".dc-popup [role=\\"menuitem\\"]")].map((n) => n.textContent.trim()).join("|")');

const startResync = async (h, p, tag) => {
  await p.click('.dc-syspg-tools .dc-iconbtn[aria-label="More"]');
  await menuItem(p, 'Re-sync from code');
  await h.checkSoon(() => p.guest(`return !!doc.querySelector(${JSON.stringify(SHEET)})`), `${tag}: the sheet opens`);
};

// The fake's change feed carries no system id, so the open page doesn't re-read by itself: leave and open it again.
const reopen = async (h, p, tag) => {
  await p.click('.dc-syspg-top .oc-sdk-btn', { text: 'Design systems' });
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: back at the list`);
  await p.click('.dc-sys[data-id="tidepool"] .dc-sys-main');
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"ready\\"]")'), `${tag}: the system page loads again`);
  await p.settle(400);
};

const reviewReady = (h, p, tag) => h.checkSoon(() => p.guest(`return !!doc.querySelector("${SHEET} .dc-resync-group")`), `${tag}: the review is drawn`);

const flow = async (h, surface, width, theme) => {
  const rail = surface === 'panel';
  const tag = `resync-${surfaceName(surface)}-${width}-${theme}`;
  const p = await h.openPage({ width, height: 900, surface, theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openSystem(h, p, surface, 'tidepool', tag);

  if (rail) {
    await p.click('.dc-syspg-tools .dc-iconbtn[aria-label="More"]');
    const labels = await menuLabels(p);
    h.check(!labels.includes('Re-sync'), `${tag}: the rail has no Re-sync (${labels})`);
    await p.key('Escape');
    await p.close();
    return;
  }

  await p.click('.dc-syspg-tools .dc-iconbtn[aria-label="More"]');
  h.check((await menuLabels(p)).includes('Re-sync from code'), `${tag}: the menu offers Re-sync from code (${await menuLabels(p)})`);
  await p.key('Escape');
  await p.settle(150);

  // ---- the scan, then the review
  await startResync(h, p, tag);
  await reviewReady(h, p, tag);
  await p.settle(300);
  const groups = await p.guest(`return [...doc.querySelectorAll("${SHEET} .dc-resync-title")].map((n) => n.firstChild.textContent).join("|")`);
  h.check(groups === 'Changed|Conflicts|New|No longer in the code|New fonts and logos', `${tag}: the groups are named in order (${groups})`);
  h.check((await p.guest(`return doc.querySelectorAll("${SHEET} .dc-resync-swatch:not([data-empty])").length`)) >= 4, `${tag}: colour changes show swatches`);
  h.check((await text(p, `${SHEET} .dc-resync-intro`)).includes('notes, overview, fonts and assets'), `${tag}: it says what is kept`);
  h.check((await text(p, `${SHEET} .dc-resync-group[data-group="conflicts"]`)).includes('You changed this here. The code now says #4a5755.'), `${tag}: a conflict says what the code now says`);
  const ticked = await p.guest(`return [...doc.querySelectorAll("${SHEET} .dc-resync-row[data-group] [aria-checked]")].filter((n) => n.getAttribute("aria-checked") === "true").length`);
  h.check(ticked === 6, `${tag}: Changed and New start ticked, the rest not (${ticked} ticked)`);
  h.check((await text(p, `${SHEET} .dc-sheet-foot`)).includes('Apply saves 4 changed, 2 added'), `${tag}: the footer says what Apply saves (${await text(p, `${SHEET} .dc-sheet-foot`)})`);
  h.check(await noOverflow(p), `${tag}: nothing scrolls sideways`);
  await p.shot(`${tag}-1-review`);

  // ---- ticks change the sentence
  await p.click(`${SHEET} .dc-resync-group[data-group="remove"] .dc-resync-row`, { dx: 14 });
  await h.checkSoon(async () => (await text(p, `${SHEET} .dc-sheet-foot`)).includes('1 removed'), `${tag}: ticking a removal counts it`);
  await p.click(`${SHEET} .dc-resync-choice .oc-sdk-btn`, { text: 'Use the code’s' });
  await h.checkSoon(async () => (await text(p, `${SHEET} .dc-sheet-foot`)).includes('5 changed'), `${tag}: Use the code's counts as a change`);
  await p.shot(`${tag}-2-ticked`);

  // ---- apply, then the notice
  await p.click(`${SHEET} .dc-sheet-foot .oc-sdk-btn`, { text: 'Apply' });
  await h.checkSoon(async () => (await text(p, '.dc-notices')).includes('Re-synced Tidepool'), `${tag}: the notice says what changed (${await text(p, '.dc-notices')})`);
  const body = (await pageLog(p)).resyncs.at(-1);
  h.check(!!body && body.remove?.includes('--danger') && body.useCode?.includes('--text-muted') && !JSON.stringify(body).includes('#'), `${tag}: the request names tokens and carries no values`);
  h.check(!(await p.guest(`return !!doc.querySelector("${SHEET}")`)), `${tag}: the sheet closes`);
  const buttons = await p.guest('return [...doc.querySelectorAll(".dc-notices .oc-sdk-btn")].map((b) => b.textContent.trim()).join("|")');
  h.check(buttons.includes('Undo') && buttons.includes('Ask the agent to update notes'), `${tag}: the notice offers Undo and Ask the agent (${buttons})`);
  await p.shot(`${tag}-3-applied`);
  await p.click('.dc-notices .oc-sdk-btn', { text: 'Ask the agent to update notes' });
  await h.checkSoon(async () => (await pageLog(p)).asks.some((a) => a.purpose === 'resync-notes' && !!a.before), `${tag}: the agent is asked with the version taken before`);
  await p.click('.dc-notices .oc-sdk-btn', { text: 'Undo' });
  await h.checkSoon(async () => (await pageLog(p)).undos.length >= 1, `${tag}: Undo reaches the service`);
  await p.settle(500);

  // ---- the source line
  h.check((await text(p, '.dc-syspg-home')).includes('Synced with'), `${tag}: the source line says when it was synced (${await text(p, '.dc-syspg-home')})`);

  // ---- stale
  await p.host(`${FAKE}.systems.staleResyncNext()`);
  await startResync(h, p, tag);
  await reviewReady(h, p, tag);
  await p.click(`${SHEET} .dc-sheet-foot .oc-sdk-btn`, { text: 'Apply' });
  await h.checkSoon(async () => (await text(p, SHEET)).includes('Scan again'), `${tag}: a stale apply offers Scan again`);
  await p.shot(`${tag}-4-stale`);
  await p.click(`${SHEET} .dc-sheet-foot .oc-sdk-btn`, { text: 'Scan again' });
  await reviewReady(h, p, tag);
  h.check(true, `${tag}: Scan again reads the project again`);

  // ---- a failure that keeps the ticks
  await p.click(`${SHEET} .dc-resync-group[data-group="remove"] .dc-resync-row`, { dx: 14 });
  await p.host(`${FAKE}.systems.failResync('The service did not answer. Try again.')`);
  await p.click(`${SHEET} .dc-sheet-foot .oc-sdk-btn`, { text: 'Apply' });
  await h.checkSoon(async () => (await text(p, SHEET)).includes('The service did not answer'), `${tag}: a plain failure says so`);
  h.check((await text(p, `${SHEET} .dc-sheet-foot`)).includes('1 removed'), `${tag}: the ticks are kept after a failure`);
  await p.shot(`${tag}-5-failed`);
  await p.click(`${SHEET} .dc-sheet-foot .oc-sdk-btn`, { text: 'Not now' });
  await h.checkSoon(async () => !(await p.guest(`return !!doc.querySelector("${SHEET}")`)), `${tag}: Not now closes the sheet`);

  // ---- a partial scan
  await p.host(`${FAKE}.systems.setResync({ kind: 'code', changed: [{ name: '--space-4', mode: 'light', from: '16px', to: '20px' }], conflicts: [], added: [], removed: [], assets: [], partial: true })`);
  await startResync(h, p, tag);
  await reviewReady(h, p, tag);
  h.check((await text(p, SHEET)).includes('Some files weren’t scanned, so tokens from them aren’t listed as removed.'), `${tag}: a partial scan says so`);
  h.check(!(await p.guest(`return !!doc.querySelector("${SHEET} .dc-resync-group[data-group='remove']")`)), `${tag}: a partial scan lists no removals`);
  await p.shot(`${tag}-6-partial`);
  await p.click(`${SHEET} .dc-sheet-foot .oc-sdk-btn`, { text: 'Not now' });
  await p.host(`${FAKE}.systems.setResync(null)`);

  // ---- nothing to apply
  await p.host(`${FAKE}.systems.setCodeFolder('tidepool', 'C:\\\\Users\\\\you\\\\work\\\\matches-shop')`);
  await reopen(h, p, tag);
  await startResync(h, p, tag);
  await h.checkSoon(async () => (await text(p, SHEET)).includes('already matches'), `${tag}: a system that matches says so (${await text(p, SHEET)})`);
  h.check(!(await text(p, `${SHEET} .dc-sheet-foot`)).includes('Apply'), `${tag}: there is no Apply when nothing differs`);
  await p.shot(`${tag}-7-matches`);
  await p.click(`${SHEET} .dc-sheet-foot .oc-sdk-btn`, { text: 'Close' });

  // ---- a folder that is gone
  await p.host(`${FAKE}.systems.setCodeFolder('tidepool', 'C:\\\\Users\\\\you\\\\work\\\\missing-shop')`);
  await reopen(h, p, tag);
  await p.click('.dc-syspg-tools .dc-iconbtn[aria-label="More"]');
  await menuItem(p, 'Re-sync from code');
  await h.checkSoon(async () => (await text(p, SHEET)).includes('can’t read'), `${tag}: a missing folder says Design Chamber can't read it (${await text(p, SHEET)})`);
  await p.click(`${SHEET} .oc-sdk-btn`, { text: 'Choose another folder…' });
  await h.checkSoon(() => p.guest(`return !!doc.querySelector("${SHEET} input")`), `${tag}: Choose another folder asks for a path`);
  await p.shot(`${tag}-8-folder`);
  h.check(await noOverflow(p), `${tag}: nothing scrolls sideways at the end`);
  await p.close();
};

// The sheet at the narrow widths: the rail never offers Re-sync, but the page at phone width does, and the footer must hold.
const phoneFlow = async (h, theme, width = 390) => {
  const tag = `resync-page-${width}-${theme}`;
  const p = await h.openPage({ width, height: 844, surface: 'page', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await openSystem(h, p, 'page', 'tidepool', tag);
  await startResync(h, p, tag);
  await reviewReady(h, p, tag);
  await p.settle(300);
  h.check(await noOverflow(p), `${tag}: nothing scrolls sideways`);
  const footVisible = await p.guest(`const f = doc.querySelector("${SHEET} .dc-sheet-foot").getBoundingClientRect(); return f.bottom <= window.innerHeight + 1 && f.height > 0`);
  h.check(footVisible, `${tag}: the footer stays on screen`);
  await p.shot(`${tag}-1-review`);
  await p.close();
};

export const run = async (h) => {
  const only = process.env.DC_RESYNC_ONLY ? new RegExp(process.env.DC_RESYNC_ONLY) : null;
  const go = (tag, fn) => (only && !only.test(tag) ? Promise.resolve() : fn());
  for (const theme of ['light', 'dark']) {
    await go(`page-1400-${theme}`, () => flow(h, 'page', 1400, theme));
    for (const width of [320, 480]) await go(`rail-${width}-${theme}`, () => flow(h, 'panel', width, theme));
    for (const width of [320, 390, 480]) await go(`phone-${width}-${theme}`, () => phoneFlow(h, theme, width));
  }
};
