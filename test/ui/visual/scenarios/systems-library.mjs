// Visual scenario for Phase 2.6 L1b (design systems in the library): system tiles mixed into the
// All tab by the sort and alone on the Systems tab, the lead tile under a System filter, the chip on
// every design (open, Draft, deleted toast), the used-by link landing on a filtered library (from a
// tile, a rail row and the Design systems list), the sidebar's Design systems section (heading opens
// the list, rows set the filter and keep the scope), the Living page button, the List view's system
// rows, the rail at 320 and 480 with four tabs, the empty, folder and failed Systems tab, light and
// dark. The approved canvas (Designs/phase-2-6-library-ui) is the visual authority.

const FAKE = 'window.frames[0].__dcFake';

const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
const toastTexts = (p) => p.host('JSON.stringify(window.__host.toasts.map((t) => t.message))');
const text = (p, selector) => p.guest(`return doc.querySelector(${JSON.stringify(selector)})?.textContent?.replace(/\\s+/g, " ").trim() ?? null`);
const count = (p, selector) => p.guest(`return doc.querySelectorAll(${JSON.stringify(selector)}).length`);
const pickOption = async (p, select, label) => {
  await p.click(`${select} button`);
  await p.waitFor('return !!doc.querySelector(".oc-sdk-popup [role=option]")', 'the select options');
  await p.click('.oc-sdk-popup [role=option]', { text: label });
  await p.settle(250);
};
const selectLabel = (p, select) => p.guest(`return doc.querySelector(${JSON.stringify(`${select} button`)})?.getAttribute("aria-label") ?? null`);
/** The items in grid or list order, as "d" for a design and "s" for a system. */
const order = (p) => p.guest('return [...doc.querySelectorAll(".dc-grid > li, .dc-library-list > li, .dc-rows > li")].filter((n) => n.dataset.slug || n.dataset.systemId || n.dataset.id).map((n) => (n.dataset.slug ? "d" : "s")).join("")');
const tabText = (p, id) => p.guest(`return doc.querySelector('.dc-tabs [role=tab][data-id="${id}"]')?.textContent?.replace(/\\s+/g, "") ?? null`);

const seedFolder = async (p) => {
  const id = await p.host(`${FAKE}.folders.seed('Q4 launch', ['coffee-subscription'])`);
  await p.host(`${FAKE}.folders.changed()`);
  await p.settle(400);
  return id;
};
const linkWorld = async (p) => {
  // Northwind uses a Draft system and Onboarding one that was deleted: both chips drawn.
  await p.host(`${FAKE}.designSystem.link('northwind-pricing', 'acme')`);
  await p.host(`${FAKE}.designSystem.link('onboarding-flow', 'ghost')`);
  // Two designs use Harbor, so filtering to it has something to lead.
  await p.host(`${FAKE}.designSystem.link('launch-announcement', 'harbor')`);
  await p.host(`${FAKE}.designSystem.link('habit-tracker', 'harbor')`);
  await p.settle(500);
};

// ---------------------------------------------------------------- the page

