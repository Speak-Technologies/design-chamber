// Visual scenario for Phase 2.6 F2 (the shared folder picker): Add to folder with projects and
// folders (the owner's case: projects automatic and locked, manual ones "Added by you"), search
// past 8 targets, inline New folder, the error state where projects still work, the empty state,
// the New dialog's Folder or project field with chips and the stated result, a filing failure that
// never blocks the design (notice + Try again), and the viewer's ⋯ entry. Rail 320/480 and the
// page, dark and light. The "nothing at all" state (no folders, no projects) cannot be drawn here:
// the mock host always lists one project; the model test covers it.

const FAKE = 'window.frames[0].__dcFake';
const EMBER = 'C:\\Users\\you\\Documents\\GitHub\\ember-oak';
const MYCHAMBA = 'C:\\Users\\you\\work\\mychamba';

const toastTexts = (p) => p.host('JSON.stringify(window.__host.toasts.map((t) => t.message))');
const noOverflow = (p) => p.guest('return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth');

/** Two projects (ember-oak automatic, mychamba added by hand) and seven folders: 9 targets, so search shows. */
const seedWorld = async (p, { folders = true } = {}) => {
  await p.host(`${FAKE}.folders.seedProject(${JSON.stringify(MYCHAMBA)}, ['coffee-subscription'])`);
  const ids = {};
  if (folders) {
    for (const [name, slugs] of [
      ['Q4 launch', ['coffee-subscription']],
      ['Explorations', []],
      ['Client reviews', []],
      ['Archive', []],
      ['Handoff', []],
      ['Pricing tests', ['coffee-subscription']],
      ['Sales deck', []],
    ]) {
      ids[name] = await p.host(`${FAKE}.folders.seed(${JSON.stringify(name)}, ${JSON.stringify(slugs)})`);
    }
  }
  await p.host(`${FAKE}.folders.changed()`);
  await p.settle(400);
  return ids;
};

const openAddDialog = async (p, slug, surface) => {
  if (surface === 'page') {
    await p.hover(`.dc-card[data-slug="${slug}"]`);
    await p.click(`.dc-card[data-slug="${slug}"] .dc-card-more`);
  } else {
    await p.hover(`.dc-row[data-slug="${slug}"]`);
    await p.click(`.dc-row[data-slug="${slug}"] .dc-iconbtn`);
  }
  await p.click('.dc-popup [role="menuitem"]', { text: 'Add to folder' });
  await p.waitFor('return !!doc.querySelector(".dc-sheet[data-variant=dialog] .dc-pick")', 'the Add to folder dialog');
  await p.settle(350);
};

// ---------------------------------------------------------------- the page, both themes

