// Visual scenario for Phase 2.5 G1 (projects and folders in the designs list): the page library's sidebar (projects,
// No project, folders, drop targets, inline create and rename, delete with Undo), the cards' project line, the rail's
// Show select, the Add to folder dialog, the remembered view and the "folders couldn't load" state. Folders are labels:
// the fake backend never moves a design. `helpers`: openPage, check, checkSoon, listReady, thumbsReady.

const FAKE = 'window.frames[0].__dcFake';
const SHOP = 'C:\\Users\\you\\work\\shop';
const APP_WORK = 'C:\\Users\\you\\work\\app';
const APP_PERSONAL = 'C:\\Users\\you\\personal\\app';

/** Give the sample designs different projects so the list has something to group. */
const groupSamples = async (h, p, tag) => {
  await p.host(`${FAKE}.setProject('northwind-pricing', ${JSON.stringify(SHOP)})`);
  await p.host(`${FAKE}.setProject('habit-tracker', ${JSON.stringify(SHOP)})`);
  await p.host(`${FAKE}.setProject('onboarding-flow', ${JSON.stringify(APP_WORK)})`);
  await p.host(`${FAKE}.setProject('launch-announcement', ${JSON.stringify(APP_PERSONAL)})`);
  await p.host(`${FAKE}.setProject('invoice-template', null)`);
  await p.host(`${FAKE}.setMissingProjects([${JSON.stringify(APP_PERSONAL)}])`);
  // The page lists its projects in the sidebar; the rail has no list of them until Show opens, so it just waits for the events to land.
  if (await p.guest('return !!doc.querySelector(".dc-side")')) await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-side-row[data-scope^=project]").length >= 4'), `${tag}: the sample designs group into projects`);
  else await p.settle(900);
};

const dragCard = (p, slug, folderScope) =>
  p.guest(`
    const dt = new win.DataTransfer();
    const card = doc.querySelector('.dc-card[data-slug="${slug}"]');
    const row = doc.querySelector('.dc-side-row[data-scope="${folderScope}"]');
    if (!card || !row) return false;
    const fire = (target, type) => target.dispatchEvent(new win.DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    fire(card, 'dragstart');
    fire(row, 'dragenter');
    fire(row, 'dragover');
    const over = row.dataset.drop === 'over';
    fire(row, 'drop');
    fire(card, 'dragend');
    return over;`);

/** Opens the sidebar when it is closed (narrow pages close it after a choice). */
const ensureSidebar = async (p) => {
  if ((await p.guest('return doc.querySelector(".dc-library-body").dataset.sidebar')) === 'closed') {
    await p.click('.dc-library-bar .dc-iconbtn[aria-label="Projects and folders"]');
    await p.settle(150);
  }
};

const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');
const gridSlugs = (p) => p.guest('return [...doc.querySelectorAll(".dc-card[data-slug], .dc-row[data-slug]")].map((n) => n.dataset.slug).sort()');
const toastTexts = (p) => p.host('JSON.stringify(window.__host.toasts.map((t) => t.message))');

// ---------------------------------------------------------------- the page library