const pageFlow = async (h, theme) => {
  const tag = `systems-library-page-1400-${theme}`;
  const p = await h.openPage({ width: 1400, height: 900, surface: 'page', theme, label: tag, storage: { 'library-view:page': 'tiles' } });
  console.log(tag);
  await h.listReady(p);
  await h.thumbsReady(p);
  await linkWorld(p);

  // -- the All tab: systems mixed in by the sort, counts that include them, the header sentence
  h.check((await text(p, '.dc-page-count')) === '6 designs and 5 systems', `${tag}: the header counts designs and systems (${await text(p, '.dc-page-count')})`);
  h.check((await tabText(p, 'all')) === 'All11' && (await tabText(p, 'system')) === 'Systems5', `${tag}: the All count includes the systems; Systems counts them alone (${await tabText(p, 'all')}, ${await tabText(p, 'system')})`);
  h.check((await count(p, '.dc-sys-tile')) === 5, `${tag}: five system tiles in All`);
  const mixed = await order(p);
  h.check(mixed.includes('ds') && mixed.includes('sd'), `${tag}: systems and designs are mixed by the sort, not stacked (${mixed})`);
  h.check(await p.guest('const c = doc.querySelector(".dc-sys-tile .dc-plate:not([data-empty=\\"true\\"]) .dc-plate-swatch"); return !!c && c.style.backgroundColor !== ""'), `${tag}: a plate paints the system's own swatches`);
  h.check(await p.guest('const t = [...doc.querySelectorAll(".dc-sys-tile")].find((n) => n.querySelector(".dc-card-title")?.textContent === "Acme"); return !!t && t.querySelector(".dc-plate")?.dataset.empty === "true"'), `${tag}: a system with no readable colour shows the glyph plate`);
  h.check(await p.guest('const t = [...doc.querySelectorAll(".dc-sys-tile")].find((n) => n.querySelector(".dc-card-title")?.textContent === "Juniper"); return !!t && /Repo · juniper-site/.test(t.textContent) && !!t.querySelector(".dc-sys-living") && /System/.test(t.querySelector(".dc-card-meta").textContent) && /Ready/.test(t.querySelector(".dc-card-meta").textContent)'), `${tag}: a repo system names its repo, shows System and Ready, and has a Living page button`);
  h.check(await p.guest('const t = [...doc.querySelectorAll(".dc-sys-tile")].find((n) => n.querySelector(".dc-card-title")?.textContent === "Harbor"); return !!t && /In Design Chamber/.test(t.textContent) && !t.querySelector(".dc-sys-living")'), `${tag}: an internal system says where it lives and has no Living page button`);
  h.check(await p.guest('const t = [...doc.querySelectorAll(".dc-sys-tile")].find((n) => n.querySelector(".dc-card-title")?.textContent === "Acme"); const u = t?.querySelector(".dc-sys-used"); return !!u && u.tagName === "SPAN" && u.textContent === "Not used yet"'), `${tag}: an unused system says Not used yet, as plain words (no link to nothing)`);
  h.check(await p.guest('const u = [...doc.querySelectorAll(".dc-sys-tile")].find((n) => n.querySelector(".dc-card-title")?.textContent === "Harbor")?.querySelector(".dc-sys-used"); return !!u && u.tagName === "BUTTON" && u.getAttribute("aria-label") === "Used by 2 designs. Show them"'), `${tag}: Used by 2 designs is a link that says where it goes`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow`);
  await p.shot(`${tag}-1-tiles-mixed`);

  // -- the chips: ok, Draft, deleted
  h.check(await p.guest('const c = doc.querySelector(".dc-card[data-slug=\\"coffee-subscription\\"] .dc-design-system-chip"); return !!c && c.getAttribute("aria-label") === "Open system Tidepool" && c.tagName === "BUTTON" && !c.closest(".dc-card-main")'), `${tag}: the chip is a button beside the card's main button, named Open system Tidepool`);
  h.check(await p.guest('const c = doc.querySelector(".dc-card[data-slug=\\"northwind-pricing\\"] .dc-design-system-chip"); return !!c && /Draft/.test(c.textContent) && /Draft/.test(c.getAttribute("aria-label"))'), `${tag}: a Draft system's chip carries a Draft mark`);
  h.check(await p.guest('const c = doc.querySelector(".dc-card[data-slug=\\"onboarding-flow\\"] .dc-design-system-chip"); return !!c && /\\(deleted\\)/.test(c.textContent) && c.dataset.state === "gone"'), `${tag}: a deleted system reads (deleted), muted`);
  h.check(await p.guest('return !doc.querySelector(".dc-card[data-slug=\\"invoice-template\\"] .dc-design-system-chip")'), `${tag}: a design with no system has no chip`);
  h.check(await p.guest('return /uses Tidepool/.test(doc.querySelector(".dc-card[data-slug=\\"coffee-subscription\\"] .dc-card-main").getAttribute("aria-label"))'), `${tag}: the card's accessible name says it uses Tidepool`);
  await p.click('.dc-card[data-slug="onboarding-flow"] .dc-design-system-chip');
  await h.checkSoon(async () => /This system was deleted/.test(await toastTexts(p)), `${tag}: a deleted chip says so in a toast`);
  h.check((await count(p, '.dc-viewer, .dc-syspg')) === 0, `${tag}: a deleted chip opens nothing`);
  await p.shot(`${tag}-2-chips`);
  await p.click('.dc-card[data-slug="coffee-subscription"] .dc-design-system-chip');
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"ready\\"]")'), `${tag}: the chip opens the system page in one click`);
  h.check((await text(p, '.dc-syspg h1, .dc-syspg .dc-page-title')) !== null && /Tidepool/.test((await text(p, '.dc-syspg')) ?? ''), `${tag}: it is Tidepool's page`);
  await p.click('.dc-syspg .oc-sdk-btn', { text: 'Library' });
  await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-syspg") && !!doc.querySelector(".dc-card[data-slug]")'), `${tag}: Back returns to the library, not the systems list`);
  h.check(await p.guest('return doc.activeElement?.classList.contains("dc-design-system-chip") && doc.activeElement.dataset.systemId === "tidepool"'), `${tag}: focus returns to the chip that opened it`);

  // -- the Living page button and the menu
  await p.click('.dc-sys-tile .dc-sys-living');
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg")'), `${tag}: Living page opens the system`);
  await p.click('.dc-syspg .oc-sdk-btn', { text: 'Library' });
  await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-syspg")'), `${tag}: Back from it returns to the library`);
  await p.click('.dc-sys-tile[data-system-id="juniper"] .dc-card-more');
  await p.waitFor('return !!doc.querySelector("[role=menu]")', 'the tile menu');
  h.check((await p.guest('return [...doc.querySelectorAll("[role=menuitem]")].map((n) => n.textContent.trim()).join("|")')) === 'Open|Preview living page|Reveal in folder', `${tag}: the tile menu is Open, Preview living page, Reveal in folder`);
  await p.shot(`${tag}-3-tile-menu`);
  await p.key('Escape');

  // -- the used-by link lands on a filtered library, scope All, tab All
  await p.click('.dc-sys-tile[data-system-id="harbor"] .dc-sys-used');
  await h.checkSoon(async () => (await selectLabel(p, '.dc-system-select')) === 'System: Harbor', `${tag}: the used-by link sets the System filter (${await selectLabel(p, '.dc-system-select')})`);
  h.check((await order(p)).startsWith('s') && (await p.guest('return doc.querySelector(".dc-grid > li")?.dataset.lead')) === 'true', `${tag}: the filtered system's tile leads`);
  h.check((await p.guest('return doc.querySelector(".dc-side-row[data-selected=\\"true\\"] .dc-side-main")?.textContent?.includes("All designs") === true')) && (await p.guest('return doc.querySelector(".dc-tabs [role=tab][aria-selected=true]")?.dataset.id')) === 'all', `${tag}: the scope is All designs and the tab is All`);
  h.check((await tabText(p, 'all')) === `All${1 + (await count(p, '.dc-card[data-slug]'))}`, `${tag}: the All count is truthful under the filter (${await tabText(p, 'all')})`);
  await p.shot(`${tag}-4-filtered-lead`);

  // -- the sidebar: the section, the rows set the filter and keep the scope, the heading opens the list
  await pickOption(p, '.dc-system-select', 'All systems');
  await seedFolder(p);
  await p.click('.dc-side-row .dc-side-main', { text: 'Q4 launch' });
  await h.checkSoon(async () => (await count(p, '.dc-card[data-slug]')) === 1, `${tag}: the folder scope shows its design`);
  h.check(await p.guest('const names = [...doc.querySelectorAll(".dc-side-list[aria-label=\\"Design systems\\"] .dc-side-row")].map((n) => n.querySelector(".dc-side-label").textContent); return JSON.stringify(names) === JSON.stringify(["Acme","Field notes","Harbor","Juniper","Tidepool"])'), `${tag}: the sidebar lists the systems by name`);
  h.check(await p.guest('const r = [...doc.querySelectorAll(".dc-side-list[aria-label=\\"Design systems\\"] .dc-side-row")].find((n) => n.textContent.includes("Acme")); return !!r && /Draft/.test(r.textContent)'), `${tag}: a Draft system is marked in the sidebar`);
  h.check(await p.guest('const h = doc.querySelector(".dc-side-heading-link"); return !!h && h.getAttribute("aria-label") === "Design systems, 5. Open the list" && !h.hasAttribute("aria-pressed")'), `${tag}: the heading is a link-style button with the count in its name, no pressed state`);
  await p.click('.dc-side-row .dc-side-main', { text: 'Tidepool' });
  await h.checkSoon(async () => (await selectLabel(p, '.dc-system-select')) === 'System: Tidepool', `${tag}: a sidebar system row sets the System filter`);
  h.check(await p.guest('return doc.querySelector(".dc-side-list:not([aria-label]) ~ .dc-side-list .dc-side-row[data-selected=\\"true\\"] .dc-side-main")?.textContent?.includes("Q4 launch") === true || [...doc.querySelectorAll(".dc-side-row[data-selected=\\"true\\"] .dc-side-main")].some((n) => n.textContent.includes("Q4 launch"))'), `${tag}: the scope stays on the folder`);
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-side-row[data-selected=\\"true\\"] .dc-side-main")].some((n) => n.textContent.includes("Tidepool") && n.getAttribute("aria-current") === "true")'), `${tag}: the active system row is marked current`);
  await p.shot(`${tag}-5-sidebar-filter`);
  await p.click('.dc-side-heading-link');
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-sys-view") && !!doc.querySelector(".dc-sys[data-id]")'), `${tag}: the section heading opens the systems list`);
  await p.click('.dc-sys-view .oc-sdk-btn', { text: 'Library' });
  await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-sys-view")'), `${tag}: Library comes back`);
  await p.click('.dc-side-row .dc-side-main', { text: 'All designs' });
  await pickOption(p, '.dc-system-select', 'All systems');

  // -- the used-by link from the Design systems list lands on the filtered library
  await p.click('.dc-library-bar .oc-sdk-btn', { text: 'Design systems' });
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the systems list is up`);
  h.check(await p.guest('return !!doc.querySelector(".dc-sys[data-id=\\"tidepool\\"] .dc-sys-plate .dc-plate") && doc.querySelector(".dc-sys[data-id=\\"tidepool\\"] .dc-sys-used")?.tagName === "BUTTON"'), `${tag}: a list row has its plate and a used-by link`);
  await p.shot(`${tag}-6-systems-list`);
  await p.click('.dc-sys[data-id="tidepool"] .dc-sys-used');
  await h.checkSoon(async () => !(await count(p, '.dc-sys-view')) && (await selectLabel(p, '.dc-system-select')) === 'System: Tidepool', `${tag}: the list's used-by link lands on the library filtered to Tidepool`);
  await pickOption(p, '.dc-system-select', 'All systems');

  // -- the Systems tab: systems only
  await p.click('.dc-tabs [role=tab]', { text: 'Systems' });
  await h.checkSoon(async () => (await count(p, '.dc-sys-tile')) === 5 && (await count(p, '.dc-card[data-slug]')) === 0, `${tag}: the Systems tab shows systems only`);
  h.check((await text(p, '.dc-page-count')) === '6 designs and 5 systems', `${tag}: the header sentence does not change with the tab`);
  await p.shot(`${tag}-7-systems-tab`);
  await p.type('.dc-search input', 'harb');
  await h.checkSoon(async () => (await count(p, '.dc-sys-tile')) === 1, `${tag}: search matches a system by name`);
  await p.type('.dc-search input', 'zzz');
  await h.checkSoon(async () => (await text(p, '.oc-sdk-empty-title')) === 'No systems match “zzz”.', `${tag}: no match says systems (${await text(p, '.oc-sdk-empty-title')})`);
  await p.click('.oc-sdk-empty-action .oc-sdk-btn', { text: 'Clear filters' });

  // -- List view: system rows in the columns, with the chip column on the design rows
  await p.click('.dc-tabs [role=tab]', { text: 'All' });
  await p.click('.dc-view-toggle-btn[aria-label="View as list"]');
  await h.checkSoon(async () => (await count(p, '.dc-list-row[data-kind="system"]')) === 5, `${tag}: List view draws the systems as rows`);
  h.check(await p.guest('const r = doc.querySelector(".dc-list-row[data-kind=\\"system\\"]"); return !!r.querySelector(".dc-plate") && !!r.querySelector(".dc-row-system") && !!r.querySelector(".dc-row-hit")'), `${tag}: a system row has the plate, a used-by cell and a whole-row hit button`);
  h.check(await p.guest('const head = [...doc.querySelectorAll(".dc-list-head > span")].map((n) => n.textContent.trim()).join("|"); return head === "|Name|System|In|Updated|"'), `${tag}: the list head has the System column`);
  h.check(await p.guest('const r = doc.querySelector(".dc-list-row[data-slug=\\"coffee-subscription\\"]"); return !!r.querySelector(".dc-row-system .dc-design-system-chip")'), `${tag}: a design row carries its chip in the System column`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow in List view`);
  await p.shot(`${tag}-8-list`);
  await p.click('.dc-list-row[data-kind="system"] .dc-row-system .dc-sys-used', { text: 'Used by' });
  await h.checkSoon(async () => /^System: /.test((await selectLabel(p, '.dc-system-select')) ?? ''), `${tag}: a used-by link in the List view filters too`);
  await p.close();
};

// ---------------------------------------------------------------- the Systems tab's own states (page)

const pageStates = async (h) => {
  // No systems: the Systems tab says what goes here and offers the way to start; the sidebar says so too.
  const emptyTag = 'systems-library-page-empty-dark';
  const empty = await h.openPage({ width: 1400, height: 900, surface: 'page', theme: 'dark', label: emptyTag, routes: { 'GET /systems': { status: 200, body: { systems: [], total: 0, max: 50 } } } });
  console.log(emptyTag);
  await h.listReady(empty);
  h.check((await text(empty, '.dc-page-count')) === '6 designs', `${emptyTag}: the header counts designs only`);
  h.check((await text(empty, '.dc-side-hint:last-of-type')) !== null && /No design systems yet\./.test((await empty.guest('return doc.querySelector(".dc-side")?.textContent ?? ""')) ?? ''), `${emptyTag}: the sidebar says No design systems yet`);
  await empty.click('.dc-tabs [role=tab]', { text: 'Systems' });
  await h.checkSoon(async () => (await text(empty, '.oc-sdk-empty-title')) === 'No design systems yet', `${emptyTag}: the Systems tab is not blank (${await text(empty, '.oc-sdk-empty-title')})`);
  h.check((await text(empty, '.oc-sdk-empty-action .oc-sdk-btn')) === 'New design system…', `${emptyTag}: the one action starts a system`);
  await empty.shot(`${emptyTag}-1-no-systems`);
  await empty.click('.oc-sdk-empty-action .oc-sdk-btn');
  await h.checkSoon(() => empty.guest('return !!doc.querySelector(".dc-newsys")'), `${emptyTag}: the action opens the New design system sheet`);
  await empty.key('Escape');

  // A folder holds designs, not systems.
  await empty.click('.dc-side-row .dc-side-main', { text: 'All designs' });
  const folderId = await empty.host(`${FAKE}.folders.seed('Q4 launch', ['coffee-subscription'])`);
  await empty.host(`${FAKE}.folders.changed()`);
  await empty.settle(400);
  h.check(typeof folderId === 'string', `${emptyTag}: a folder is seeded`);
  await empty.click('.dc-side-row .dc-side-main', { text: 'Q4 launch' });
  await h.checkSoon(async () => (await text(empty, '.oc-sdk-empty-title')) === 'Folders hold designs, not systems.', `${emptyTag}: the Systems tab in a folder says folders hold designs (${await text(empty, '.oc-sdk-empty-title')})`);
  await empty.click('.oc-sdk-empty-action .oc-sdk-btn', { text: 'Show all systems' });
  await h.checkSoon(async () => (await empty.guest('return doc.querySelector(".dc-side-row[data-selected=\\"true\\"] .dc-side-main")?.textContent?.includes("All designs") === true')), `${emptyTag}: Show all systems sets the scope to All`);
  await empty.close();

  // Systems failed: the designs still list; the Systems tab and the sidebar say it and offer Try again.
  const failTag = 'systems-library-page-failed-dark';
  const failed = await h.openPage({ width: 1400, height: 900, surface: 'page', theme: 'dark', label: failTag, routes: { 'GET /systems': { status: 500, body: { error: 'internal', message: 'The design systems list could not be read.' } } } });
  console.log(failTag);
  await h.listReady(failed);
  await failed.click('.dc-tabs [role=tab]', { text: 'Systems' });
  await h.checkSoon(async () => (await text(failed, '.oc-sdk-empty-title')) === 'Design systems didn’t load', `${failTag}: the Systems tab says they did not load (${await text(failed, '.oc-sdk-empty-title')})`);
  h.check((await text(failed, '.oc-sdk-empty-action .oc-sdk-btn')) === 'Try again', `${failTag}: it offers Try again`);
  h.check(/Design systems couldn’t load/.test((await failed.guest('return doc.querySelector(".dc-side")?.textContent ?? ""')) ?? ''), `${failTag}: the sidebar says so too`);
  await failed.shot(`${failTag}-1-failed`);
  await failed.route('GET /systems', null);
  await failed.click('.oc-sdk-empty-action .oc-sdk-btn', { text: 'Try again' });
  await h.checkSoon(async () => (await count(failed, '.dc-sys-tile')) === 5, `${failTag}: Try again brings the systems back`);
  await failed.close();

  // Loading: the Systems tab shows skeletons while the first answer is on its way.
  const loadTag = 'systems-library-page-loading-dark';
  const loading = await h.openPage({ width: 1400, height: 900, surface: 'page', theme: 'dark', label: loadTag, routes: { 'GET /systems': { delayMs: 2500, body: { systems: [], total: 0, max: 50 } } } });
  console.log(loadTag);
  await h.listReady(loading);
  await loading.click('.dc-tabs [role=tab]', { text: 'Systems' });
  await h.checkSoon(() => loading.guest('return doc.querySelectorAll(".dc-card-skeleton").length >= 4 && doc.querySelector(".dc-library-scroll")?.getAttribute("aria-busy") === "true"'), `${loadTag}: skeletons with aria-busy while the systems load`);
  await loading.shot(`${loadTag}-1-skeletons`);
  await loading.close();
};

// ---------------------------------------------------------------- the rail

const railFlow = async (h, width, theme) => {
  const tag = `systems-library-rail-${width}-${theme}`;
  const p = await h.openPage({ width, height: 800, surface: 'panel', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await h.thumbsReady(p);
  await linkWorld(p);

  h.check((await count(p, '.dc-tabs [role=tab]')) === 4, `${tag}: four kind tabs`);
  h.check(await p.guest('const t = doc.querySelector(".dc-tabs [role=tab][data-id=\\"system\\"]"); return t.getAttribute("aria-label") === "Systems, 5"'), `${tag}: the Systems tab keeps its count in its accessible name`);
  const countVisible = await p.guest('const c = doc.querySelector(".dc-tabs [role=tab] .oc-sdk-tab-count"); return !!c && getComputedStyle(c).display !== "none"');
  h.check(width <= 380 ? countVisible === false : countVisible === true, `${tag}: the tab counts are ${width <= 380 ? 'moved into the names below 380 px' : 'shown beside the names'}`);
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-tabs [role=tab]")].every((t) => t.scrollWidth <= t.clientWidth + 1)'), `${tag}: no tab clips its name`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow`);
  if (width === 320) h.check(await p.guest('return doc.querySelector(".dc-rail-title").getBoundingClientRect().width >= 120'), `${tag}: the title keeps its 120 px budget`);
  h.check((await count(p, '.dc-libsys')) === 5, `${tag}: five system rows mixed into All`);
  const mixed = await order(p);
  h.check(mixed.includes('ds') && mixed.includes('sd'), `${tag}: systems and designs are mixed by the sort (${mixed})`);
  h.check(await p.guest('const r = doc.querySelector(".dc-row[data-slug=\\"coffee-subscription\\"]"); const c = r.querySelector(".dc-design-system-chip"); return !!c && !c.closest(".dc-row-main") && c.getAttribute("aria-label") === "Open system Tidepool"'), `${tag}: a design row has its chip as a sibling under the text`);
  h.check(await p.guest('const r = doc.querySelector(".dc-row[data-slug=\\"coffee-subscription\\"]"); const t = r.querySelector(".dc-row-title").getBoundingClientRect(); return t.width >= (innerWidth <= 380 ? 100 : 120)'), `${tag}: the chip does not take the title's room`);
  await p.shot(`${tag}-1-all`);

  // chip → the system's compact view, Back returns to the list on the chip
  await p.click('.dc-row[data-slug="coffee-subscription"] .dc-design-system-chip');
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-syspg[data-state=\\"ready\\"]")'), `${tag}: the chip opens the system's compact view`);
  h.check(await p.guest('return !!doc.querySelector(".dc-syspg .dc-iconbtn[aria-label=\\"Back to designs\\"]")'), `${tag}: Back is named for where it goes`);
  await p.click('.dc-syspg .dc-iconbtn[aria-label="Back to designs"]');
  await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-syspg") && !doc.querySelector(".dc-sys-view") && !!doc.querySelector(".dc-row[data-slug]")'), `${tag}: Back returns to the library, not the systems list`);
  await h.checkSoon(() => p.guest('return doc.activeElement?.dataset.systemId === "tidepool"'), `${tag}: focus returns to the chip`);
  await p.click('.dc-row[data-slug="onboarding-flow"] .dc-design-system-chip');
  await h.checkSoon(async () => /This system was deleted/.test(await toastTexts(p)), `${tag}: a deleted chip says so in a toast`);

  // Systems tab: rows only, the plate and the link
  await p.click('.dc-tabs [role=tab]', { text: 'Systems' }).catch(async () => p.click('.dc-tabs [role=tab][data-id="system"]'));
  await h.checkSoon(async () => (await count(p, '.dc-libsys')) === 5 && (await count(p, '.dc-row[data-slug]')) === 0, `${tag}: the Systems tab shows systems only`);
  h.check(await p.guest('const r = doc.querySelector(".dc-libsys[data-id=\\"tidepool\\"]"); return !!r.querySelector(".dc-plate") && r.querySelector(".dc-sys-used")?.tagName === "BUTTON" && /Ready/.test(r.querySelector(".dc-sys-name").textContent)'), `${tag}: a system row has its plate, status and a used-by link`);
  h.check(await p.guest('const r = doc.querySelector(".dc-libsys[data-id=\\"acme\\"]"); return r.querySelector(".dc-plate")?.dataset.empty === "true" && r.querySelector(".dc-sys-used")?.tagName === "SPAN"'), `${tag}: an unused system with no colours shows the glyph plate and plain words`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow on the Systems tab`);
  await p.shot(`${tag}-2-systems-tab`);

  // The row opens the system; the menu is the short one
  await p.hover('.dc-libsys[data-id="juniper"]');
  await p.click('.dc-libsys[data-id="juniper"] .dc-iconbtn');
  await p.waitFor('return !!doc.querySelector("[role=menu]")', 'the row menu');
  h.check((await p.guest('return [...doc.querySelectorAll("[role=menuitem]")].map((n) => n.textContent.trim()).join("|")')) === 'Open|Preview living page|Reveal in folder', `${tag}: the row menu is Open, Preview living page, Reveal in folder`);
  await p.key('Escape');

  // used-by link → filtered list, the system's row leads
  await p.click('.dc-libsys[data-id="tidepool"] .dc-sys-used');
  await h.checkSoon(async () => (await selectLabel(p, '.dc-rail-pair .dc-system-select')) === 'System: Tidepool', `${tag}: the used-by link filters to Tidepool (${await selectLabel(p, '.dc-rail-pair .dc-system-select')})`);
  h.check((await p.guest('return doc.querySelector(".dc-tabs [role=tab][aria-selected=true]")?.dataset.id')) === 'all', `${tag}: the tab is All`);
  h.check((await p.guest('return doc.querySelector(".dc-rows > li")?.dataset.lead')) === 'true', `${tag}: the filtered system's row leads`);
  h.check((await count(p, '.dc-row[data-slug]')) === 1, `${tag}: the design that uses it follows`);
  await p.shot(`${tag}-3-filtered`);
  await pickOption(p, '.dc-rail-pair .dc-system-select', 'All systems');

  // The Design systems list's used-by link lands on the filtered library
  await p.click('.dc-rail-head .dc-iconbtn[aria-label="Design systems"]');
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-sys[data-id]").length >= 5'), `${tag}: the systems list is up`);
  h.check(await p.guest('const r = doc.querySelector(".dc-sys[data-id=\\"harbor\\"]"); return !!r.querySelector(".dc-plate") && r.querySelector(".dc-sys-used")?.getAttribute("aria-label") === "Used by 2 designs. Show them"'), `${tag}: the list row has its plate and the link`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow in the systems list`);
  await p.shot(`${tag}-4-systems-list`);
  await p.click('.dc-sys[data-id="harbor"] .dc-sys-used');
  await h.checkSoon(async () => !(await count(p, '.dc-sys-view')) && (await selectLabel(p, '.dc-rail-pair .dc-system-select')) === 'System: Harbor', `${tag}: the link closes the list and filters the library to Harbor`);
  await p.close();
};

const railStates = async (h, width) => {
  const tag = `systems-library-rail-${width}-states-dark`;
  // No systems on the rail: the Systems tab is not blank.
  const empty = await h.openPage({ width, height: 780, surface: 'panel', theme: 'dark', label: tag, routes: { 'GET /systems': { status: 200, body: { systems: [], total: 0, max: 50 } } } });
  console.log(tag);
  await h.listReady(empty);
  await empty.click('.dc-tabs [role=tab][data-id="system"]');
  await h.checkSoon(async () => (await text(empty, '.oc-sdk-empty-title')) === 'No design systems yet', `${tag}: the Systems tab says what goes here (${await text(empty, '.oc-sdk-empty-title')})`);
  h.check((await text(empty, '.oc-sdk-empty-action .oc-sdk-btn')) === 'New design system…', `${tag}: and offers to start one`);
  h.check(await noOverflow(empty), `${tag}: no horizontal overflow`);
  await empty.shot(`${tag}-1-no-systems`);
  await empty.close();
  // The Design systems list's empty state has its fourth way to start.
  const list = await h.openPage({ width, height: 780, surface: 'panel', theme: 'dark', label: `${tag}-list`, routes: { 'GET /systems': { status: 200, body: { systems: [], total: 0, max: 50 } } } });
  await h.listReady(list);
  await list.click('.dc-rail-head .dc-iconbtn[aria-label="Design systems"]');
  await h.checkSoon(() => list.guest('return !!doc.querySelector(".dc-sys-empty-actions")'), `${tag}: the systems list is empty`);
  h.check((await list.guest('return [...doc.querySelectorAll(".dc-sys-empty-actions .oc-sdk-btn")].map((b) => b.textContent.trim()).join("|")')) === 'From code…|From brand files…|Describe…|From an existing system…', `${tag}: the fourth way to start is From an existing system…`);
  h.check(await noOverflow(list), `${tag}: the four actions wrap without overflow`);
  await list.shot(`${tag}-2-empty-actions`);
  await list.click('.dc-sys-empty-actions .oc-sdk-btn', { text: 'From an existing system…' });
  await h.checkSoon(() => list.guest('return !!doc.querySelector(".dc-newsys")'), `${tag}: it opens the sheet at its Existing start`);
  await list.close();
};

export const run = async (helpers) => {
  for (const theme of ['dark', 'light']) await pageFlow(helpers, theme);
  await pageStates(helpers);
  for (const width of [320, 480]) for (const theme of ['dark', 'light']) await railFlow(helpers, width, theme);
  for (const width of [320, 480]) await railStates(helpers, width);
};

