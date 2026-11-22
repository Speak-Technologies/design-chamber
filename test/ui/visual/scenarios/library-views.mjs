// Visual scenario for Phase 2.6 L1a (library views): the page's Tiles/List toggle and Sort
// persisted across a reload (storage seed and __host.storageGet), Sort persisted per surface,
// the System filter (Draft marked, No system, a filter that hides everything), the empty state
// that names every active filter with Clear filters keeping the scope, the gear on both surfaces
// with its accessible name, the rail at 320 and 480 (the title keeps its 120 px budget), light and
// dark, and the loading, couldn't-load, first-run and systems-failed states. The approved canvas
// (Designs/phase-2-6-library-ui) is the visual authority. System tiles, chips and the Systems tab
// arrive with L1b and are not drawn here.

const FAKE = 'window.frames[0].__dcFake';
const ROOT = 'C:\\Users\\you\\Documents\\Designs';

const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
const storageGet = (p, key) => p.host(`JSON.stringify(window.__host.storageGet(${JSON.stringify(key)}) ?? null)`);
const reload = async (p) => {
  await p.host('document.getElementById("g").contentWindow.location.reload()');
  await p.waitFor('return !!doc.querySelector(".dc-app")', 'the app to mount again');
  await p.settle(500);
};
const pickOption = async (p, select, text) => {
  await p.click(`${select} button`);
  await p.waitFor('return !!doc.querySelector(".oc-sdk-popup [role=option]")', 'the select options');
  await p.click('.oc-sdk-popup [role=option]', { text });
  await p.settle(250);
};
const firstTitle = (p, surface) =>
  p.guest(`return doc.querySelector(${surface === 'page' ? '".dc-card .dc-card-title, .dc-list-row .dc-row-title"' : '".dc-rows .dc-row-title"'})?.textContent?.trim() ?? null`);
const rowCount = (p) => p.guest('return doc.querySelectorAll(".dc-row[data-slug], .dc-card[data-slug]").length');
const emptyTitle = (p) => p.guest('return doc.querySelector(".oc-sdk-empty-title")?.textContent?.trim() ?? null');
const chipLabels = (p) => p.guest('return JSON.stringify([...doc.querySelectorAll(".dc-empty-chip")].map((n) => n.textContent.trim()))');

/** Coffee and Northwind carry Tidepool by default; four designs have no system. */
const linkWorld = async (p) => {
  await p.host(`${FAKE}.designSystem.link('coffee-subscription', 'harbor')`);
  await p.settle(400);
};
const seedFolder = async (p) => {
  const id = await p.host(`${FAKE}.folders.seed('Q4 launch', ['coffee-subscription'])`);
  await p.host(`${FAKE}.folders.changed()`);
  await p.settle(400);
  return id;
};

// ---------------------------------------------------------------- the page, both themes