const pageFlow = async (h, width, theme) => {
  const tag = `folders-page-${width}-${theme}`;
  const p = await h.openPage({ width, height: 900, surface: 'page', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await h.thumbsReady(p);
  await groupSamples(h, p, tag);
  await p.settle(500);

  h.check((await p.guest('return doc.querySelector(".dc-library-body").dataset.sidebar')) === 'open', `${tag}: the sidebar is open at ${width} px`);

  const labels = await p.guest('return [...doc.querySelectorAll(".dc-side-row .dc-side-label")].map((n) => n.textContent)');
  h.check(labels[0] === 'All designs' && labels.includes('shop') && labels.includes('app · work') && labels.includes('app · personal') && labels.includes('No project'), `${tag}: All designs, projects (equal names get their parent), No project (${labels.join(' | ')})`);
  h.check(await p.guest('const r = doc.querySelector(".dc-side-row[data-scope*=personal] .dc-side-main"); return !!r && /Folder not found/.test(r.title) && /folder not found/.test(r.getAttribute("aria-label"))'), `${tag}: a project folder gone from disk still groups, with "Folder not found"`);
  h.check(await p.guest('const r = doc.querySelector(".dc-side-row[data-scope^=project][data-scope*=shop] .dc-side-main"); return r.title.includes("work\\\\shop") || r.title.includes("work/shop")'), `${tag}: the full project path is the tooltip`);
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-side-title")].some((n) => n.textContent === "Folders") && !!doc.querySelector(".dc-side-hint")'), `${tag}: Folders heading with an empty hint before any folder`);
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-card .dc-card-project-name")].some((n) => n.textContent === "ember-oak")'), `${tag}: cards show their project under the title`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow`);
  await p.shot(`${tag}-1-library`);

  // A project row filters the grid; search, tabs and counts work inside it; the card's project line goes.
  await p.click('.dc-side-main', { text: 'shop' });
  await h.checkSoon(async () => JSON.stringify(await gridSlugs(p)) === '["habit-tracker","northwind-pricing"]', `${tag}: the shop row shows only shop's designs`);
  h.check(await p.guest('return doc.querySelector(".dc-page-scope")?.textContent === "shop" && !doc.querySelector(".dc-card-project")'), `${tag}: the title names the view and the cards drop their project line inside it`);
  h.check(await p.guest('const t = [...doc.querySelectorAll(".dc-tabs [role=tab]")].map((n) => n.textContent.replace(/\\s+/g, " ").trim()); return /All.*2/.test(t[0]) && /Canvases.*1/.test(t[1]) && /Pages.*1/.test(t[2])'), `${tag}: tab counts follow the project`);
  h.check(String(await p.host('window.__host.storageGet("list-scope:page")')).startsWith('project:'), `${tag}: the chosen view is remembered (list-scope:page)`);
  await p.type('.dc-search input', 'zzz');
  await h.checkSoon(() => p.guest('return /No designs in shop match .zzz./.test(doc.querySelector(".dc-grid-message")?.textContent ?? "")'), `${tag}: an empty search names the project: No designs in shop match “zzz”.`);
  await p.shot(`${tag}-2-no-matches`);
  await p.type('.dc-search input', '');
  await p.settle(200);

  // New folder, inline: validation next to the field, then the row.
  await p.click('.dc-side-heading .oc-sdk-btn', { text: 'New folder' });
  await p.type('.dc-side-create input', '   ');
  await p.key('Enter', { focus: '.dc-side-create input' });
  await h.checkSoon(() => p.guest('return doc.querySelector(".dc-side-create-slot .dc-form-error")?.textContent === "Give the folder a name."'), `${tag}: a blank name is refused inline: Give the folder a name.`);
  await p.type('.dc-side-create input', 'x'.repeat(41));
  await p.key('Enter', { focus: '.dc-side-create input' });
  await h.checkSoon(() => p.guest('return doc.querySelector(".dc-side-create-slot .dc-form-error")?.textContent === "Keep the folder name to 40 characters or fewer."'), `${tag}: a 41 character name gets the service's sentence`);
  await p.type('.dc-side-create input', 'Q4 launch');
  await p.key('Enter', { focus: '.dc-side-create input' });
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-side-row[data-scope^=folder]") && doc.querySelector(".dc-side-create-slot").hidden'), `${tag}: Enter makes the folder and closes the field`);
  await p.click('.dc-side-heading .oc-sdk-btn', { text: 'New folder' });
  await p.type('.dc-side-create input', 'q4 LAUNCH');
  await p.key('Enter', { focus: '.dc-side-create input' });
  await h.checkSoon(() => p.guest('return doc.querySelector(".dc-side-create-slot .dc-form-error")?.textContent === "You already have a folder called Q4 launch."'), `${tag}: a duplicate name (any case) is refused with the folder's name`);
  await p.shot(`${tag}-3-new-folder-error`);
  await p.key('Escape', { focus: '.dc-side-create input' });
  await p.settle(150);
  h.check(await p.guest('return doc.querySelector(".dc-side-create-slot").hidden'), `${tag}: Escape closes the field`);
  await p.click('.dc-side-main', { text: 'All designs' });

  // Drag a card onto the folder, then add the same design to a second folder from its menu (multi-membership).
  const folderScope = await p.guest('return doc.querySelector(".dc-side-row[data-scope^=folder]").dataset.scope');
  const over = await dragCard(p, 'coffee-subscription', folderScope);
  h.check(over === true, `${tag}: a dragged card marks the folder row as the drop target`);
  await h.checkSoon(async () => /Added .Coffee subscription. to Q4 launch/.test(await toastTexts(p)), `${tag}: dropping says what happened`);
  await h.checkSoon(() => p.guest(`return /1$/.test(doc.querySelector('.dc-side-row[data-scope="${folderScope}"] .dc-side-count').textContent)`), `${tag}: the folder counts 1`);
  await dragCard(p, 'coffee-subscription', folderScope);
  await h.checkSoon(async () => /already in Q4 launch/.test(await toastTexts(p)), `${tag}: dropping it again says it is already there (nothing doubled)`);
  h.check((await p.guest(`return doc.querySelector('.dc-side-row[data-scope="${folderScope}"] .dc-side-count').textContent`)) === '1', `${tag}: still 1 after the second drop`);

  await p.click('.dc-side-heading .oc-sdk-btn', { text: 'New folder' });
  await p.type('.dc-side-create input', 'Explorations');
  await p.key('Enter', { focus: '.dc-side-create input' });
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-side-row[data-scope^=folder]").length === 2'), `${tag}: a second folder`);

  await p.hover('.dc-card[data-slug="northwind-pricing"]');
  await p.click('.dc-card[data-slug="northwind-pricing"] .dc-card-more');
  await p.click('.dc-popup [role="menuitem"]', { text: 'Add to folder' });
  await p.waitFor('return !!doc.querySelector(".dc-sheet[data-variant=dialog] .dc-folder-pick .oc-sdk-check")', 'the Add to folder dialog');
  await p.settle(250);
  h.check(await p.guest('const c = [...doc.querySelectorAll(".dc-folder-pick .oc-sdk-check")]; return c.length === 2 && c.every((n) => n.getAttribute("aria-checked") === "false")'), `${tag}: the dialog lists both folders, none ticked for this design`);
  await p.shot(`${tag}-4-add-to-folder`);
  await p.click('.dc-folder-pick .oc-sdk-check', { text: 'Explorations' });
  await h.checkSoon(() => p.guest('return [...doc.querySelectorAll(".dc-folder-pick .oc-sdk-check")].find((n) => n.textContent.includes("Explorations"))?.getAttribute("aria-checked") === "true"'), `${tag}: ticking adds it at once`);
  await p.click('.dc-folder-pick .oc-sdk-check', { text: 'Q4 launch' });
  await h.checkSoon(() => p.guest('return [...doc.querySelectorAll(".dc-folder-pick .oc-sdk-check")].every((n) => n.getAttribute("aria-checked") === "true")'), `${tag}: a design can sit in two folders`);
  await p.click('.dc-sheet .oc-sdk-btn', { text: 'Done' });
  await p.settle(150);

  // The folder view, its menu entry, and the empty folder.
  await p.click(`.dc-side-row[data-scope="${folderScope}"] .dc-side-main`);
  await h.checkSoon(async () => JSON.stringify(await gridSlugs(p)) === '["coffee-subscription","northwind-pricing"]', `${tag}: the folder shows its two designs`);
  h.check(await p.guest('return !!doc.querySelector(".dc-side-row[data-selected=true] .dc-side-main[aria-current=true]")'), `${tag}: the selected row is marked for assistive tech, not only by colour`);
  await p.hover('.dc-card[data-slug="northwind-pricing"]');
  await p.click('.dc-card[data-slug="northwind-pricing"] .dc-card-more');
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-popup [role=menuitem]")].some((n) => n.textContent === "Remove from Q4 launch")'), `${tag}: inside a folder the menu offers Remove from Q4 launch`);
  await p.shot(`${tag}-5-folder-menu`);
  await p.click('.dc-popup [role="menuitem"]', { text: 'Remove from Q4 launch' });
  await h.checkSoon(async () => JSON.stringify(await gridSlugs(p)) === '["coffee-subscription"]', `${tag}: removing leaves the design in All designs and out of the folder`);
  h.check(await p.guest('const r = doc.querySelector(".dc-side-row[data-scope^=project][data-scope*=shop] .dc-side-count"); return !!r && r.textContent === "2"'), `${tag}: removing from a folder never changes a project's designs`);

  await p.click('.dc-side-heading .oc-sdk-btn', { text: 'New folder' });
  await p.type('.dc-side-create input', 'Scratch');
  await p.key('Enter', { focus: '.dc-side-create input' });
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-side-row[data-scope^=folder]").length === 3'), `${tag}: a third, empty folder`);
  await p.click('.dc-side-main', { text: 'Scratch' });
  await h.checkSoon(() => p.guest('return /No designs in Scratch yet/.test(doc.querySelector(".dc-grid-message")?.textContent ?? "") && /Drag designs here, or use Add to folder/.test(doc.querySelector(".dc-grid-message").textContent)'), `${tag}: an empty folder says what to do`);
  await p.shot(`${tag}-6-empty-folder`);

  // Rename inline, then delete with Undo.
  await p.click('.dc-side-row[data-scope^=folder] .dc-iconbtn', { nth: 2 });
  await p.click('.dc-popup [role="menuitem"]', { text: 'Rename' });
  await p.waitFor('return !!doc.querySelector(".dc-side-row-edit input")', 'the rename field');
  await p.type('.dc-side-row-edit input', 'Ideas');
  await p.key('Enter', { focus: '.dc-side-row-edit input' });
  await h.checkSoon(() => p.guest('return [...doc.querySelectorAll(".dc-side-label")].some((n) => n.textContent === "Ideas") && !doc.querySelector(".dc-side-row-edit")'), `${tag}: renaming inline keeps the folder`);
  h.check(await p.guest('return doc.querySelector(".dc-page-scope")?.textContent === "Ideas"'), `${tag}: the open view follows the new name`);
  await p.click('.dc-side-row[data-selected=true] .dc-iconbtn');
  await p.click('.dc-popup [role="menuitem"]', { text: 'Delete folder' });
  await p.waitFor('return !!doc.querySelector(".dc-undo-notice .oc-sdk-banner")', 'the Undo notice');
  await p.settle(250);
  h.check(!(await p.guest('return !!doc.querySelector(".dc-sheet[data-variant=dialog]")')), `${tag}: deleting a folder asks nothing first`);
  h.check(await p.guest('const n = doc.querySelector(".dc-undo-notice"); return /Deleted folder Ideas\\./.test(n.textContent) && /It was empty/.test(n.textContent) && /Undo/.test(n.textContent) && n.getAttribute("aria-live") === "polite"'), `${tag}: the notice says what was deleted and offers Undo (live region)`);
  h.check(await p.guest('return doc.querySelector(".dc-page-scope")?.hidden === true'), `${tag}: the view falls back to All designs`);
  await p.shot(`${tag}-7-deleted-undo`);
  await p.click('.dc-undo-notice .oc-sdk-btn', { text: 'Undo' });
  await h.checkSoon(() => p.guest('return [...doc.querySelectorAll(".dc-side-label")].some((n) => n.textContent === "Ideas") && !doc.querySelector(".dc-undo-notice .oc-sdk-banner")'), `${tag}: Undo brings the folder back`);

  // A folder with designs: the notice counts them and every design stays listed. (Undo returned the view to Ideas; go back to All designs.)
  await p.click('.dc-side-main', { text: 'All designs' });
  await p.click(`.dc-side-row[data-scope="${folderScope}"] .dc-iconbtn`);
  await p.click('.dc-popup [role="menuitem"]', { text: 'Delete folder' });
  await p.waitFor('return !!doc.querySelector(".dc-undo-notice .oc-sdk-banner")', 'the Undo notice');
  h.check(await p.guest('return /Its design is still in All designs\\./.test(doc.querySelector(".dc-undo-notice").textContent)'), `${tag}: the notice counts the designs that stay`);
  h.check((await p.guest('return doc.querySelectorAll(".dc-card[data-slug]").length')) === 6, `${tag}: every design is still listed`);
  await p.click('.dc-undo-notice .oc-sdk-btn', { text: 'Undo' });
  await h.checkSoon(() => p.guest(`return !!doc.querySelector('.dc-side-row[data-scope="${folderScope}"]')`), `${tag}: Undo restores the folder`);
  await p.settle(300);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow at the end`);
  await p.shot(`${tag}-8-restored`);
  await p.close();
};

// Under 900 px the sidebar starts closed and floats over the grid when opened.
const pageNarrow = async (h) => {
  const tag = 'folders-page-800-light';
  const p = await h.openPage({ width: 800, height: 900, surface: 'page', theme: 'light', label: tag });
  console.log(tag);
  await h.listReady(p);
  await h.thumbsReady(p);
  await groupSamples(h, p, tag);
  await p.settle(400);
  h.check((await p.guest('return doc.querySelector(".dc-library-body").dataset.sidebar')) === 'closed', `${tag}: the sidebar starts closed under 900 px`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow`);
  await p.shot(`${tag}-1-collapsed`);
  await ensureSidebar(p);
  h.check(await p.guest('const s = doc.querySelector(".dc-side"); return getComputedStyle(s).position === "absolute" && s.getBoundingClientRect().width > 150 && !s.inert'), `${tag}: opened, the sidebar floats over the grid`);
  await p.shot(`${tag}-2-open`);
  await p.click('.dc-side-main', { text: 'shop' });
  await h.checkSoon(async () => JSON.stringify(await gridSlugs(p)) === '["habit-tracker","northwind-pricing"]', `${tag}: choosing a row filters the grid`);
  h.check((await p.guest('return doc.querySelector(".dc-library-body").dataset.sidebar')) === 'closed', `${tag}: and closes the floating sidebar`);
  await ensureSidebar(p);
  await p.key('Escape', { focus: '.dc-side-main' });
  await p.settle(150);
  h.check((await p.guest('return doc.querySelector(".dc-library-body").dataset.sidebar + ":" + (doc.activeElement?.getAttribute("aria-label") ?? "")')) === 'closed:Projects and folders', `${tag}: Escape closes it and focus returns to the button`);
  await p.shot(`${tag}-3-shop`);
  await p.close();
};

const pageRemembered = async (h) => {
  const tag = 'folders-page-1400-remember';
  const p = await h.openPage({ width: 1400, height: 900, surface: 'page', theme: 'light', label: tag, storage: { 'list-scope:page': 'no-project' } });
  console.log(tag);
  await p.waitFor('return !!doc.querySelector(".dc-side-row")', 'the sidebar');
  await groupSamples(h, p, tag);
  await h.checkSoon(async () => JSON.stringify(await gridSlugs(p)) === '["invoice-template"]', `${tag}: a remembered No project view opens on its designs`);
  await p.close();
  const bad = await h.openPage({ width: 1400, height: 900, surface: 'page', theme: 'light', label: `${tag}-bad`, storage: { 'list-scope:page': 'folder:../../etc' } });
  await h.listReady(bad);
  await bad.settle(400);
  h.check((await gridSlugs(bad)).length === 6 && (await bad.guest('return doc.querySelector(".dc-side-row[data-scope=all]").dataset.selected')) === 'true', `${tag}: an unknown remembered view reads as All designs`);
  await bad.close();
  const gone = await h.openPage({ width: 1400, height: 900, surface: 'page', theme: 'light', label: `${tag}-gone`, storage: { 'list-scope:page': 'folder:f_zzzzzzzzzz' } });
  await h.listReady(gone);
  await gone.settle(500);
  h.check((await gridSlugs(gone)).length === 6, `${tag}: a remembered folder that is gone reads as All designs`);
  await gone.close();
};

const pageFoldersFail = async (h, theme) => {
  const tag = `folders-page-1400-${theme}-fail`;
  const p = await h.openPage({ width: 1400, height: 900, surface: 'page', theme, label: tag, routes: { 'GET /folders': { status: 500, body: { error: 'internal', message: 'The folders list could not be read.' } } } });
  console.log(tag);
  await h.listReady(p);
  await groupSamples(h, p, tag);
  await h.checkSoon(() => p.guest('return /Folders couldn.t load\\. Try again\\./.test(doc.querySelector(".dc-side-note")?.textContent ?? "")'), `${tag}: the sidebar says folders couldn't load and offers Try again`);
  h.check((await gridSlugs(p)).length === 6 && (await p.guest('return doc.querySelectorAll(".dc-side-row[data-scope^=project]").length')) >= 3, `${tag}: designs and projects still list`);
  await p.shot(`${tag}-1-sidebar`);
  await p.clearRoutes();
  await p.click('.dc-side-note .oc-sdk-btn', { text: 'Try again' });
  await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-side-note") && !!doc.querySelector(".dc-side-hint")'), `${tag}: Try again loads them`);
  await p.close();
};

// ---------------------------------------------------------------- the rail

const railFlow = async (h, width, theme, full) => {
  const tag = `folders-rail-${width}-${theme}`;
  const p = await h.openPage({ width, height: 780, surface: 'panel', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await h.thumbsReady(p);
  await groupSamples(h, p, tag);
  await p.settle(400);

  h.check(await p.guest('const f = doc.querySelector(".dc-rail-filters"); const show = f.querySelector(".dc-rail-show"); const tabs = f.querySelector(".dc-tabs"); return !!show && !!(show.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING)'), `${tag}: one Show select sits above the tabs`);
  h.check(await p.guest('return doc.querySelector(".dc-rail-show-select button").getAttribute("aria-label") === "Show: All designs"'), `${tag}: the select is named "Show: All designs"`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow`);
  await p.shot(`${tag}-1-list`);

  await p.click('.dc-rail-show-select button');
  await p.waitFor('return !!doc.querySelector(".oc-sdk-popup")', 'the Show options');
  const options = await p.guest('return [...doc.querySelectorAll(".oc-sdk-popup .oc-sdk-option-label")].map((n) => n.textContent)');
  h.check(options[0] === 'All designs' && options.includes('shop') && options.includes('No project'), `${tag}: Show lists All designs, each project, No project (${options.join(' | ')})`);
  await p.shot(`${tag}-2-show-open`);
  await p.click('.oc-sdk-popup .oc-sdk-option', { text: 'shop' });
  await h.checkSoon(async () => JSON.stringify(await gridSlugs(p)) === '["habit-tracker","northwind-pricing"]', `${tag}: choosing a project shows only its designs`);
  h.check(await p.guest('return !doc.querySelector(".dc-row-project")'), `${tag}: inside the project the rows drop their project line`);
  h.check(await p.guest('return /shop/.test(doc.querySelector(".dc-rail-show-select").textContent)'), `${tag}: the select shows the choice`);
  h.check(String(await p.host('window.__host.storageGet("list-scope:panel")')).startsWith('project:'), `${tag}: remembered as list-scope:panel`);
  await p.shot(`${tag}-3-project`);
  await p.click('.dc-rail-show-select button');
  await p.click('.oc-sdk-popup .oc-sdk-option', { text: 'All designs' });
  await h.checkSoon(async () => (await gridSlugs(p)).length === 6, `${tag}: back to All designs`);

  // Add to folder with New folder from a row menu.
  await p.hover('.dc-row[data-slug="coffee-subscription"]');
  await p.click('.dc-row[data-slug="coffee-subscription"] .dc-iconbtn');
  await p.click('.dc-popup [role="menuitem"]', { text: 'Add to folder' });
  await p.waitFor('return !!doc.querySelector(".dc-sheet[data-variant=dialog] .dc-folder-new-field input")', 'the Add to folder dialog with the name field (no folders yet)');
  await p.settle(200);
  h.check(await p.guest('return /No folders yet/.test(doc.querySelector(".dc-folder-pick").textContent)'), `${tag}: with no folders the dialog says so and asks for a name`);
  await p.shot(`${tag}-4-add-first-folder`);
  await p.type('.dc-folder-new-field input', 'a\tb');
  await p.click('.dc-sheet .oc-sdk-btn', { text: 'Create and add' });
  await h.checkSoon(() => p.guest('return doc.querySelector(".dc-folder-new-field")?.textContent.includes("line breaks or tabs")'), `${tag}: a tab in the name is refused next to the field`);
  await p.type('.dc-folder-new-field input', 'Q4 launch');
  await p.click('.dc-sheet .oc-sdk-btn', { text: 'Create and add' });
  await h.checkSoon(() => p.guest('const c = doc.querySelector(".dc-folder-pick .oc-sdk-check"); return c?.getAttribute("aria-checked") === "true" && c.textContent.includes("Q4 launch")'), `${tag}: Create and add makes the folder and ticks it`);
  await p.shot(`${tag}-5-added`);
  await p.click('.dc-sheet .oc-sdk-btn', { text: 'Done' });
  await p.settle(150);

  await p.click('.dc-rail-show-select button');
  await p.click('.oc-sdk-popup .oc-sdk-option', { text: 'Folder · Q4 launch' });
  await h.checkSoon(async () => JSON.stringify(await gridSlugs(p)) === '["coffee-subscription"]', `${tag}: the folder view lists its design`);
  h.check(await p.guest('return !doc.querySelector(".dc-rail-show .dc-iconbtn").hidden'), `${tag}: a folder view shows Folder actions`);
  await p.shot(`${tag}-6-folder`);
  await p.click('.dc-row[data-slug="coffee-subscription"] .dc-iconbtn');
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-popup [role=menuitem]")].some((n) => n.textContent === "Remove from Q4 launch")'), `${tag}: the row menu offers Remove from Q4 launch`);
  await p.key('Escape');

  await p.click('.dc-rail-show .dc-iconbtn');
  await p.click('.dc-popup [role="menuitem"]', { text: 'Rename folder' });
  await p.waitFor('return !!doc.querySelector(".dc-sheet[data-variant=dialog] input")', 'the rename dialog');
  await p.type('.dc-sheet input', '   ');
  await p.click('.dc-sheet .oc-sdk-btn', { text: 'Save name' });
  await h.checkSoon(() => p.guest('return doc.querySelector(".dc-sheet")?.textContent.includes("Give the folder a name.")'), `${tag}: a blank rename is refused in the dialog`);
  await p.type('.dc-sheet input', 'Q4 push');
  await p.click('.dc-sheet .oc-sdk-btn', { text: 'Save name' });
  await h.checkSoon(() => p.guest('return /Q4 push/.test(doc.querySelector(".dc-rail-show-select").textContent) && !doc.querySelector(".dc-sheet")'), `${tag}: Save name renames it and the select follows`);

  await p.click('.dc-rail-show .dc-iconbtn');
  await p.click('.dc-popup [role="menuitem"]', { text: 'Delete folder' });
  await p.waitFor('return !!doc.querySelector(".dc-undo-notice .oc-sdk-banner")', 'the Undo notice');
  await p.settle(250);
  h.check(await p.guest('return /Deleted folder Q4 push\\./.test(doc.querySelector(".dc-undo-notice").textContent) && /still in All designs/.test(doc.querySelector(".dc-undo-notice").textContent)'), `${tag}: delete says what stays, with Undo`);
  h.check((await gridSlugs(p)).length === 6, `${tag}: back on All designs with every design listed`);
  await p.shot(`${tag}-7-deleted-undo`);
  await p.click('.dc-undo-notice .oc-sdk-btn', { text: 'Undo' });
  await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-undo-notice .oc-sdk-banner")'), `${tag}: Undo clears the notice`);
  await p.click('.dc-rail-show-select button');
  const afterUndo = await p.guest('return [...doc.querySelectorAll(".oc-sdk-popup .oc-sdk-option-label")].map((n) => n.textContent)');
  h.check(afterUndo.includes('Folder · Q4 push'), `${tag}: Undo brought the folder back (${afterUndo.join(' | ')})`);
  await p.key('Escape');
  h.check(await noOverflow(p), `${tag}: no horizontal overflow at the end`);
  await p.close();
  if (!full) return;

  // The remembered view, on a new load.
  const again = await h.openPage({ width, height: 780, surface: 'panel', theme, label: `${tag}-again`, storage: { 'list-scope:panel': 'no-project' } });
  await again.waitFor('return !!doc.querySelector(".dc-rail-show-select")', 'the Show select');
  await groupSamples(h, again, tag);
  await h.checkSoon(async () => JSON.stringify(await gridSlugs(again)) === '["invoice-template"]', `${tag}: the rail opens on the remembered view`);
  await again.close();
};

const railFoldersFail = async (h, width, theme) => {
  const tag = `folders-rail-${width}-${theme}-fail`;
  const p = await h.openPage({ width, height: 780, surface: 'panel', theme, label: tag, routes: { 'GET /folders': { status: 500, body: { error: 'internal', message: 'The folders list could not be read.' } } } });
  console.log(tag);
  await h.listReady(p);
  await groupSamples(h, p, tag);
  await h.checkSoon(() => p.guest('const n = doc.querySelector(".dc-rail-folders-note"); return !n.hidden && /Folders couldn.t load\\. Try again\\./.test(n.textContent)'), `${tag}: the rail says folders couldn't load, with Try again`);
  h.check((await gridSlugs(p)).length === 6, `${tag}: designs still list`);
  await p.shot(`${tag}-1-note`);
  await p.close();
};

export const run = async (helpers) => {
  await pageFlow(helpers, 1400, 'light');
  await pageFlow(helpers, 1400, 'dark');
  await pageNarrow(helpers);
  await pageRemembered(helpers);
  await pageFoldersFail(helpers, 'dark');
  for (const [width, theme] of [[320, 'dark'], [480, 'light']]) await railFlow(helpers, width, theme, true);
  for (const [width, theme] of [[320, 'light'], [480, 'dark']]) await railFlow(helpers, width, theme, false);
  await railFoldersFail(helpers, 320, 'light');
};
