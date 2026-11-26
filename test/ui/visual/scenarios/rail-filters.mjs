// Visual scenario for the rail's Filters: the button in the header (aria-expanded, hidden by default),
// the compact area with System, Sort and View, the dot that says the list is narrowed, the Titles and
// List views, persistence of all three across a reload (host.storage), Reset filters, the no-match
// empty state with a way out, keyboard use, and the 320 and 480 widths in both themes.

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
const open = async (p) => {
  if ((await p.guest('return doc.querySelector(".dc-filters-btn")?.getAttribute("aria-expanded")')) !== 'true') {
    await p.click('.dc-filters-btn');
    await p.waitFor('return doc.querySelector(".dc-rail-filter-area")?.hidden === false', 'the Filters area');
  }
};
const titles = (p) => p.guest('return JSON.stringify([...doc.querySelectorAll(".dc-rows .dc-row[data-slug] .dc-row-title")].map((n) => n.textContent.trim()))');
const rowCount = (p) => p.guest('return doc.querySelectorAll(".dc-rows .dc-row[data-slug]").length');
const dot = (p) => p.guest('const d = doc.querySelector(".dc-filters-dot"); return !!d && !d.hidden && d.getBoundingClientRect().width > 0');

const railFilters = async (h, width, theme) => {
  const tag = `rail-filters-${width}-${theme}`;
  const p = await h.openPage({ width, height: 780, surface: 'panel', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await h.thumbsReady(p);
  // Coffee and Northwind carry Tidepool by default; Harbor is a system nobody uses yet.

  // -- hidden by default, no dot, the button is a real disclosure
  h.check(await p.guest('const b = doc.querySelector(".dc-filters-btn"); return !!b && b.getAttribute("aria-expanded") === "false" && b.getAttribute("aria-controls") === "dc-rail-filter-area" && b.getAttribute("aria-label") === "Filters"'), `${tag}: the Filters button is collapsed and named`);
  h.check(await p.guest('return doc.querySelector(".dc-rail-filter-area").hidden === true && doc.querySelector(".dc-rail-filter-area").getBoundingClientRect().height === 0'), `${tag}: the area takes no room while closed`);
  const all = await rowCount(p);
  h.check(!(await dot(p)), `${tag}: no dot while nothing is filtered`);
  h.check(await p.guest('return doc.querySelector(".dc-rail-chiprow").hidden === true'), `${tag}: no chip while nothing is filtered`);
  h.check(await p.guest('return !!doc.querySelector(".dc-rail-head .dc-filters-btn")'), `${tag}: the button sits in the rail header`);
  h.check(await p.guest('const r = doc.querySelector(".dc-rail-title").getBoundingClientRect(); return r.width >= 120'), `${tag}: the title keeps its 120 px budget beside the new button`);
  h.check(await p.guest('const n = doc.querySelector(".dc-rail-head .oc-sdk-btn").getBoundingClientRect(); return n.right <= doc.documentElement.clientWidth && n.left >= 0 && [...doc.querySelectorAll(".dc-rail-head > *")].every((e) => e.getBoundingClientRect().right <= doc.documentElement.clientWidth)'), `${tag}: every header control, New included, sits inside the rail`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow, closed`);
  await p.shot(`${tag}-1-closed`);

  // -- opens with the pointer and with the keyboard
  await p.click('.dc-filters-btn');
  await h.checkSoon(() => p.guest('return doc.querySelector(".dc-rail-filter-area").hidden === false && doc.querySelector(".dc-filters-btn").getAttribute("aria-expanded") === "true"'), `${tag}: pressing Filters opens the area`);
  h.check(await p.guest('const a = doc.querySelector(".dc-rail-filter-area"); return !!a.querySelector(".dc-system-select button") && !!a.querySelector(".dc-sort-select button") && a.querySelectorAll(".dc-view-toggle-btn").length === 2'), `${tag}: System, Sort and the two views are in it`);
  h.check(await p.guest('return doc.querySelector(".dc-view-toggle-btn[data-view=list]").getAttribute("aria-pressed") === "true" && doc.querySelector(".dc-view-toggle-btn[data-view=titles]").getAttribute("aria-pressed") === "false"'), `${tag}: List is the default view`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow, open`);
  await p.shot(`${tag}-2-open`);
  // A real <button> in the tab order: the browser gives it Enter and Space (a synthesized key press here does not click one).
  h.check(await p.guest('const b = doc.querySelector(".dc-filters-btn"); b.focus(); return b.tagName === "BUTTON" && b.tabIndex >= 0 && doc.activeElement === b'), `${tag}: the Filters button is a focusable button`);

  // -- the Design systems group in the Show select: one step to a system's designs, the scope stays
  await p.click('.dc-filters-btn');
  await h.checkSoon(() => p.guest('return doc.querySelector(".dc-rail-filter-area").hidden === true'), `${tag}: the area is closed for the Show select checks`);
  await p.click('.dc-rail-show-select button');
  await p.waitFor('return !!doc.querySelector(".oc-sdk-popup [role=option]")', 'the Show options');
  h.check(await p.guest('const o = [...doc.querySelectorAll(".oc-sdk-popup [role=option]")].map((n) => n.textContent.trim()); const i = o.findIndex((t) => t.startsWith("System · ")); return i > 0 && o.filter((t) => t.startsWith("System · ")).length === 5 && o[o.length - 1].startsWith("New folder")'), `${tag}: the Show select lists the systems as one group, before New folder`);
  await p.shot(`${tag}-0-show-systems`);
  await p.click('.oc-sdk-popup [role=option]', { text: 'System · Tidepool' });
  await h.checkSoon(async () => (await rowCount(p)) === 2, `${tag}: picking System · Tidepool in Show leaves its two designs, in one step`);
  h.check(await p.guest('return doc.querySelector(".dc-rail-show-select button").getAttribute("aria-label") === "Show: All designs"'), `${tag}: the scope is still All designs`);
  h.check(await p.guest('const c = doc.querySelector(".dc-rail-chiprow"); return !c.hidden && c.textContent.trim() === "Tidepool" && !!c.querySelector("button[aria-label=\\"Remove the Tidepool system filter\\"]")'), `${tag}: a Tidepool chip sits under the header while Filters is closed`);
  h.check((await storageGet(p, 'list-system:panel')) === '"system:tidepool"', `${tag}: the pick is remembered`);
  await p.shot(`${tag}-0b-show-picked-chip`);
  await p.click('.dc-filters-btn');
  await h.checkSoon(() => p.guest('return doc.querySelector(".dc-rail-chiprow").hidden === true && doc.querySelector(".dc-system-select button").getAttribute("aria-label") === "System: Tidepool"'), `${tag}: opening Filters hides the chip and the System select already reads Tidepool`);
  await p.click('.dc-filters-btn');
  await p.click('.dc-filter-chip-x');
  await h.checkSoon(async () => (await rowCount(p)) === all, `${tag}: the chip's × clears the filter`);
  h.check(await p.guest('return doc.querySelector(".dc-rail-chiprow").hidden === true && doc.activeElement === doc.querySelector(".dc-filters-btn")') && (await storageGet(p, 'list-system:panel')) === '"all"', `${tag}: the chip goes, focus lands on Filters and the stored system is cleared`);
  await open(p);

  // -- the system filter narrows the list and the dot says so while the area is closed
  await pickOption(p, '.dc-rail-filter-area .dc-system-select', 'Tidepool');
  await h.checkSoon(async () => (await rowCount(p)) === 2, `${tag}: Tidepool leaves its two designs (had ${all})`);
  h.check(await dot(p), `${tag}: the dot shows once a system filter is on`);
  h.check(await p.guest('return /^Filters, on\\. Showing designs that use Tidepool/.test(doc.querySelector(".dc-filters-btn").getAttribute("aria-label"))'), `${tag}: the button's name says what is filtered`);
  await p.click('.dc-filters-btn');
  await h.checkSoon(() => p.guest('return doc.querySelector(".dc-rail-filter-area").hidden === true'), `${tag}: the area closes`);
  h.check(await dot(p), `${tag}: the dot stays while the area is closed`);
  h.check(await p.guest('const c = doc.querySelector(".dc-rail-chiprow"); return !c.hidden && c.textContent.trim() === "Tidepool"'), `${tag}: the chip names the system while the area is closed, so the short list is explained`);
  await p.shot(`${tag}-3-filtered-closed`);

  // -- titles: one line, title only; persists
  await open(p);
  await p.click('.dc-view-toggle-btn[data-view=titles]');
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-rows .dc-row-titles").length === 2'), `${tag}: Titles draws one-line rows`);
  h.check(await p.guest('return !doc.querySelector(".dc-rows .dc-thumb") && !doc.querySelector(".dc-rows .dc-row-meta") && !doc.querySelector(".dc-rows .dc-design-system-chip")'), `${tag}: no thumbnail, kind line or chip in Titles`);
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-rows .dc-row-titles")].every((r) => r.getBoundingClientRect().height <= 36)'), `${tag}: each Titles row is one line`);
  h.check((await storageGet(p, 'rail-view:panel')) === '"titles"', `${tag}: the view is written to rail-view:panel`);
  h.check((await storageGet(p, 'list-system:panel')) === '"system:tidepool"', `${tag}: the System filter is written to list-system:panel`);
  await p.shot(`${tag}-4-titles`);
  // A title row still opens the design and still has its menu.
  h.check(await p.guest('const r = doc.querySelector(".dc-rows .dc-row-titles"); return r.querySelector(".dc-row-main").getAttribute("aria-label").includes("uses Tidepool") && !!r.querySelector(".dc-iconbtn[aria-label^=\\"Actions for\\"]")'), `${tag}: a Titles row keeps its full name for screen readers and its ⋯ menu`);

  // -- sort works in Titles
  await pickOption(p, '.dc-rail-filter-area .dc-sort-select', 'Title');
  const sorted = JSON.parse(await titles(p));
  h.check(sorted.length === 2 && sorted[0].localeCompare(sorted[1], undefined, { sensitivity: 'base' }) <= 0, `${tag}: Title sort puts them A to Z (${sorted.join(', ')})`);
  await pickOption(p, '.dc-rail-filter-area .dc-sort-select', 'Created');
  h.check((await storageGet(p, 'list-sort:panel')) === '"created"', `${tag}: the sort is written to list-sort:panel`);

  // -- all three survive a reload; the area is closed again
  await reload(p);
  await p.waitFor('return doc.querySelectorAll(".dc-row[data-slug]").length >= 1', 'the list rows');
  h.check(await p.guest('return doc.querySelector(".dc-rail-filter-area").hidden === true'), `${tag}: the area is closed after a reload`);
  await h.checkSoon(async () => (await rowCount(p)) === 2 && (await p.guest('return doc.querySelectorAll(".dc-rows .dc-row-titles").length')) === 2, `${tag}: Titles and the system filter survive the reload`);
  h.check(await dot(p), `${tag}: the dot is back after the reload`);
  await open(p);
  h.check(await p.guest('return doc.querySelector(".dc-sort-select button").getAttribute("aria-label") === "Sort: Created" && doc.querySelector(".dc-system-select button").getAttribute("aria-label") === "System: Tidepool" && doc.querySelector(".dc-view-toggle-btn[data-view=titles]").getAttribute("aria-pressed") === "true"'), `${tag}: the controls read what was chosen`);

  // -- a filter that matches nothing: the empty state names it and offers the way out
  await pickOption(p, '.dc-rail-filter-area .dc-system-select', 'Harbor');
  await p.type('.dc-search input', 'zzzz');
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".oc-sdk-empty-title")'), `${tag}: nothing matching shows the empty state`);
  h.check(await p.guest('return /zzzz/.test(doc.querySelector(".oc-sdk-empty-title").textContent) && /Harbor/.test(doc.querySelector(".oc-sdk-empty-title").textContent)'), `${tag}: the empty state names the search and the system`);
  await p.shot(`${tag}-5-no-match`);
  await p.click('.oc-sdk-empty-action .oc-sdk-btn', { text: 'Clear filters' });
  await h.checkSoon(async () => (await rowCount(p)) >= 4, `${tag}: Clear filters brings the designs back`);
  h.check(!(await dot(p)) && (await storageGet(p, 'list-system:panel')) === '"all"', `${tag}: clearing drops the dot and the stored system`);
  h.check(await p.guest('return !!doc.querySelector(".dc-rows .dc-row-titles")'), `${tag}: clearing keeps the view`);

  // -- Reset filters puts system, sort and view back
  await p.settle(200);
  await h.checkSoon(() => p.guest('return doc.querySelector(".dc-rail-filter-reset").hidden === false'), `${tag}: Reset filters is offered while a choice differs from the defaults`);
  await p.click('.dc-rail-filter-reset .oc-sdk-btn');
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-rows .dc-row-titles").length === 0 && doc.querySelector(".dc-rail-filter-reset").hidden === true'), `${tag}: Reset filters returns to List and hides itself`);
  h.check((await storageGet(p, 'rail-view:panel')) === '"list"' && (await storageGet(p, 'list-sort:panel')) === '"updated"', `${tag}: the stored view and sort are reset`);
  h.check(await p.guest('const a = doc.activeElement; return !!a && a !== doc.body && (!!a.closest(".dc-rail-filter-area") || a.classList.contains("dc-filters-btn"))'), `${tag}: Reset filters hides itself, and focus stays in the Filters area instead of falling to the page`);
  await p.shot(`${tag}-6-reset`);
  await p.close();
};

// A system that is gone from the list reads as All systems once the list has loaded, without ever
// reading as gone while the list is still on its way.
const goneSystem = async (h) => {
  const tag = 'rail-filters-320-dark-gone';
  const p = await h.openPage({ width: 320, height: 780, surface: 'panel', theme: 'dark', label: tag, storage: { 'list-system:panel': 'system:no-such-system', 'rail-view:panel': 'titles' } });
  console.log(tag);
  await h.listReady(p);
  await h.checkSoon(async () => (await rowCount(p)) >= 4, `${tag}: a remembered system that is gone lists every design`);
  h.check(!(await dot(p)), `${tag}: and the dot stays off`);
  h.check(await p.guest('return doc.querySelectorAll(".dc-rows .dc-row-titles").length >= 4'), `${tag}: the remembered Titles view still applies`);
  await p.close();
};

// KI-30: the systems list cannot be read but a system filter is remembered. The select, its name and the
// Filters button agree ("One system"), the chip says so, and the designs are still narrowed.
const failedSystems = async (h) => {
  const tag = 'rail-filters-320-dark-systems-failed';
  const p = await h.openPage({
    width: 320, height: 780, surface: 'panel', theme: 'dark', label: tag,
    storage: { 'list-system:panel': 'system:tidepool' },
    routes: { 'GET /systems': { status: 500, body: { error: 'internal', message: 'The design systems list could not be read.' } } },
  });
  console.log(tag);
  await p.waitFor('return doc.querySelectorAll(".dc-row[data-slug]").length >= 1', 'the list rows');
  await p.settle(600);
  h.check(await dot(p), `${tag}: the list is still narrowed and the dot says so`);
  h.check(await p.guest('const c = doc.querySelector(".dc-rail-chiprow"); return !c.hidden && c.textContent.trim() === "One system" && !!c.querySelector("button[aria-label=\\"Remove the system filter\\"]")'), `${tag}: the chip is honest about not knowing the name`);
  await open(p);
  h.check(await p.guest('return doc.querySelector(".dc-system-select button").getAttribute("aria-label") === "System: One system"'), `${tag}: the System select does not claim All systems (${await p.guest('return doc.querySelector(".dc-system-select button").getAttribute("aria-label")')})`);
  h.check(await p.guest('return !doc.querySelector(".dc-rail-show-select button").getAttribute("aria-label").includes("System")') && (await noOverflow(p)), `${tag}: no systems group without systems, no overflow`);
  await p.shot(`${tag}-1-open`);
  await p.click('.dc-rail-filter-reset .oc-sdk-btn');
  await h.checkSoon(async () => !(await dot(p)), `${tag}: Reset filters clears it`);
  await p.close();
};

// The kind tab is remembered like the rest (`list-tab:panel`), the rail has no Systems tab, and a failed systems
// refresh keeps a remembered System filter (KI-31).
const tabAndRefresh = async (h) => {
  const tag = 'rail-filters-320-dark-tab';
  const p = await h.openPage({ width: 320, height: 780, surface: 'panel', theme: 'dark', label: tag, storage: { 'list-tab:panel': 'page', 'list-system:panel': 'system:tidepool' } });
  console.log(tag);
  await p.waitFor('return doc.querySelectorAll(".dc-row[data-slug]").length >= 1', 'the list rows');
  await p.settle(600);
  h.check(await p.guest('return doc.querySelector(".dc-tabs [role=tab][aria-selected=true]")?.dataset.id === "page"') && (await rowCount(p)) === 1, `${tag}: the remembered Pages tab comes back (${await rowCount(p)} row)`);
  await p.click('.dc-tabs [role=tab]', { text: 'Canvases' });
  h.check((await storageGet(p, 'list-tab:panel')) === '"canvas"', `${tag}: picking a tab writes list-tab:panel`);
  // A failed refresh of the systems list keeps the filter, the dot and the chip.
  await p.host('window.frames[0].__dcFake.systems.failLoads(true)');
  await p.host('window.frames[0].__dcFake.systems.addUnreadable()'); // a systems change event: the store re-reads, and the read fails
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-rail-chiprow")'), `${tag}: the list is still there`);
  await p.settle(900);
  h.check((await dot(p)) && (await p.guest('return doc.querySelector(".dc-rail-chiprow").textContent.trim() === "Tidepool"')), `${tag}: a failed systems refresh keeps the System filter, the dot and the chip with the name`);
  await p.click('.dc-tabs [role=tab]', { text: 'All' });
  h.check((await storageGet(p, 'list-tab:panel')) === '"all"', `${tag}: All is written back`);
  await reload(p);
  await p.settle(300);
  await p.close();
  const stale = await h.openPage({ width: 320, height: 780, surface: 'panel', theme: 'dark', label: `${tag}-stale`, storage: { 'list-tab:panel': 'system' } });
  await stale.waitFor('return doc.querySelectorAll(".dc-row[data-slug]").length >= 5', 'the list rows');
  h.check(await stale.guest('return doc.querySelector(".dc-tabs [role=tab][aria-selected=true]")?.dataset.id === "all"'), `${tag}: a stored Systems tab reads as All on the rail`);
  await stale.close();
};

export const run = async (helpers) => {
  for (const width of [320, 480]) for (const theme of ['dark', 'light']) await railFilters(helpers, width, theme);
  await goneSystem(helpers);
  await failedSystems(helpers);
  await tabAndRefresh(helpers);
};
