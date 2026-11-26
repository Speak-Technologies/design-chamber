// Visual scenario: the full-screen library remembers where the user was across a reload, as the rail
// does. Remembered (host.storage, per surface): the kind tab (`list-tab:page`), the sidebar selection
// (scope `list-scope:page` and the Design systems row, which is the System filter `list-system:page`),
// the sort and the view. Search is not. Things that are gone fall back honestly once the lists have
// loaded (a deleted system reads as All systems, a deleted folder as All designs), a garbled value reads
// as the default, and a remembered system the failed systems list cannot name is "One system", never
// "All systems" while the list is narrowed.

const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
const storageGet = (p, key) => p.host(`JSON.stringify(window.__host.storageGet(${JSON.stringify(key)}) ?? null)`);
const selectedTab = (p) => p.guest('return doc.querySelector(".dc-tabs [role=tab][aria-selected=true]")?.dataset.id ?? null');
const selectLabel = (p, select) => p.guest(`return doc.querySelector(${JSON.stringify(`${select} button`)})?.getAttribute("aria-label") ?? null`);
const cards = (p) => p.guest('return doc.querySelectorAll(".dc-card[data-slug], .dc-list-row[data-slug]").length');
const reload = async (p) => {
  await p.host('document.getElementById("g").contentWindow.location.reload()');
  await p.waitFor('return !!doc.querySelector(".dc-app")', 'the app to mount again');
  await p.settle(700);
};

const remembered = async (h, theme) => {
  const tag = `library-memory-page-1400-${theme}`;
  const p = await h.openPage({
    width: 1400, height: 900, surface: 'page', theme, label: tag,
    storage: { 'list-tab:page': 'page', 'list-system:page': 'system:tidepool', 'list-sort:page': 'title', 'library-view:page': 'list' },
  });
  console.log(tag);
  await p.waitFor('return doc.querySelectorAll(".dc-card[data-slug], .dc-list-row[data-slug]").length >= 1', 'the library rows');
  await p.settle(500);
  h.check((await selectedTab(p)) === 'page', `${tag}: the Pages tab comes back`);
  h.check((await selectLabel(p, '.dc-system-select')) === 'System: Tidepool', `${tag}: the System filter comes back`);
  h.check(await p.guest('return doc.querySelector(".dc-side-row[data-scope=\\"system:tidepool\\"]")?.getAttribute("data-selected") === "true"'), `${tag}: the sidebar's Tidepool row is selected`);
  h.check(await p.guest('return doc.querySelector(".dc-view-toggle-btn[aria-label=\\"View as list\\"]")?.getAttribute("aria-pressed") === "true"') && (await selectLabel(p, '.dc-sort-select')) === 'Sort: Title', `${tag}: the view and the sort come back`);
  h.check((await cards(p)) === 1, `${tag}: the list is Tidepool's one page (${await cards(p)})`);
  h.check(await p.guest('return doc.querySelector(".dc-search input").value === ""'), `${tag}: search starts empty`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow`);
  await p.shot(`${tag}-1-remembered`);

  // A choice made now is what the next open remembers.
  await p.click('.dc-tabs [role=tab]', { text: 'Canvases' });
  await p.click('.dc-side-row .dc-side-main', { text: 'Harbor' });
  await p.settle(300);
  h.check((await storageGet(p, 'list-tab:page')) === '"canvas"' && (await storageGet(p, 'list-system:page')) === '"system:harbor"', `${tag}: picking a tab and a sidebar system writes both`);
  await reload(p);
  h.check((await selectedTab(p)) === 'canvas' && (await selectLabel(p, '.dc-system-select')) === 'System: Harbor', `${tag}: the new choices survive the next reload`);
  await p.close();
};

const goneAndGarbled = async (h) => {
  const tag = 'library-memory-page-1400-dark-gone';
  const p = await h.openPage({
    width: 1400, height: 900, surface: 'page', theme: 'dark', label: tag,
    storage: { 'list-tab:page': 'bogus', 'list-system:page': 'system:ghost', 'list-scope:page': 'folder:f_abcdefghij' },
  });
  console.log(tag);
  await h.listReady(p);
  await p.settle(500);
  h.check((await selectedTab(p)) === 'all', `${tag}: a garbled tab reads as All`);
  h.check((await selectLabel(p, '.dc-system-select')) === 'System: All systems', `${tag}: a system that is gone reads as All systems once the systems loaded`);
  h.check(await p.guest('return doc.querySelector(".dc-side-row[data-selected=\\"true\\"] .dc-side-main")?.textContent?.includes("All designs") === true'), `${tag}: a folder that is gone reads as All designs`);
  h.check((await cards(p)) >= 5, `${tag}: so every design is listed, nothing is hidden by a stale choice`);
  await p.shot(`${tag}-1-fell-back`);
  await p.close();
};

const systemsFailed = async (h) => {
  const tag = 'library-memory-page-1400-dark-systems-failed';
  const p = await h.openPage({
    width: 1400, height: 900, surface: 'page', theme: 'dark', label: tag,
    storage: { 'list-system:page': 'system:tidepool' },
    routes: { 'GET /systems': { status: 500, body: { error: 'internal', message: 'The design systems list could not be read.' } } },
  });
  console.log(tag);
  await p.waitFor('return doc.querySelectorAll(".dc-card[data-slug], .dc-list-row[data-slug]").length >= 1', 'the library rows');
  await p.settle(600);
  h.check((await selectLabel(p, '.dc-system-select')) === 'System: One system', `${tag}: the select does not claim All systems while the list is narrowed (${await selectLabel(p, '.dc-system-select')})`);
  h.check((await cards(p)) === 2, `${tag}: the designs stay narrowed to the remembered system (${await cards(p)})`);
  await p.shot(`${tag}-1-one-system`);
  await p.close();
};

export const run = async (helpers) => {
  for (const theme of ['dark', 'light']) await remembered(helpers, theme);
  await goneAndGarbled(helpers);
  await systemsFailed(helpers);
};