const pagePicker = async (h, theme) => {
  const tag = `folder-picker-page-1400-${theme}`;
  const p = await h.openPage({ width: 1400, height: 900, surface: 'page', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await h.thumbsReady(p);
  const ids = await seedWorld(p);

  await openAddDialog(p, 'coffee-subscription', 'page');
  h.check(await p.guest('return /Projects and folders both group this design\\. Tick as many as you like\\. Each tick saves at once\\./.test(doc.querySelector(".dc-pick-note-line")?.textContent ?? "")'), `${tag}: the note line says what ticking does`);
  h.check(await p.guest('const t = [...doc.querySelectorAll(".dc-pick-section .dc-pick-title")].map((n) => n.textContent); return JSON.stringify(t) === JSON.stringify(["Projects","Folders"])'), `${tag}: Projects list first, then Folders`);
  h.check(await p.guest('const rows = [...doc.querySelectorAll(".dc-pick-section")][0].querySelectorAll(".oc-sdk-check"); return rows.length === 2'), `${tag}: both projects listed (ember-oak and mychamba)`);
  h.check(await p.guest('const r = [...doc.querySelectorAll(".oc-sdk-check")].find((n) => n.textContent.includes("ember-oak")); return r?.getAttribute("aria-checked") === "true" && r?.getAttribute("aria-disabled") === "true" && /Automatic\\. This design was made there\\./.test(r.textContent)'), `${tag}: the derived project is ticked, locked and says why`);
  h.check(await p.guest('const r = [...doc.querySelectorAll(".oc-sdk-check")].find((n) => n.textContent.includes("mychamba")); return r?.getAttribute("aria-checked") === "true" && r?.getAttribute("aria-disabled") === "false" && /Added by you\\. Nothing on disk moved\\./.test(r.textContent)'), `${tag}: the manual project reads "Added by you. Nothing on disk moved."`);
  h.check(await p.guest('return doc.querySelectorAll(".dc-pick-section")[1].querySelectorAll(".oc-sdk-check").length === 7'), `${tag}: all seven folders listed`);
  h.check(await p.guest('return !doc.querySelector(".dc-pick-search").hidden'), `${tag}: nine targets show the search field`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow`);
  await p.shot(`${tag}-1-default`);

  // A tick saves at once; the count next to the folder follows.
  await p.click('.dc-pick .oc-sdk-check', { text: 'Explorations' });
  await h.checkSoon(async () => (await p.host(`${FAKE}.folders.members(${JSON.stringify(ids.Explorations)})`)).includes('coffee-subscription'), `${tag}: ticking Explorations adds the design at once`);
  await p.click('.dc-pick .oc-sdk-check', { text: 'Explorations' });
  await h.checkSoon(async () => !(await p.host(`${FAKE}.folders.members(${JSON.stringify(ids.Explorations)})`)).includes('coffee-subscription'), `${tag}: unticking removes it`);

  // Search narrows both sections.
  await p.type('.dc-pick-search input', 'arch');
  await h.checkSoon(() => p.guest('const f = [...doc.querySelectorAll(".dc-pick-section")][1]; return f.querySelectorAll(".oc-sdk-check").length === 1 && f.textContent.includes("Archive") && /No projects match “arch”\\./.test(doc.querySelectorAll(".dc-pick-section")[0].textContent)'), `${tag}: searching "arch" leaves Archive and says no projects match`);
  await p.shot(`${tag}-2-search`);
  await p.type('.dc-pick-search input', '');
  await p.settle(200);

  // Inline New folder: the duplicate name is refused next to the field, then a new name lands ticked.
  await p.click('.dc-pick-new .oc-sdk-btn', { text: 'New folder' });
  await p.waitFor('return !!doc.querySelector(".dc-pick-new-field input")', 'the create field');
  await p.type('.dc-pick-new-field input', 'q4 LAUNCH');
  await p.click('.dc-pick-new .oc-sdk-btn', { text: 'Create and add' });
  await h.checkSoon(() => p.guest('return /You already have a folder called Q4 launch\\./.test(doc.querySelector(".dc-pick-new-field")?.textContent ?? "")'), `${tag}: a duplicate name (any case) is refused inline`);
  await p.shot(`${tag}-3-create-error`);
  await p.type('.dc-pick-new-field input', 'Launch ideas');
  await p.key('Enter', { focus: '.dc-pick-new-field input' });
  await h.checkSoon(() => p.guest('const c = [...doc.querySelectorAll(".oc-sdk-check")].find((n) => n.textContent.includes("Launch ideas")); return c?.getAttribute("aria-checked") === "true" && /Added to Launch ideas\\./.test(doc.querySelector(".dc-pick-status")?.textContent ?? "")'), `${tag}: Enter creates the folder, ticks it and says so`);
  await p.shot(`${tag}-4-created`);
  await p.click('.dc-sheet .oc-sdk-btn', { text: 'Done' });
  await p.settle(200);
  h.check(await p.guest('return !doc.querySelector(".dc-sheet[data-variant=dialog]")'), `${tag}: Done closes the dialog`);

  // Error: folders didn't load, projects still work, Try again brings them back.
  await p.host(`${FAKE}.folders.failLoads(true)`);
  await openAddDialog(p, 'northwind-pricing', 'page');
  await h.checkSoon(() => p.guest('const b = doc.querySelector(".dc-pick .oc-sdk-banner"); return !!b && /Your folders didn’t load/.test(b.textContent) && /Projects still work/.test(b.textContent)'), `${tag}: the error banner says folders didn't load and projects still work`);
  h.check(await p.guest('return !!doc.querySelector(".dc-pick .oc-sdk-check[aria-disabled=true]") && doc.querySelector(".dc-pick-new").hidden'), `${tag}: projects still list; the create field is hidden`);
  await p.shot(`${tag}-5-error`);
  await p.host(`${FAKE}.folders.failLoads(false)`);
  await p.click('.dc-pick .oc-sdk-banner .oc-sdk-btn', { text: 'Try again' });
  await h.checkSoon(() => p.guest('return doc.querySelectorAll(".dc-pick-section")[1].querySelectorAll(".oc-sdk-check").length >= 7'), `${tag}: Try again loads the folders`);
  await p.key('Escape');
  await p.close();

  // Empty: no folders yet, projects listed, the name field open.
  const empty = await h.openPage({ width: 1400, height: 900, surface: 'page', theme, label: `${tag}-empty` });
  await h.listReady(empty);
  await seedWorld(empty, { folders: false });
  await openAddDialog(empty, 'coffee-subscription', 'page');
  h.check(await empty.guest('return /No folders yet\\. Name one below and this design goes in it\\./.test(doc.querySelector(".dc-pick-message")?.textContent ?? "") && !doc.querySelector(".dc-pick-new-field input").hidden'), `${tag}-empty: the message shows and the name field is open`);
  h.check(await empty.guest('return doc.querySelectorAll(".dc-pick-section")[0].querySelectorAll(".oc-sdk-check").length === 2'), `${tag}-empty: projects still list with no folders`);
  await empty.shot(`${tag}-6-empty`);
  await empty.close();
};

// ---------------------------------------------------------------- the rail: dialog, New dialog field, viewer entry

const railPicker = async (h, width, theme) => {
  const tag = `folder-picker-rail-${width}-${theme}`;
  const p = await h.openPage({ width, height: 780, surface: 'panel', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await h.thumbsReady(p);
  await seedWorld(p);

  await openAddDialog(p, 'coffee-subscription', 'rail');
  h.check(await noOverflow(p), `${tag}: the dialog fits at ${width} px`);
  h.check(await p.guest('return !!doc.querySelector(".dc-pick .oc-sdk-check[aria-disabled=true]")'), `${tag}: the locked project row is there`);
  await p.shot(`${tag}-1-add-dialog`);
  await p.key('Escape');
  await p.settle(150);

  // The New dialog's Folder or project field: chips, combo search, stated result, chip remove.
  await p.click('.dc-rail-head .oc-sdk-btn', { text: 'New' });
  await h.menuItem(p, 'Canvas');
  await p.waitFor('return !!doc.querySelector(".dc-folder-field .dc-pick")', 'the New dialog folder field');
  await p.settle(350);
  h.check(await p.guest('return /Folder or project/.test(doc.querySelector(".dc-folder-field .oc-sdk-field-label")?.textContent ?? "")'), `${tag}: the field is labelled Folder or project`);
  h.check(await p.guest('const c = doc.querySelector(".dc-pick-chip[data-fixed=true]"); return !!c && c.textContent.includes("ember-oak") && /Automatic: the agent works in ember-oak/.test(c.title)'), `${tag}: the automatic project is a fixed chip`);
  h.check(await p.guest('return !doc.querySelector(".dc-folder-field .dc-pick-search").hidden'), `${tag}: the combo always searches`);
  await p.click('.dc-folder-field .oc-sdk-check', { text: 'Q4 launch' });
  await h.checkSoon(() => p.guest('const note = doc.querySelector(".dc-folder-note.dc-goes-line"); return !!note && /Goes into Q4 launch\\. It also lands in ember-oak on its own\\. You can change this later\\./.test(note.textContent)'), `${tag}: the stated result names the pick and the automatic project`);
  h.check(await p.guest('return !!doc.querySelector(".dc-pick-chip-x[aria-label=\\"Remove Q4 launch\\"]")'), `${tag}: the pick is a removable chip`);
  await p.shot(`${tag}-2-new-field`);
  await p.click('.dc-pick-chip-x[aria-label="Remove Q4 launch"]');
  await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-pick-chip-x") && /It also lands in ember-oak on its own\\./.test(doc.querySelector(".dc-folder-note")?.textContent ?? "")'), `${tag}: removing the chip unticks it and the line follows`);

  // Inline create inside the combo.
  await p.click('.dc-folder-field .dc-pick-new .oc-sdk-btn', { text: 'New folder' });
  await p.waitFor('return !!doc.querySelector(".dc-folder-field .dc-pick-new-field input")', 'the combo create field');
  await p.type('.dc-folder-field .dc-pick-new-field input', 'Scratch');
  await p.click('.dc-folder-field .dc-pick-new .oc-sdk-btn', { text: 'Create and add' });
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-pick-chip-x[aria-label=\\"Remove Scratch\\"]") && /Goes into Scratch\\./.test(doc.querySelector(".dc-folder-note")?.textContent ?? "")'), `${tag}: creating in the combo ticks the new folder`);
  await p.shot(`${tag}-3-new-created`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow with the field open`);
  await p.key('Escape');
  await p.settle(150);

  // The viewer's ⋯ menu offers Add to folder… and opens the same dialog.
  await p.click('.dc-row[data-slug="coffee-subscription"] .dc-row-main');
  await h.wallReady(p, 2);
  await p.click('.dc-toolbar-compact .dc-iconbtn[aria-label="More actions"]');
  h.check(await p.guest('return [...doc.querySelectorAll(".dc-popup [role=menuitem]")].some((n) => n.textContent === "Add to folder…")'), `${tag}: the viewer menu offers Add to folder…`);
  await p.shot(`${tag}-4-viewer-menu`);
  await p.click('.dc-popup [role="menuitem"]', { text: 'Add to folder' });
  await p.waitFor('return !!doc.querySelector(".dc-sheet[data-variant=dialog] .dc-pick")', 'the dialog from the viewer');
  await p.settle(300);
  await p.shot(`${tag}-5-viewer-dialog`);
  h.check(await noOverflow(p), `${tag}: no horizontal overflow at the end`);
  await p.close();
};

// ---------------------------------------------------------------- filing at creation: a failure never blocks the design

const filingFlow = async (h, theme) => {
  const tag = `folder-picker-filing-1400-${theme}`;
  const p = await h.openPage({ width: 1400, height: 900, surface: 'page', theme, label: tag });
  console.log(tag);
  await h.listReady(p);
  await h.thumbsReady(p);
  const id = await p.host(`${FAKE}.folders.seed('Q4 launch', [])`);
  await p.settle(300);

  await p.click('.dc-library-bar .oc-sdk-btn', { text: 'New' });
  await h.menuItem(p, 'Canvas');
  await p.waitFor('return !!doc.querySelector(".dc-folder-field .dc-pick")', 'the New dialog');
  await p.settle(300);
  await p.click('.dc-folder-field .oc-sdk-check', { text: 'Q4 launch' });
  await h.checkSoon(() => p.guest('return !!doc.querySelector(".dc-pick-chip-x[aria-label=\\"Remove Q4 launch\\"]")'), `${tag}: the folder is picked`);
  // The filing fails once (the registry could not be read); the design is still made.
  await p.host(`${FAKE}.folders.failNextFiling('The folders list could not be read.')`);
  await p.click('.dc-sheet .oc-sdk-btn', { text: 'Start canvas' });
  await h.checkSoon(async () => /Design started/.test(await toastTexts(p)), `${tag}: the design starts even though filing failed`);
  await p.waitFor('return !!doc.querySelector(".dc-filing-notices .dc-filing-notice")', 'the filing failure notice');
  await p.settle(400);
  h.check(await p.guest('const n = doc.querySelector(".dc-filing-notice"); return /Couldn’t add it to Q4 launch\\./.test(n.textContent) && /The folders list could not be read\\. The design was still made\\./.test(n.textContent) && [...n.querySelectorAll("button")].some((b) => b.textContent.includes("Try again"))'), `${tag}: the notice names the folder, the reason, and offers Try again`);
  await p.shot(`${tag}-1-failure`);
  await p.click('.dc-filing-notice .oc-sdk-btn', { text: 'Try again' });
  await h.checkSoon(() => p.guest('return !doc.querySelector(".dc-filing-notice")'), `${tag}: Try again files it and the notice goes`);
  await h.checkSoon(async () => /Added to Q4 launch/.test(await toastTexts(p)), `${tag}: the retry says what happened`);
  h.check((await p.host(`${FAKE}.folders.members(${JSON.stringify(id)})`)).length === 1, `${tag}: the new design is in the folder`);
  await p.shot(`${tag}-2-retried`);
  await p.close();

  // A folder deleted between the tick and Start: the gone sentence, and a retry that still cannot land.
  const gone = await h.openPage({ width: 1400, height: 900, surface: 'page', theme, label: `${tag}-gone` });
  await h.listReady(gone);
  const goneId = await gone.host(`${FAKE}.folders.seed('Launch', [])`);
  await gone.settle(300);
  await gone.click('.dc-library-bar .oc-sdk-btn', { text: 'New' });
  await h.menuItem(gone, 'Canvas');
  await gone.waitFor('return !!doc.querySelector(".dc-folder-field .dc-pick")', 'the New dialog');
  await gone.settle(300);
  await gone.click('.dc-folder-field .oc-sdk-check', { text: 'Launch' });
  await h.checkSoon(() => gone.guest('return !!doc.querySelector(".dc-pick-chip-x[aria-label=\\"Remove Launch\\"]")'), `${tag}-gone: the folder is picked`);
  await gone.host(`${FAKE}.folders.deleteElsewhere(${JSON.stringify(goneId)})`);
  await gone.settle(300);
  await gone.click('.dc-sheet .oc-sdk-btn', { text: 'Start canvas' });
  await gone.waitFor('return !!doc.querySelector(".dc-filing-notices .dc-filing-notice")', 'the gone notice');
  await h.checkSoon(() => gone.guest('return /That folder isn.t there any more\\./.test(doc.querySelector(".dc-filing-notice")?.textContent ?? "")'), `${tag}-gone: the notice carries the service's sentence`);
  await gone.shot(`${tag}-3-gone`);
  await gone.click('.dc-filing-notice .oc-sdk-btn', { text: 'Try again' });
  await h.checkSoon(() => gone.guest('const n = doc.querySelector(".dc-filing-notice"); return !!n && /That folder isn.t there any more\\./.test(n.textContent)'), `${tag}-gone: a retry against a gone folder says so again, the design stays made`);
  await gone.close();
};

export const run = async (helpers) => {
  await pagePicker(helpers, 'dark');
  await pagePicker(helpers, 'light');
  await railPicker(helpers, 320, 'dark');
  await railPicker(helpers, 480, 'light');
  await filingFlow(helpers, 'dark');
};