const pageViews = async (h, theme) => {
  const tag = `library-views-page-1400-${theme}`;
  const p = await h.openPage({
    width: 1400, height: 900, surface: 'page', theme, label: tag,
    storage: { 'library-view:page': 'list', 'list-sort:page': 'title' },
  });
  console.log(tag);
  await h.listReady(p);
  await h.thumbsReady(p);

  // The seeded preferences land: List view, Title sort.
  h.check(await p.guest('return doc.querySelector(".dc-view-toggle-btn[aria-label=\\"View as list\\"]")?.getAttribute("aria-pressed") === "true" && !doc.querySelector(".dc-grid").offsetParent'), `${tag}: the stored view opens as List`);
  h.check(await p.guest('return !!doc.querySelector(".dc-list-head") && /Name/.test(doc.querySelector(".dc-list-head").textContent) && /Updated/.test(doc.querySelector(".dc-list-head").textContent)'), `${tag}: the list has its column head`);
  h.check((await firstTitle(p, 'page')) === 'Coffee subscription', `${tag}: Title sort orders A–Z (${await firstTitle(p, 'page')})`);
  h.check(await p.guest('return doc.querySelector(".dc-page-count")?.textContent?.trim() === "6 designs and 5 systems"'), `${tag}: the header counts designs and systems (${await p.guest('return doc.querySelector(".dc-page-count")?.textContent?.trim()')})`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow in List view`);
  await p.shot(`${tag}-1-list`);

  // The gear: icon only, named Settings, opens the sheet.
  h.check(await p.guest('const b = doc.querySelector(".dc-library-bar .dc-iconbtn[aria-label=\\"Settings\\"]"); return !!b && b.title === "Settings" && !b.textContent.trim()'), `${tag}: the gear is icon-only with the accessible name Settings`);
  await p.click('.dc-library-bar .dc-iconbtn[aria-label="Settings"]');
  await p.waitFor('return !!doc.querySelector(".dc-settings")', 'settings');
  await p.key('Escape');

  // Tiles toggle persists across a reload.
  await p.click('.dc-view-toggle-btn[aria-label="View as tiles"]');
  await h.checkSoon(() => p.guest('return doc.querySelector(".dc-view-toggle-btn[aria-label=\\"View as tiles\\"]")?.getAttribute("aria-pressed") === "true" && !!doc.querySelector(".dc-card[data-slug]")'), `${tag}: the toggle switches to Tiles`);
  h.check((await storageGet(p, 'library-view:page')) === '"tiles"', `${tag}: the view is written to host.storage`);
  await p.shot(`${tag}-2-tiles`);
  await reload(p);
  await h.listReady(p);
  h.check(await p.guest('return doc.querySelector(".dc-view-toggle-btn[aria-label=\\"View as tiles\\"]")?.getAttribute("aria-pressed") === "true" && !!doc.querySelector(".dc-card[data-slug]")'), `${tag}: Tiles survives the reload`);

  // Sort persists per surface, across a reload.
  await pickOption(p, '.dc-sort-select', 'Created');
  await h.checkSoon(async () => (await firstTitle(p, 'page')) === 'Onboarding flow', `${tag}: Created sort puts the newest first (${await firstTitle(p, 'page')})`);
  h.check((await storageGet(p, 'list-sort:page')) === '"created"', `${tag}: the page sort is written to host.storage`);
  await reload(p);
  await h.listReady(p);
  h.check((await firstTitle(p, 'page')) === 'Onboarding flow', `${tag}: Created survives the reload`);
  h.check((await storageGet(p, 'list-sort:panel')) === 'null', `${tag}: the rail's sort key is untouched (per surface)`);

  // The System filter: Draft marked in the options, Tidepool's designs, No system, and a filter
  // that hides everything (Acme has no designs) with its own empty sentence.
  await p.click('.dc-system-select button');
  await p.waitFor('return !!doc.querySelector(".oc-sdk-popup [role=option]")', 'the system options');
  h.check(await p.guest('const o = [...doc.querySelectorAll(".oc-sdk-popup [role=option]")]; const acme = o.find((n) => n.textContent.includes("Acme")); const tide = o.find((n) => n.textContent.includes("Tidepool")); return !!acme && /Draft/.test(acme.textContent) && !!tide && /4/.test(tide.textContent) && o[0].textContent.includes("All systems") && o[o.length - 1].textContent.includes("No system")'), `${tag}: the options mark Draft and the used-by count, All systems first, No system last`);
  await p.shot(`${tag}-3-system-options`);
  await p.click('.oc-sdk-popup [role=option]', { text: 'Tidepool' });
  await h.checkSoon(async () => (await rowCount(p)) === 2, `${tag}: Tidepool leaves its two designs`);
  await pickOption(p, '.dc-system-select', 'No system');
  await h.checkSoon(async () => (await rowCount(p)) === 4, `${tag}: No system leaves the four unlinked designs`);
  await pickOption(p, '.dc-system-select', 'Acme');
  await h.checkSoon(async () => (await emptyTitle(p)) === 'No designs with the Acme system.', `${tag}: a system with no designs says so (${await emptyTitle(p)})`);
  h.check((await chipLabels(p)) === JSON.stringify(['System: Acme']), `${tag}: the chip names the system filter`);
  await p.shot(`${tag}-4-system-empty`);
  await p.click('.oc-sdk-empty-action .oc-sdk-btn', { text: 'Clear filters' });
  await h.checkSoon(async () => (await rowCount(p)) === 6, `${tag}: Clear filters brings every design back`);
  h.check(await p.guest('return doc.querySelector(".dc-system-select button")?.getAttribute("aria-label") === "System: All systems"'), `${tag}: the select reads All systems again`);

  // Every active filter at once: folder scope, search, kind tab, system. The sentence names them
  // all, the chips name them again, and Clear filters keeps the folder.
  await seedFolder(p);
  await linkWorld(p);
  await p.click('.dc-side-row .dc-side-main', { text: 'Q4 launch' });
  await h.checkSoon(async () => (await rowCount(p)) === 1, `${tag}: the folder scope shows its one design`);
  h.check(await p.guest('return doc.querySelector(".dc-page-count")?.textContent?.trim() === "Q4 launch · 1 design"'), `${tag}: the scoped count line names the folder (the sidebar may be closed)`);
  await p.type('.dc-search input', 'hero');
  await p.click('.dc-tabs [role=tab]', { text: 'Pages' });
  await pickOption(p, '.dc-system-select', 'Harbor');
  await h.checkSoon(async () => (await emptyTitle(p)) === 'No designs in Q4 launch match “hero” with the Harbor system.', `${tag}: the sentence names scope, search and system (${await emptyTitle(p)})`);
  h.check((await chipLabels(p)) === JSON.stringify(['Folder: Q4 launch', 'Search: hero', 'Pages', 'System: Harbor']), `${tag}: the chips name all four filters`);
  h.check(await p.guest('const fixed = doc.querySelector(".dc-empty-chip[data-fixed=\\"true\\"]"); return !!fixed && !fixed.querySelector("button") && doc.querySelectorAll(".dc-empty-chip-x").length === 3'), `${tag}: the scope chip is fixed; the other three clear on their own`);
  h.check(await p.guest('return doc.querySelector(".oc-sdk-empty-body")?.textContent?.trim() === "Try another word, or clear the filters. Q4 launch stays selected."'), `${tag}: the body says the scope stays`);
  await p.shot(`${tag}-5-no-matches`);
  // One chip clears just its own filter.
  await p.click('.dc-empty-chip-x[aria-label="Clear search"]');
  await h.checkSoon(async () => (await emptyTitle(p)) === 'No designs in Q4 launch with the Harbor system.', `${tag}: clearing the search chip keeps the other filters (${await emptyTitle(p)})`);
  await p.click('.oc-sdk-empty-action .oc-sdk-btn', { text: 'Clear filters' });
  await h.checkSoon(async () => (await rowCount(p)) === 1, `${tag}: Clear filters keeps the folder and shows its design`);
  h.check(await p.guest('return doc.querySelector(".dc-side-row[data-selected=\\"true\\"] .dc-side-main")?.textContent?.includes("Q4 launch") === true && doc.querySelector(".dc-search input").value === "" && doc.querySelector(".dc-tabs [role=tab][aria-selected=true]")?.dataset.id === "all"'), `${tag}: the folder stays selected; search and tab are cleared`);
  await p.shot(`${tag}-6-cleared`);
  await p.close();
};

// ---------------------------------------------------------------- the rail, 320 and 480, both themes

const railViews = async (h, width, theme) => {
  const tag = `library-views-rail-${width}-${theme}`;
  const p = await h.openPage({ width, height: 780, surface: 'panel', theme, label: tag, storage: { 'list-sort:panel': 'title' } });
  console.log(tag);
  await h.listReady(p);
  await h.thumbsReady(p);

  h.check(await p.guest('return !!doc.querySelector(".dc-rail-head .dc-iconbtn[aria-label=\\"Settings\\"]")'), `${tag}: the gear is on the rail head, named Settings`);
  h.check(await p.guest('return !!doc.querySelector(".dc-rail-pair .dc-system-select, .dc-rail-pair .dc-inline-select") && doc.querySelectorAll(".dc-rail-pair .dc-inline-select").length === 2'), `${tag}: System and Sort sit side by side under Show`);
  h.check((await firstTitle(p, 'rail')) === 'Coffee subscription', `${tag}: the seeded Title sort lands (${await firstTitle(p, 'rail')})`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow`);
  if (width === 320) {
    h.check(await p.guest('const r = doc.querySelector(".dc-rail-title").getBoundingClientRect(); return r.width >= 120'), `${tag}: the title keeps its 120 px budget at 320`);
  }
  await p.shot(`${tag}-1-list`);

  // Sort persists on the rail's own key.
  await pickOption(p, '.dc-rail-pair .dc-sort-select', 'Updated');
  await h.checkSoon(async () => (await firstTitle(p, 'rail')) === 'Onboarding flow', `${tag}: Updated sort puts the newest first`);
  h.check((await storageGet(p, 'list-sort:panel')) === '"updated"', `${tag}: the rail sort is written to its own key`);
  await reload(p);
  await h.listReady(p);
  h.check((await firstTitle(p, 'rail')) === 'Onboarding flow', `${tag}: the rail sort survives the reload`);

  // The System filter composes with the scope.
  await pickOption(p, '.dc-rail-pair .dc-system-select', 'Tidepool');
  await h.checkSoon(async () => (await rowCount(p)) === 2, `${tag}: Tidepool leaves its two designs`);
  await pickOption(p, '.dc-rail-pair .dc-system-select', 'All systems');
  await h.checkSoon(async () => (await rowCount(p)) === 6, `${tag}: All systems brings them back`);

  // The empty state at rail width: every filter named, Clear filters keeps the folder.
  await seedFolder(p);
  await linkWorld(p);
  await pickOption(p, '.dc-rail-show-select', 'Folder · Q4 launch');
  await h.checkSoon(async () => (await rowCount(p)) === 1, `${tag}: the Show select scopes to the folder`);
  await p.type('.dc-search input', 'hero');
  await p.click('.dc-tabs [role=tab]', { text: 'Pages' });
  await pickOption(p, '.dc-rail-pair .dc-system-select', 'Harbor');
  await h.checkSoon(async () => (await emptyTitle(p)) === 'No designs in Q4 launch match “hero” with the Harbor system.', `${tag}: the sentence names scope, search and system (${await emptyTitle(p)})`);
  h.check((await chipLabels(p)) === JSON.stringify(['Folder: Q4 launch', 'Search: hero', 'Pages', 'System: Harbor']), `${tag}: the chips name all four filters`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow with the empty state`);
  await p.shot(`${tag}-2-no-matches`);
  await p.click('.oc-sdk-empty-action .oc-sdk-btn', { text: 'Clear filters' });
  await h.checkSoon(async () => (await rowCount(p)) === 1, `${tag}: Clear filters keeps the folder`);
  h.check(await p.guest('return doc.querySelector(".dc-rail-show-select button")?.getAttribute("aria-label") === "Show: Folder · Q4 launch"'), `${tag}: the Show select still reads the folder`);
  await p.close();
};

// ---------------------------------------------------------------- loading, error, first run, systems failed

const pageStates = async (h) => {
  // Loading: skeletons keep the tile shape; the toolbar stays put. The delayed answer is a valid
  // empty list, so the state resolves to the first-run empty (the error page below covers designs
  // arriving after a failure).
  const loadingTag = 'library-views-page-loading-dark';
  const loading = await h.openPage({ width: 1400, height: 900, surface: 'page', theme: 'dark', label: loadingTag, routes: { 'GET /designs': { delayMs: 2500, body: { root: ROOT, designs: [], loose: { files: [], total: 0 }, projectFolders: [] } } } });
  console.log(loadingTag);
  await loading.waitFor('return doc.querySelectorAll(".dc-card-skeleton").length >= 4', 'the tile skeletons');
  h.check(await loading.guest('return doc.querySelector(".dc-library-scroll")?.getAttribute("aria-busy") === "true" && !!doc.querySelector(".dc-library-controls")'), `${loadingTag}: skeletons with aria-busy; the toolbar stays`);
  await loading.shot(`${loadingTag}-1-skeletons`);
  await h.checkSoon(() => loading.guest('return doc.querySelectorAll(".dc-card-skeleton").length === 0 && doc.querySelector(".oc-sdk-empty-title")?.textContent?.trim() === "No designs yet"'), `${loadingTag}: the skeletons resolve when the answer lands`, 10000);
  await loading.close();

  // Couldn't load: the plain sentence, the way forward, Try again.
  const errorTag = 'library-views-page-error-dark';
  const error = await h.openPage({ width: 1400, height: 900, surface: 'page', theme: 'dark', label: errorTag, routes: { 'GET /designs': { status: 500, body: { error: 'internal', message: 'The local service did not answer.' } } } });
  console.log(errorTag);
  await error.waitFor('return [...doc.querySelectorAll(".dc-banner")].some((n) => /Your designs didn’t load/.test(n.textContent))', 'the error banner');
  h.check(await error.guest('const b = [...doc.querySelectorAll(".dc-banner")].find((n) => /Your designs didn’t load/.test(n.textContent)); return !!b && /Your folders and filters are kept\\./.test(b.textContent) && [...b.querySelectorAll(".oc-sdk-btn")].some((n) => n.textContent.trim() === "Try again")'), `${errorTag}: the sentence says what happened and that filters are kept, with Try again`);
  await error.shot(`${errorTag}-1-error`);
  await error.route('GET /designs', null);
  await error.click('.dc-grid-message .dc-banner .oc-sdk-btn', { text: 'Try again' });
  await h.checkSoon(() => error.guest('return doc.querySelectorAll(".dc-card[data-slug]").length >= 5'), `${errorTag}: Try again loads the designs`);
  await error.close();

  // First run: no designs yet, with the way to make one.
  const firstTag = 'library-views-page-first-run-dark';
  const first = await h.openPage({ width: 1400, height: 900, surface: 'page', theme: 'dark', label: firstTag, routes: { 'GET /designs': { status: 200, body: { root: ROOT, designs: [], loose: { files: [], total: 0 }, projectFolders: [] } } } });
  console.log(firstTag);
  await first.waitFor('return !!doc.querySelector(".oc-sdk-empty")', 'the first-run empty state');
  h.check(await first.guest('return doc.querySelector(".oc-sdk-empty-title")?.textContent?.trim() === "No designs yet" && /\\/design or \\/page/.test(doc.querySelector(".oc-sdk-empty-body")?.textContent ?? "") && [...doc.querySelectorAll(".oc-sdk-empty-action .oc-sdk-btn")].some((n) => n.textContent.trim() === "New canvas")'), `${firstTag}: No designs yet, how to make one, New canvas`);
  await first.shot(`${firstTag}-1-first-run`);
  await first.close();

  // Systems failed: the designs still list; the System select keeps All systems / No system only.
  const sysTag = 'library-views-page-systems-failed-dark';
  const sys = await h.openPage({ width: 1400, height: 900, surface: 'page', theme: 'dark', label: sysTag, routes: { 'GET /systems': { status: 500, body: { error: 'internal', message: 'The design systems list could not be read.' } } } });
  console.log(sysTag);
  await h.listReady(sys);
  await sys.click('.dc-system-select button');
  await sys.waitFor('return !!doc.querySelector(".oc-sdk-popup [role=option]")', 'the system options');
  h.check(await sys.guest('const o = [...doc.querySelectorAll(".oc-sdk-popup [role=option]")].map((n) => n.textContent.trim()); return JSON.stringify(o) === JSON.stringify(["All systems", "No system"])'), `${sysTag}: a failed systems load leaves All systems and No system only`);
  await sys.key('Escape');
  h.check(await sys.guest('return doc.querySelector(".dc-page-count")?.textContent?.trim() === "6 designs"'), `${sysTag}: the header counts designs only`);
  await sys.shot(`${sysTag}-1-systems-failed`);
  await sys.close();
};

export const run = async (helpers) => {
  for (const theme of ['dark', 'light']) await pageViews(helpers, theme);
  for (const width of [320, 480]) for (const theme of ['dark', 'light']) await railViews(helpers, width, theme);
  await pageStates(helpers);
};
